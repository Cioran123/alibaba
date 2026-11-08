// Start an Envoy session for every conversation that has supplier replies but no session yet.
// Run: npm run script scripts/31-kickoff.ts -- [--all] [--conversation 7]
import { sql } from "../lib/db";
import { ensureEnvoySession } from "../lib/channels";
import { fenceSupplierText } from "../lib/naive";

const argv = process.argv.slice(2);
const ALL = argv.includes("--all");
const one = argv.indexOf("--conversation") >= 0 ? Number(argv[argv.indexOf("--conversation") + 1]) : 0;

const convs: any[] = one
  ? await sql`select c.*, s.name from conversations c join suppliers s on s.id = c.supplier_id where c.id = ${one}`
  : ALL
    ? await sql`select c.*, s.name from conversations c join suppliers s on s.id = c.supplier_id where c.naive_session_id is null order by c.id`
    : await sql`select c.*, s.name from conversations c join suppliers s on s.id = c.supplier_id where c.naive_session_id is null and exists (select 1 from messages m where m.conversation_id = c.id and m.direction = 'in') order by c.id`;

console.log(`${convs.length} conversations to kick off`);
for (const c of convs) {
  const msgs = await sql`select direction, body_original, body_en, ts from messages where conversation_id = ${c.id} order by ts`;
  const thread = msgs.map((m: any) => `${m.direction === "in" ? "SUPPLIER" : "US"} (${new Date(m.ts).toISOString().slice(0, 16)}): ${m.body_original}${m.body_en && m.body_en !== m.body_original ? `\n  [EN] ${m.body_en}` : ""}`).join("\n\n");
  const lastIn = [...msgs].reverse().find((m: any) => m.direction === "in");
  const first = lastIn
    ? `Thread so far:\n${thread}\n\n` + fenceSupplierText(c.channel, c.external_thread_id, lastIn.body_original)
    : `Thread so far:\n${thread || "(no messages yet)"}\n\nNo reply yet. Decide whether a polite follow-up is due (max 2 unanswered follow-ups) or end the turn with STATUS: waiting_supplier.`;
  const sid = await ensureEnvoySession(c.id, first);
  console.log(`  conv ${c.id} (${c.name} / ${c.channel}) → session ${sid}`);
}
