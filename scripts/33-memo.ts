// Trigger the Head of Procurement: memo → ask_operator → (founder answers via /api/approve or /ops).
// Run: npm run script scripts/33-memo.ts
import { naive, startSession } from "../lib/naive";
import { sql } from "../lib/db";
import { overviewSnapshot } from "../lib/channels";

const HEAD = process.env.NAIVE_HEAD_AGENT_ID;
if (!HEAD) throw new Error("NAIVE_HEAD_AGENT_ID not set");

const s = await startSession(HEAD, `Quotes have come in from suppliers. Run your workflow now: memo_compose → ask_operator for the founder's decision.\n\n${await overviewSnapshot()}`, { role: "head" });
console.log("head session", s.id);
await sql`insert into audit_events(kind, payload) values ('memo.session', ${JSON.stringify({ session_id: s.id })}::jsonb)`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 90; i++) {
  await sleep(5000);
  const st: any = await naive.sessions.get(s.id);
  process.stdout.write(`\r  status=${st.status} stop_reason=${st.stop_reason ?? "-"}        `);
  if (st.status === "idle" && (st.stop_reason === "awaiting_answer" || st.stop_reason === "awaiting_approval")) {
    console.log("\n  pending_actions:", JSON.stringify(st.pending_actions, null, 1).slice(0, 1500));
    for (const row of st.pending_actions ?? []) {
      const [exists] = await sql`select id from approvals where tool_call_id = ${row.tool_call_id}`;
      if (!exists) {
        const [memo] = await sql`select id from decision_memos order by id desc limit 1`;
        await sql`insert into approvals(memo_id, naive_session_id, tool_call_id, question) values (${memo?.id ?? null}, ${s.id}, ${row.tool_call_id}, ${JSON.stringify(row)}::jsonb)`;
      }
    }
    console.log("  → decide at /ops or POST /api/approve");
    break;
  }
  if (["completed", "failed", "cancelled"].includes(st.status) || (st.status === "idle" && st.stop_reason === "end_turn")) {
    console.log("\n  session ended without a question:", st.stop_reason, st.stop_code ?? "");
    break;
  }
}
