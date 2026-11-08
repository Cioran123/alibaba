// Export the Alibaba.com conversation history (Messenger threads + RFQ quotes) from the logged-in cloud Android
// into alibaba-history/<timestamp>/: every trajectory frame (screenshots), transcript.json and transcript.md.
// Read-only: the phone agent opens threads and scrolls; it never types or sends.
// Run: npm run script scripts/26-alibaba-history.ts -- [--max-threads 12]
import { mkdirSync, writeFileSync } from "node:fs";
import { DEVICES, mobilerun, runTaskAndWait } from "../lib/mobilerun";
import { sql, audit } from "../lib/db";

const argv = process.argv.slice(2);
const MAX = Number(argv[argv.indexOf("--max-threads") + 1] || 12);
if (!DEVICES.android) throw new Error("MOBILERUN_ANDROID_DEVICE_ID not set");
const APP = process.env.ALIBABA_MODE === "app";

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = `alibaba-history/${stamp}`;
mkdirSync(`${dir}/frames`, { recursive: true });

const SCHEMA = {
  type: "object",
  properties: {
    threads: {
      type: "array",
      items: {
        type: "object",
        properties: {
          contact: { type: "string" }, company: { type: "string" }, last_time: { type: ["string", "null"] },
          messages: { type: "array", items: { type: "object", properties: { from: { type: "string", enum: ["supplier", "us", "system"] }, text: { type: "string" }, time: { type: ["string", "null"] } }, required: ["from", "text", "time"] } },
        },
        required: ["contact", "company", "last_time", "messages"],
      },
    },
    rfq: { type: "object", properties: { found: { type: "boolean" }, status: { type: "string" }, quotes: { type: "array", items: { type: "object", properties: { supplier: { type: "string" }, price: { type: "string" }, note: { type: "string" } }, required: ["supplier", "price", "note"] } } }, required: ["found", "status", "quotes"] },
    error: { type: ["string", "null"] },
  },
  required: ["threads", "rfq", "error"],
};

const where = APP
  ? `Open the Alibaba.com app (logged in) and tap the Messenger / Messages tab.`
  : `Open Chrome and go to https://message.alibaba.com (logged in). If the page is blank, pull to refresh once.`;

const task =
  `READ-ONLY export of our Alibaba conversation history. Never type, never send, never delete, never open Chrome's menu. ` +
  `Part 1 — Messenger: ${where} List every conversation thread (at most ${MAX}). For each thread: open it, scroll UP to the very beginning of the conversation, then scroll down slowly to the end so every message is visible on screen at some point (this is being recorded). ` +
  `Capture every message in order: from="supplier" for the supplier side, "us" for our side, "system" for cards/notices (quotation cards, "inquiry sent", product cards — include their text such as price/MOQ). Record the contact (rep) name and company name shown at the top. Then go back to the list. ` +
  `Part 2 — RFQ: ${APP ? `in the app, open "My Alibaba" → "RFQ" / "Quotations" / "Buying requests"` : `go to https://rfq.alibaba.com/rfq/manage.htm (or tap "Manage my RFQ")`}. Find the request "60GHz mmWave radar fall detection sensor module" (id 1402776503). Report its status and list every quotation received (supplier, price, note) — open the quotes list if there is one and scroll through it. If nothing has arrived yet, say so. ` +
  `Return the JSON exactly per schema. If a login page appears return error='not_logged_in'.`;

console.log(`exporting to ${dir} (${APP ? "app" : "web"} mode) …`);
const r = await runTaskAndWait({ deviceId: DEVICES.android, task, outputSchema: SCHEMA, systemPrompt: "You are a careful human buyer reviewing your own Alibaba conversations. Read-only. Scroll slowly so every message is shown. Dismiss popups.", maxSteps: 120, timeoutSec: 1500, vision: APP || process.env.ALIBABA_VISION === "1" }, { onStatus: (s) => console.log("   ", s) });
const out: any = r.output ?? { threads: [], rfq: { found: false, status: "", quotes: [] }, error: r.message ?? r.status };
console.log(`task ${r.taskId}: ${r.status}; threads=${out.threads?.length ?? 0}; rfq.found=${out.rfq?.found}; error=${out.error}`);

