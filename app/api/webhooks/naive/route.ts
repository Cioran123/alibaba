import { naive, verifyNaiveSignature } from "@/lib/naive";
import { sql, audit } from "@/lib/db";
import { json } from "@/lib/http";

export const maxDuration = 30;

export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.NAIVE_WEBHOOK_SECRET;
  if (secret && !verifyNaiveSignature(raw, req.headers.get("vetta-signature"), req.headers.get("vetta-timestamp"), secret)) {
    return json({ error: "bad signature" }, { status: 400 });
  }
  const evt = JSON.parse(raw);
  const [dup] = await sql`select 1 from audit_events where kind like 'naive.%' and payload->>'id' = ${evt.id ?? ""} limit 1`;
  if (dup) return json({ duplicate: true });
  await audit(`naive.${evt.type}`, evt);

  if (evt.type === "session.idle") {
    const d = evt.data ?? {};
    const sessionId: string = d.session_id;
    const stop: string = d.stop_reason;
    if (stop === "awaiting_answer" || stop === "awaiting_approval") {
      const s: any = await naive.sessions.get(sessionId);
      for (const row of s.pending_actions ?? []) {
        const [exists] = await sql`select id from approvals where tool_call_id = ${row.tool_call_id}`;
        if (exists) continue;
        const [memo] = await sql`select id from decision_memos where naive_session_id = ${sessionId} or naive_session_id is null order by id desc limit 1`;
        await sql`insert into approvals(memo_id, naive_session_id, tool_call_id, question) values (${memo?.id ?? null}, ${sessionId}, ${row.tool_call_id}, ${JSON.stringify(row)}::jsonb)`;
      }
      await sql`update conversations set state = 'waiting_founder' where naive_session_id = ${sessionId}`;
    } else if (stop === "end_turn") {
      await sql`update conversations set state = 'waiting_supplier' where naive_session_id = ${sessionId} and state <> 'closed'`;
    }
    if (d.structured_output) await audit("naive.structured_output", { session_id: sessionId, output: d.structured_output });
  }
  return json({ ok: true });
}
