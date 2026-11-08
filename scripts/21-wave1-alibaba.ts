// Wave 1: Alibaba.com app inquiries via Mobilerun (cloud Android, logged in). Serial, one supplier at a time.
// Run: npm run script scripts/21-wave1-alibaba.ts -- [--limit 8] [--ids 3,5,9] [--dry]
import { sql } from "../lib/db";
import { DEVICES, runTaskAndWait, setClipboard } from "../lib/mobilerun";
import { alibabaSendTask } from "../lib/phone-tasks";
import { recordOutbound } from "../lib/channels";
import { firstContactAlibaba } from "../lib/templates";

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const LIMIT = Number(arg("--limit", "8"));
const IDS = arg("--ids", "").split(",").map(Number).filter(Boolean);
const DRY = argv.includes("--dry");
if (!DEVICES.android && !DRY) throw new Error("MOBILERUN_ANDROID_DEVICE_ID not set");

const rows: any[] = IDS.length
  ? await sql`select s.id, s.name, s.products->>'product' as product, (select handle from supplier_contacts c where c.supplier_id = s.id and c.channel = 'alibaba' limit 1) as url from suppliers s where s.id = any(${IDS})`
  : await sql`select s.id, s.name, s.products->>'product' as product, c.handle as url from suppliers s join supplier_contacts c on c.supplier_id = s.id and c.channel = 'alibaba' where s.stage = 'found' order by s.score desc nulls last, s.id limit ${LIMIT}`;

console.log(`${rows.length} Alibaba targets on device ${DEVICES.android}`);
for (const s of rows) {
  const text = firstContactAlibaba(s.name, s.product);
  if (DRY) { console.log(`--- ${s.name} ${s.url}\n${text}\n`); continue; }
  console.log(`→ ${s.name}`);
  try {
    await setClipboard(DEVICES.android, text);
    const t = alibabaSendTask({ supplierName: s.name, url: s.url }, text);
    const r = await runTaskAndWait({ deviceId: DEVICES.android, ...t, timeoutSec: 420 }, { onStatus: (st) => console.log("   ", st) });
    const out: any = r.output ?? {};
    if (r.succeeded && out.sent) {
      await recordOutbound({ supplierId: s.id, channel: "alibaba", externalThreadId: s.name, externalId: `alibaba:out:${s.id}:${r.taskId}`, body: text, sentBy: "agent" });
      console.log(`✅ sent (task ${r.taskId}); last bubble: ${String(out.last_bubble).slice(0, 60)}`);
    } else {
      console.log(`❌ not sent: ${out.error ?? r.message ?? r.status} (task ${r.taskId})`);
      if (out.error === "security_prompt") break;
    }
  } catch (e: any) { console.log(`❌ ${s.name}: ${e.message}`); }
  await new Promise((r) => setTimeout(r, 20_000));
}
