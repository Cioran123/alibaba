// End-to-end demo: founder need → sourcing brief → phone scouts Alibaba → phone sends inquiry → phone reads
// Messenger → Naïve Envoy handles the seller's reply. Every phone step is a Mobilerun task with video recording,
// so the whole run is visible on the Mobilerun dashboard (Tasks → trajectory + recording).
//
// Run (phone must be idle — stop other Alibaba scripts first):
//   npm run script scripts/50-demo-flow.ts -- --need "60 GHz mmWave radar module for fall detection, 500 pcs pilot"
// Flags:
//   --skip-send          scout + read only (no inquiry)
//   --simulate-reply     if no real seller reply yet, generate one (clearly labelled SIMULATED) on a sandbox supplier
//                        record and let the Envoy answer it; nothing is ever sent to a real seller for it
//   --read-only          only read Messenger and ingest real replies
import { writeFileSync, mkdirSync } from "node:fs";
import { sql } from "../lib/db";
import { DEVICES, mobilerun, runTaskAndWait, saveTaskEvidence, setClipboard } from "../lib/mobilerun";
import { alibabaReadTask, alibabaSendTask, READ_SCHEMA, SEND_SCHEMA } from "../lib/phone-tasks";
import { ingestInbound, recordOutbound } from "../lib/channels";
import { simulateSellerReply, sourcingBrief } from "../lib/llm";
import { getSession } from "../lib/naive";

const argv = process.argv.slice(2);
const arg = (k: string, d = "") => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const NEED = arg("--need", "60 GHz mmWave radar module for fall detection of elderly people, low power, CE/FCC, 500 pcs pilot then ~5,000/yr");
const SKIP_SEND = argv.includes("--skip-send");
const SIMULATE = argv.includes("--simulate-reply");
const READ_ONLY = argv.includes("--read-only");
const COMPANY = process.env.COMPANY_NAME || "Sentinel Care";
const DEVICE = DEVICES.android;
if (!DEVICE) throw new Error("MOBILERUN_ANDROID_DEVICE_ID not set");

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const log: any[] = [];
const step = (name: string, data: Record<string, unknown>) => {
  log.push({ step: name, at: new Date().toISOString(), ...data });
  console.log(`\n━━ ${name}\n${JSON.stringify(data, null, 2).slice(0, 1500)}`);
};
const dash = (taskId: string) => `https://cloud.mobilerun.ai/tasks/${taskId}`;

async function phone(name: string, p: { task: string; outputSchema: any; systemPrompt?: string; maxSteps?: number; vision?: boolean }, timeoutSec = 600) {
  const active = (await mobilerun.devices.retrieve(DEVICE) as any).activeTaskId;
  if (active) throw new Error(`device busy with task ${active} — wait for it or stop the other script`);
  console.log(`\n📱 ${name} …`);
  const r = await runTaskAndWait({ deviceId: DEVICE, ...p, timeoutSec }, { onStatus: (s) => console.log(`   ${s}`) });
  const evidence = await saveTaskEvidence(r.taskId);
  step(name, { taskId: r.taskId, dashboard: dash(r.taskId), status: r.status, steps: r.steps, output: r.output, message: r.message?.slice(0, 300), evidence });
  return r;
}

const SYSTEM =
  "You are a careful human buyer using the Alibaba.com mobile website in Chrome on an Android phone (already logged in). " +
  "Dismiss popups, app-install banners and cookie prompts. Never open Chrome's three-dot menu, never toggle Desktop site, never open new tabs. Never place orders or pay.";

// ── 1. Founder need → sourcing brief ──────────────────────────────────────────────────────────────
step("1. Founder request", { need: NEED, company: COMPANY });
const brief = await sourcingBrief(NEED, COMPANY);
step("2. Sourcing brief (scout agent)", brief);