// All trajectory frames, numerically ordered
const num = (u: string) => Number((u.split("?")[0].match(/\/(\d+)\.png$/) || [])[1] ?? -1);
let saved = 0;
try {
  const shots: any = await mobilerun.tasks.screenshots.list(r.taskId);
  const urls: string[] = [...(shots?.urls ?? [])].sort((a, b) => num(a) - num(b));
  for (const u of urls) { const res = await fetch(u); if (!res.ok) continue; writeFileSync(`${dir}/frames/${String(num(u)).padStart(3, "0")}.png`, Buffer.from(await res.arrayBuffer())); saved++; }
} catch (e: any) { console.log("frames:", e.message?.slice(0, 100)); }

// Transcripts
writeFileSync(`${dir}/transcript.json`, JSON.stringify({ exported_at: new Date().toISOString(), task_id: r.taskId, mode: APP ? "app" : "web", ...out }, null, 2));
const md = [
  `# Alibaba conversation history — exported ${new Date().toISOString()}`,
  ``, `Source: Alibaba.com ${APP ? "app" : "mobile web"} on cloud Android ${DEVICES.android}, Mobilerun task ${r.taskId}. Frames: ${saved} screenshots in ./frames (chronological).`, ``,
  `## RFQ 1402776503`, `Status: ${out.rfq?.status || "unknown"}`, ...(out.rfq?.quotes?.length ? out.rfq.quotes.map((q: any) => `- **${q.supplier}** — ${q.price} ${q.note ? `(${q.note})` : ""}`) : ["- no quotations yet"]), ``,
  `## Messenger threads (${out.threads?.length ?? 0})`,
  ...(out.threads ?? []).flatMap((t: any) => [``, `### ${t.contact} — ${t.company}${t.last_time ? ` (last: ${t.last_time})` : ""}`, ...t.messages.map((m: any) => `- ${m.from === "us" ? "**US**" : m.from === "supplier" ? "**SUPPLIER**" : "_system_"}${m.time ? ` [${m.time}]` : ""}: ${m.text}`)]),
];
writeFileSync(`${dir}/transcript.md`, md.join("\n"));

// Also mirror into Neon (idempotent) so the pipeline reflects what the phone saw
let inserted = 0;
for (const t of out.threads ?? []) {
  const [s] = await sql`select id from suppliers where lower(name) = lower(${t.company}) or lower(name) like lower(${t.company.split(" ")[0] + "%"}) order by id limit 1`;
  if (!s) continue;
  const [conv] = await sql`insert into conversations(supplier_id, channel, external_thread_id) values (${s.id}, 'alibaba', ${t.company}) on conflict (channel, external_thread_id) do update set state = conversations.state returning id`;
  for (const m of t.messages) {
    if (m.from === "system") continue;
    const ext = `alibaba:hist:${s.id}:${Buffer.from(`${m.from}|${m.time ?? ""}|${m.text}`).toString("base64").slice(0, 40)}`;
    const row = await sql`insert into messages(conversation_id, direction, external_id, body_original, sent_by) values (${conv.id}, ${m.from === "us" ? "out" : "in"}, ${ext}, ${m.text}, ${m.from === "us" ? "agent" : "supplier"}) on conflict (external_id) do nothing returning id`;
    if (row[0]) inserted++;
  }
}
await audit("alibaba.history.export", { dir, taskId: r.taskId, threads: out.threads?.length ?? 0, frames: saved, inserted });
console.log(`saved ${saved} frames, transcript.md/json → ${dir}; mirrored ${inserted} new messages into Neon`);
