// Long-running worker (run on the Mac all night with `caffeinate -i npm run script scripts/32-poll-inboxes.ts`):
//  1) executes queued device_jobs one at a time per device (wechat_send / alibaba_send / *_read)
//  2) every SWEEP_MIN minutes enqueues an inbox sweep for each configured device
//  3) ingests supplier replies → Neon → wakes the Envoy session
import { createHash } from "node:crypto";
import { sql, audit } from "../lib/db";
import { DEVICES, runTaskAndWait, setClipboard, saveTaskEvidence } from "../lib/mobilerun";
import { wechatSendTask, wechatReadTask, alibabaSendTask, alibabaReadTask } from "../lib/phone-tasks";
import { ingestInbound, recordOutbound } from "../lib/channels";
import { pollSessions } from "../lib/naive";
import { wechatSend as macWechatSend, wechatReadNew as macWechatReadNew } from "../lib/wechat-mac";

const MAC_WECHAT = process.env.WECHAT_MODE === "mac";
const WECHAT_DEVICE = MAC_WECHAT ? "mac-wechat" : DEVICES.iphone;

const SWEEP_MIN = Number(process.env.SWEEP_MIN || 20);
const ONCE = process.argv.includes("--once");
const NO_SWEEP = process.argv.includes("--no-sweep");
const AGENTS = [process.env.NAIVE_ENVOY_AGENT_ID || "", process.env.NAIVE_HEAD_AGENT_ID || ""];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 24);

type Job = { id: number; device_id: string; kind: string; payload: any };

async function enqueue(device_id: string, kind: string, payload: any = {}) {
  await sql`insert into device_jobs(device_id, kind, payload) values (${device_id}, ${kind}, ${JSON.stringify(payload)}::jsonb)`;
}

async function nextJob(device_id: string): Promise<Job | null> {
  const rows = await sql`update device_jobs set status = 'running' where id = (select id from device_jobs where device_id = ${device_id} and status = 'queued' order by id limit 1) returning id, device_id, kind, payload`;
  return (rows[0] as Job) ?? null;
}

async function finish(job: Job, status: "done" | "failed", result: any, error?: string) {
  await sql`update device_jobs set status = ${status}, result = ${JSON.stringify(result ?? null)}::jsonb, error = ${error ?? null}, mobilerun_task_id = ${result?.taskId ?? null}, finished_at = now() where id = ${job.id}`;
}

async function ingestChats(channel: "wechat" | "alibaba", chats: any[]) {
  let n = 0;
  for (const chat of chats ?? []) {
    const contact = String(chat.contact ?? "").trim();
    for (const m of chat.messages ?? []) {
      if (m.from !== "supplier" || !m.text) continue;
      const externalId = `${channel}:${hash(contact + "|" + (m.time ?? "") + "|" + m.text)}`;
      const r = await ingestInbound({ channel, from: contact, externalThreadId: contact, externalId, body: m.kind && m.kind !== "text" ? `[${m.kind}] ${m.text}` : m.text });
      if (!r.duplicate) { n++; console.log(`   📩 ${channel} ${contact}: ${m.text.slice(0, 60)} → session ${r.sessionId ?? "none"}`); }
    }
  }
  return n;
}

