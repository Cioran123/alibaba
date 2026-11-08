// Wave 1: personalized RFQ emails via AgentMail to every supplier with an email contact.
// Run: npm run script scripts/20-wave1-email.ts -- [--limit 10] [--to someone@x.com --supplier 3] [--dry]
import { sql } from "../lib/db";
import { sendEmail } from "../lib/agentmail";
import { recordOutbound } from "../lib/channels";
import { firstContactEmail } from "../lib/templates";

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const LIMIT = Number(arg("--limit", "10"));
const DRY = argv.includes("--dry");

let targets: { supplier_id: number; name: string; email: string; product: string | null }[];
if (argv.includes("--to")) {
  const sid = Number(arg("--supplier", "0"));
  const [s] = sid ? await sql`select id, name, products from suppliers where id = ${sid}` : [null];
  targets = [{ supplier_id: sid, name: s?.name ?? "there", email: arg("--to", ""), product: s?.products?.product ?? null }];
  if (sid) await sql`insert into supplier_contacts(supplier_id, channel, handle, label) values (${sid}, 'email', ${targets[0].email}, ${targets[0].name}) on conflict do nothing`;
} else {
  targets = (await sql`
    select c.supplier_id, s.name, c.handle as email, s.products->>'product' as product
    from supplier_contacts c join suppliers s on s.id = c.supplier_id
    where c.channel = 'email' and s.stage = 'found'
    order by s.score desc nulls last, s.id limit ${LIMIT}`) as any;
}

console.log(`${targets.length} email targets`);
for (const t of targets) {
  const { subject, text } = firstContactEmail(t.name, t.product);
  if (DRY) { console.log(`\n--- ${t.email} (${t.name})\n${subject}\n${text.slice(0, 200)}...`); continue; }
  try {
    const r: any = await sendEmail({ to: t.email, subject, text });
    const threadId = r.threadId ?? r.thread_id ?? `email:${t.email}`;
    await recordOutbound({ supplierId: t.supplier_id, channel: "email", externalThreadId: threadId, externalId: r.messageId ?? r.message_id ?? `out:${threadId}:${Date.now()}`, body: text, sentBy: "agent" });
    console.log(`✅ sent to ${t.email} (${t.name}) thread=${threadId}`);
  } catch (e: any) {
    console.log(`❌ ${t.email}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 1500));
}
