// Wave 1: WeChat greeting + RFQ to pre-seeded contacts on the tethered iPhone. One contact per run.
// Run: npm run script scripts/22-wave1-wechat.ts -- --supplier 12 --remark "S012 Shenzhen XYZ" [--text "custom zh text"] [--dry]
import { sql } from "../lib/db";
import { DEVICES, runTaskAndWait, setClipboard, saveTaskEvidence } from "../lib/mobilerun";
import { wechatSendTask } from "../lib/phone-tasks";
import { recordOutbound } from "../lib/channels";
import { firstContactZh } from "../lib/templates";

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SID = Number(arg("--supplier", "0"));
const REMARK = arg("--remark", "");
const DRY = argv.includes("--dry");
if (!SID || !REMARK) throw new Error("--supplier <id> and --remark <WeChat remark> are required");
if (!DEVICES.iphone && !DRY) throw new Error("MOBILERUN_IPHONE_DEVICE_ID not set");

const [s] = await sql`select id, name, products->>'product' as product from suppliers where id = ${SID}`;
if (!s) throw new Error(`supplier ${SID} not found`);
await sql`insert into supplier_contacts(supplier_id, channel, handle, label) values (${SID}, 'wechat', ${REMARK}, ${s.name}) on conflict do nothing`;

const text = arg("--text", firstContactZh(s.name, s.product));
console.log(`→ WeChat "${REMARK}" (${s.name})\n${text}\n`);
if (DRY) process.exit(0);

await setClipboard(DEVICES.iphone, text);
const t = wechatSendTask(REMARK, text);
const r = await runTaskAndWait({ deviceId: DEVICES.iphone, ...t, timeoutSec: 300 }, { onStatus: (st) => console.log("   ", st) });
const out: any = r.output ?? {};
if (r.succeeded && out.sent) {
  await recordOutbound({ supplierId: SID, channel: "wechat", externalThreadId: REMARK, externalId: `wechat:out:${SID}:${r.taskId}`, body: text, sentBy: "agent", screenshotUrl: await saveTaskEvidence(r.taskId) });
  console.log(`✅ sent (task ${r.taskId}); last bubble: ${String(out.last_bubble).slice(0, 80)}`);
} else {
  console.log(`❌ not sent: ${out.error ?? r.message ?? r.status} (task ${r.taskId})`);
}