// One continuous screen recording of the phone for the whole run (shown under Recordings on the Mobilerun dashboard).
{ const busy = (await mobilerun.devices.retrieve(DEVICE) as any).activeTaskId; if (busy) throw new Error(`device busy with task ${busy}`); }
const rec: any = await mobilerun.devices.recordings.start(DEVICE, { name: `naive-sourcing-demo-${runId}`, types: ["video", "trajectory"], retentionDays: 30 } as any);
step("Recording started", { recordingId: rec.id, status: rec.status });

async function stopAndDownloadVideo() {
  try { await mobilerun.devices.recordings.stop(rec.id, { deviceId: DEVICE }); } catch (e: any) { console.log("stop recording:", e.message); }
  let st: any = null;
  for (let i = 0; i < 60; i++) {
    st = await mobilerun.devices.recordings.status(rec.id, { deviceId: DEVICE });
    if (st.video?.sizeBytes || ["completed", "ready", "failed", "error"].includes(st.status)) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  const res = await fetch(`https://api.mobilerun.ai/v1/devices/${DEVICE}/recordings/${rec.id}/video`, { headers: { Authorization: `Bearer ${process.env.MOBILERUN_CLOUD_API_KEY}` }, redirect: "follow" });
  let buf: Buffer | null = null;
  if ((res.headers.get("content-type") || "").includes("json")) {
    const j: any = await res.json();
    const url = j.url ?? j.downloadUrl ?? j.videoUrl;
    if (url) buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  } else if (res.ok) buf = Buffer.from(await res.arrayBuffer());
  mkdirSync("public/demo", { recursive: true });
  const path = `public/demo/run-${runId}.mp4`;
  if (buf?.length) writeFileSync(path, buf);
  step("Recording stopped", { recordingId: rec.id, status: st?.status, video: st?.video, file: buf?.length ? path : null, httpStatus: res.status });
}

let supplierId: number | null = null;
let supplierName = "";
let listing: any = null;
let inquiry = brief.rfq_en;

if (!READ_ONLY) {
  // ── 3. Phone: search Alibaba and pick a supplier ────────────────────────────────────────────────
  const searchUrl = `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(brief.search_query)}`;
  const LISTING_SCHEMA = {
    type: "object",
    properties: {
      candidates: { type: "array", items: { type: "object", properties: { supplier: { type: "string" }, title: { type: "string" }, price: { type: ["string", "null"] }, moq: { type: ["string", "null"] }, verified: { type: ["boolean", "null"] } }, required: ["supplier", "title", "price", "moq", "verified"] } },
      chosen: { type: "object", properties: {
        supplier: { type: "string" }, title: { type: "string" }, price: { type: ["string", "null"] }, moq: { type: ["string", "null"] },
        years: { type: ["string", "null"] }, verified: { type: ["boolean", "null"] }, rating_or_response: { type: ["string", "null"] },
        product_url: { type: ["string", "null"] }, why: { type: "string" },
      }, required: ["supplier", "title", "price", "moq", "years", "verified", "rating_or_response", "product_url", "why"] },
      error: { type: ["string", "null"] },
    },
    required: ["candidates", "chosen", "error"],
  };
  const scout = await phone("3. Phone scouts Alibaba for a supplier", {
    systemPrompt: SYSTEM,
    outputSchema: LISTING_SCHEMA,
    maxSteps: 45,
    task:
      `Find a supplier on Alibaba.com for: ${brief.spec_en}.\n` +
      `Steps: 1) Open Chrome and go to ${searchUrl} . Wait up to 10 seconds; if blank, pull down to refresh once. ` +
      `2) Scroll the results slowly (2-3 screens) and note up to 5 relevant listings: supplier company name, product title, price, MOQ, and whether it shows Verified / Verified Supplier. Ignore ads for unrelated products. ` +
      `3) Choose the best one: product matches the spec, from a manufacturer (Verified and more years preferred), reasonable price/MOQ for ${brief.pilot_qty} pcs. Tap it to open the product page and wait 8 seconds. ` +
      `4) On the product page read the supplier company name, years on Alibaba, Verified badge, rating or response rate, price tiers and MOQ. Tap the address bar once to read the full product URL, then press Back to close it without navigating. ` +
      `Return candidates (the listings you noted), chosen (with product_url and a one-line why). Do not contact anyone yet. If a login page or captcha appears, return error='not_logged_in' or 'captcha'.`,
  }, 480);
  listing = (scout.output as any)?.chosen ?? null;

  if (listing?.supplier) {
    supplierName = String(listing.supplier).trim();
    const productId = String(listing.product_url ?? "").match(/_(\d{10,})\.html/)?.[1] ?? null;
    const contactUrl = productId ? `https://message.alibaba.com/msgsend/contact.htm?action=contact_action&appForm=s_en&chkProductIds=${productId}` : null;
    const [existing] = await sql`select id from suppliers where lower(name) = lower(${supplierName}) limit 1`;
    if (existing) supplierId = existing.id;
    else {
      const [s] = await sql`insert into suppliers(name, source, source_url, country, verified, response_rate, products, score, notes)
        values (${supplierName}, 'alibaba', ${listing.product_url ?? null}, 'CN', ${listing.verified ?? null}, ${listing.rating_or_response ?? null},
                ${JSON.stringify({ product: listing.title, price: listing.price, moq: listing.moq })}::jsonb, 80, ${`found by phone scout (demo ${runId})`}) returning id`;
      supplierId = s.id;
    }
    await sql`insert into supplier_contacts(supplier_id, channel, handle, label) values (${supplierId}, 'alibaba', ${contactUrl ?? listing.product_url ?? supplierName}, ${supplierName}) on conflict do nothing`;
    step("4. Supplier selected", { supplierId, supplierName, productId, contactUrl, listing });

    // ── 5. Phone: send the inquiry ───────────────────────────────────────────────────────────────────
    if (!SKIP_SEND) {
      inquiry = brief.rfq_en.replace(/^Hello[^,]*,/i, `Hello ${supplierName},`);
      await setClipboard(DEVICE, inquiry);
      const t = contactUrl
        ? alibabaSendTask({ supplierName, url: contactUrl }, inquiry)
        : {
            ...alibabaSendTask({ supplierName, url: listing.product_url }, inquiry),
            task:
              `Send one inquiry to the Alibaba.com supplier "${supplierName}". 1) Open Chrome and go to ${listing.product_url} . 2) Tap "Contact supplier" / "Send inquiry". ` +
              `3) Long-press the message box and Paste (the message is on the clipboard); if Paste is not offered type exactly: "${inquiry}". 4) Tap the orange send button. ` +
              `5) Success looks like "Your inquiry was sent successfully". Return sent=true and last_bubble = first 60 characters. Never send anything else. If a security prompt/captcha appears, stop and return error='security_prompt'.`,
          };
      const sent = await phone("5. Phone sends the inquiry", { ...t, systemPrompt: SYSTEM, outputSchema: SEND_SCHEMA }, 480);
      if (sent.succeeded && (sent.output as any)?.sent) {
        await recordOutbound({ supplierId: supplierId!, channel: "alibaba", externalThreadId: supplierName, externalId: `alibaba:out:${supplierId}:${sent.taskId}`, body: inquiry, sentBy: "agent", screenshotUrl: `/evidence/${sent.taskId}/last.png` });
      }
    }
  } else {
    step("4. Supplier selected", { error: (scout.output as any)?.error ?? scout.message ?? "scout returned no supplier" });
  }
}

// ── 6. Phone: read Alibaba Messenger for real replies ──────────────────────────────────────────────
const read = await phone("6. Phone reads Alibaba Messenger", { ...alibabaReadTask(6), systemPrompt: SYSTEM + " Read only.", outputSchema: READ_SCHEMA }, 900);
const chats: any[] = (read.output as any)?.chats ?? [];
await stopAndDownloadVideo();
const realReplies: any[] = [];
for (const chat of chats) {
  for (const m of chat.messages ?? []) {
    if (m.from !== "supplier" || !m.text) continue;
    const r = await ingestInbound({ channel: "alibaba", from: String(chat.contact).trim(), externalThreadId: String(chat.contact).trim(), externalId: `alibaba:${Buffer.from(chat.contact + "|" + (m.time ?? "") + "|" + m.text).toString("base64url").slice(0, 80)}`, body: m.text, screenshotUrl: `/evidence/${read.taskId}/last.png` });
    realReplies.push({ contact: chat.contact, text: m.text, duplicate: r.duplicate, session: r.sessionId ?? null });
  }
}
step("7. Real seller replies ingested → Naïve Envoy sessions", { count: realReplies.length, replies: realReplies });

// ── 8. Optional SIMULATED seller reply on a sandbox supplier (never reaches a real seller) ─────────
let envoySession: string | null = realReplies.find((r) => r.session)?.session ?? null;
if (!realReplies.length && SIMULATE) {
  const simName = `SIMULATED seller (demo of ${supplierName || "Alibaba supplier"})`;
  const [sim] = await sql`insert into suppliers(name, source, country, verified, trade_assurance, products, stage, notes)
    values (${simName}, 'simulated', 'CN', ${listing?.verified ?? true}, true, ${JSON.stringify({ product: listing?.title ?? brief.product })}::jsonb, 'contacted',
            'SIMULATED demo seller — replies are LLM-generated; outbound messages are recorded only, never sent') returning id`;
  await recordOutbound({ supplierId: sim.id, channel: "alibaba", externalThreadId: simName, externalId: `sim:out:${sim.id}:inquiry`, body: inquiry, sentBy: "agent" });
  const reply = await simulateSellerReply({ supplierName: supplierName || "Shenzhen electronics manufacturer", product: listing?.title ?? brief.product, inquiry, listing });
  const r = await ingestInbound({ channel: "alibaba", from: simName, externalThreadId: simName, externalId: `sim:in:${sim.id}:${runId}`, body: `[SIMULATED] ${reply}`, supplierId: sim.id });
  envoySession = r.sessionId ?? null;
  step("8. SIMULATED seller reply → Naïve Envoy", { simulatedSupplierId: sim.id, reply, envoySession });
}

// ── 9. Watch the Envoy work (record_quote → propose_offer → draft reply) ───────────────────────────
if (envoySession) {
  // The worker (scripts/32-poll-inboxes.ts) auto-confirms procops tool holds; here we just wait and report.
  let s: any = null;
  for (let i = 0; i < 180; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    // Belt and braces for workers started before the simulated-seller guard existed.
    await sql`update device_jobs set status = 'done', error = 'skipped: simulated demo seller' where status = 'queued' and (payload->>'supplier_id')::int in (select id from suppliers where source = 'simulated')`;
    s = await getSession(envoySession);
    if (s?.status === "idle" && s?.stop_reason !== "awaiting_approval") break;
  }
  const quotes = await sql`select q.* from quotes q join conversations c on c.supplier_id = q.supplier_id where c.naive_session_id = ${envoySession} order by q.id desc limit 3`;
  const outs = await sql`select m.body_original, m.ts from messages m join conversations c on c.id = m.conversation_id where c.naive_session_id = ${envoySession} and m.direction = 'out' order by m.ts desc limit 2`;
  step("9. Envoy result", { session: envoySession, status: s?.status, stop_reason: s?.stop_reason, last_output: JSON.stringify(s?.output ?? s?.last_message ?? "").slice(0, 1200), quotes, replies_out: outs });
}

mkdirSync("public/demo", { recursive: true });
writeFileSync(`public/demo/run-${runId}.json`, JSON.stringify({ need: NEED, brief, supplierId, supplierName, listing, steps: log }, null, 2));
console.log(`\n✅ demo log → public/demo/run-${runId}.json`);
process.exit(0);
