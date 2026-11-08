// Post one Alibaba RFQ (Request for Quotation) from the logged-in cloud Android. One RFQ reaches many suppliers.
// Run: npm run script scripts/25-post-rfq.ts -- [--dry]
import { DEVICES, runTaskAndWait, setClipboard, saveTaskEvidence } from "../lib/mobilerun";
import { sql, audit } from "../lib/db";
import { SPEC_EN } from "../lib/templates";
import { ALIBABA_APP, alibabaAppRfqTask } from "../lib/phone-tasks";

const COMPANY = process.env.COMPANY_NAME || "Sentinel Care";
const DRY = process.argv.includes("--dry");
const PRODUCT = "60GHz mmWave radar fall detection sensor module (or IMU+BLE pendant module)";
const DETAILS =
  `${COMPANY} (US startup) is sourcing ${SPEC_EN}. Pilot order 500 pcs, then about 5,000 pcs/year. ` +
  `Please quote unit price at 500 / 1,000 / 5,000 pcs FOB Shenzhen, MOQ, production lead time, sample price and sample lead time, ` +
  `available certificates (CE, FCC, RoHS; test reports), warranty, and whether you are a factory or trading company. ` +
  `Payment: 30% deposit / 70% before shipment, or Trade Assurance. Please reply with your quotation and lead time. Thank you! 谢谢！`;

console.log("RFQ product:", PRODUCT, "\nRFQ details:", DETAILS, "\n");
if (DRY) process.exit(0);
if (!DEVICES.android) throw new Error("MOBILERUN_ANDROID_DEVICE_ID not set");

await setClipboard(DEVICES.android, DETAILS);
// ALIBABA_MODE=app → post inside the official Alibaba.com app (the Chrome form never rendered usable on the phone).
const r = ALIBABA_APP ? await runTaskAndWait({ deviceId: DEVICES.android, ...alibabaAppRfqTask(PRODUCT, 500, DETAILS.slice(0, 40)), timeoutSec: 540 }, { onStatus: (s) => console.log("   ", s) }) : await runTaskAndWait({
  deviceId: DEVICES.android,
  task:
    `Post ONE Request for Quotation (RFQ) on Alibaba.com in Chrome (logged in as a buyer). ` +
    `Go to https://rfq.alibaba.com/rfq/rfqForm.htm and wait 15 seconds. IMPORTANT: the form renders as a small desktop-style page on the phone — it IS loaded even if it looks tiny; pinch-zoom in if needed and tap precisely. Labels are in Russian. ` +
    `Fill it top to bottom: ` +
    `(1) The single-line input under "Заполните требования к поставщикам" (placeholder "Введите"): tap it and type exactly: ${PRODUCT} ` +
    `(2) The large text area under "Введите подробные требования": tap inside it (below the "Написать с помощью ИИ" chip), long-press and choose Paste/Вставить — the text is on the clipboard; if Paste is not offered, type the text exactly as given at the end of this task. ` +
    `(3) The input under "Приобретаемое количество" (placeholder "Введите"): type 500. Leave the unit as "шт." (pieces). ` +
    `(4) Make sure the checkbox "Я прочитал(а), понял(а) и соглашаюсь…" is checked (it usually is). Do not tick the business-card checkbox. ` +
    `(5) Tap the orange button "Отправить запрос". Wait 10 seconds. A confirmation ("успешно" / "submitted" / an RFQ detail page or "Управление запросами") means posted=true; return the confirmation text. ` +
    `If a captcha appears return error='captcha'; if a login page appears return error='not_logged_in'. Never open Chrome's menu, never toggle Desktop site, never open new tabs. Post only once. ` +
    `Text for the details field: ${DETAILS}`,
  outputSchema: { type: "object", properties: { posted: { type: "boolean" }, confirmation: { type: "string" }, error: { type: ["string", "null"] } }, required: ["posted", "confirmation", "error"] },
  systemPrompt: "You are a careful human buyer using Alibaba.com in Chrome on Android. The RFQ page is a desktop layout shown small; zoom and tap precisely. Fill the form exactly as instructed and submit once.",
  maxSteps: 70, timeoutSec: 540, vision: true,
}, { onStatus: (s) => console.log("   ", s) });

const out: any = r.output ?? {};
console.log(JSON.stringify(out).slice(0, 400), "| task", r.taskId);
const evidence = await saveTaskEvidence(r.taskId);
await audit("rfq.posted", { posted: out.posted, confirmation: out.confirmation, error: out.error, taskId: r.taskId, evidence });
if (out.posted) {
  const [s] = await sql`insert into suppliers(name, source, stage, notes) values ('Alibaba RFQ (broadcast to matching suppliers)', 'alibaba-rfq', 'contacted', ${`RFQ posted by agent; task ${r.taskId}`}) returning id`;
  const [c] = await sql`insert into conversations(supplier_id, channel, external_thread_id, state) values (${s.id}, 'alibaba', 'rfq', 'waiting_supplier') returning id`;
  await sql`insert into messages(conversation_id, direction, external_id, body_original, sent_by, screenshot_url) values (${c.id}, 'out', ${`rfq:${r.taskId}`}, ${`[RFQ] ${PRODUCT}\n${DETAILS}`}, 'agent', ${evidence})`;
  console.log(`✅ RFQ posted; evidence ${evidence}`);
} else {
  console.log(`❌ RFQ not posted: ${out.error ?? r.message ?? r.status}`);
}