async function runJob(job: Job) {
  const { kind, device_id, payload } = job;
  if (device_id === "mac-wechat") {
    // WeChat desktop on this Mac (AppleScript + screenshots + vision)
    if (kind === "wechat_send") {
      const r = await macWechatSend(payload.contact, payload.text);
      if (r.sent) {
        await recordOutbound({ supplierId: payload.supplier_id, channel: "wechat", externalThreadId: payload.contact, externalId: `wechat_send:${payload.supplier_id}:${r.taskId}`, body: payload.text, sentBy: "agent", bodyEn: payload.text_en ?? null, screenshotUrl: r.evidence });
        await finish(job, "done", r);
      } else {
        await finish(job, "failed", r, r.error ?? "not_sent");
      }
    } else if (kind === "wechat_read") {
      const allowed = (await sql`select handle from supplier_contacts where channel = 'wechat'`).map((x: any) => String(x.handle));
      const r = await macWechatReadNew(allowed);
      const n = r.error ? 0 : await ingestChats("wechat", r.chats);
      await finish(job, r.error ? "failed" : "done", { ...r, newMessages: n }, r.error ?? undefined);
      console.log(`   wechat_read (mac): ${r.chats.length} chats, ${n} new messages`);
    } else {
      await finish(job, "failed", null, `unsupported on mac: ${kind}`);
    }
    return;
  }
  if (kind === "wechat_send" || kind === "alibaba_send") {
    // Demo sandbox: replies to SIMULATED sellers must never reach a real phone/contact.
    const [sim] = payload.supplier_id ? await sql`select 1 from suppliers where id = ${payload.supplier_id} and source = 'simulated'` : [];
    if (sim) { await finish(job, "done", { simulated: true, skipped: true }); console.log(`   [${kind}] skipped: supplier ${payload.supplier_id} is a simulated demo seller`); return; }
    const text: string = payload.text;
    await setClipboard(device_id, text);
    const t = kind === "wechat_send" ? wechatSendTask(payload.contact, text) : alibabaSendTask({ supplierName: payload.contact, url: payload.url }, text);
    const r = await runTaskAndWait({ deviceId: device_id, ...t, timeoutSec: 420 }, { onStatus: (s) => console.log(`   [${kind}] ${s}`) });
    const out: any = r.output ?? {};
    if (r.succeeded && out.sent) {
      const shot = await saveTaskEvidence(r.taskId);
      await recordOutbound({ supplierId: payload.supplier_id, channel: kind === "wechat_send" ? "wechat" : "alibaba", externalThreadId: payload.contact, externalId: `${kind}:${payload.supplier_id}:${r.taskId}`, body: text, sentBy: "agent", bodyEn: payload.text_en ?? null, screenshotUrl: shot });
      await finish(job, "done", { ...r });
    } else {
      await finish(job, "failed", { ...r }, out.error ?? r.message ?? r.status);
      if (out.error === "security_prompt") { console.log("⚠️  security prompt — pausing this device's queue"); await sql`update device_jobs set status='failed', error='paused_after_security_prompt' where device_id=${device_id} and status='queued'`; }
    }
  } else if (kind === "wechat_read" || kind === "alibaba_read") {
    const allowedWx = kind === "wechat_read" ? (await sql`select handle from supplier_contacts where channel = 'wechat'`).map((x: any) => String(x.handle)) : [];
    const t = kind === "wechat_read" ? wechatReadTask(8, allowedWx) : alibabaReadTask();
    const r = await runTaskAndWait({ deviceId: device_id, ...t, timeoutSec: 900 }, { onStatus: (s) => console.log(`   [${kind}] ${s}`) });
    const chats = (r.output as any)?.chats ?? [];
    if (r.succeeded && chats.length) await saveTaskEvidence(r.taskId);
    const n = r.succeeded ? await ingestChats(kind === "wechat_read" ? "wechat" : "alibaba", chats) : 0;
    await finish(job, r.succeeded ? "done" : "failed", { ...r, newMessages: n }, r.succeeded ? undefined : r.message ?? r.status);
    console.log(`   ${kind}: ${chats.length} chats, ${n} new messages`);
  } else {
    await finish(job, "failed", null, `unknown kind ${kind}`);
  }
}

process.on("unhandledRejection", (e: any) => console.log("   ⚠️ unhandled rejection:", e?.message ?? e));
process.on("uncaughtException", (e: any) => console.log("   ⚠️ uncaught exception:", e?.message ?? e));
const devices = [WECHAT_DEVICE, DEVICES.android].filter(Boolean);
console.log(`worker: devices=${devices.join(", ") || "(none configured)"} sweep every ${SWEEP_MIN} min`);
let lastSweep = 0;
for (;;) {
  try {
  // Naive sessions (founder-approved policy): auto-grant session trust to our own procops.* tools; mirror founder questions to /ops.
  try { await pollSessions({ sql, agentIds: AGENTS, log: (m) => console.log("   " + m) }); } catch (e: any) { console.log("   pollSessions:", e.message); }
  const now = Date.now();
  if (!NO_SWEEP && now - lastSweep > SWEEP_MIN * 60_000) {
    lastSweep = now;
    if (WECHAT_DEVICE) await enqueue(WECHAT_DEVICE, "wechat_read");
    if (DEVICES.android) await enqueue(DEVICES.android, "alibaba_read");
    await audit("sweep.enqueued", { at: new Date().toISOString() });
    console.log(`⏱  ${new Date().toLocaleTimeString()} sweep enqueued`);
  }
  let ran = 0;
  for (const dev of devices) {
    const job = await nextJob(dev);
    if (!job) continue;
    ran++;
    console.log(`▶ job ${job.id} ${job.kind} on ${dev}`);
    try { await runJob(job); } catch (e: any) { console.log(`   ❌ ${e.message}`); await finish(job, "failed", null, e.message); }
    await sleep(job.kind.endsWith("_send") ? 45_000 : 3_000); // pacing between sends
  }
  if (ONCE && !ran) break;
  if (!ran) await sleep(10_000);
  } catch (e: any) {
    // Transient network / API failures (Neon, Naive 429/503, Mobilerun timeouts) must never stop the overnight loop.
    console.log("   ⚠️ loop error:", (e?.message ?? String(e)).slice(0, 160), "— retrying in 20s");
    await sleep(20_000);
  }
}
