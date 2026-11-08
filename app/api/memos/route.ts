import { sql } from "@/lib/db";
import { json, options } from "@/lib/http";

export const dynamic = "force-dynamic";
export const OPTIONS = options;

/** GET → { memo: latest decision memo, approvals: pending + recent } */
export async function GET() {
  const [memo] = await sql`select id, naive_session_id, markdown, ranked, created_at from decision_memos order by id desc limit 1`;
  const approvals = await sql`select id, memo_id, naive_session_id, tool_call_id, question, decision, note, decided_at, created_at from approvals order by id desc limit 10`;
  return json({ memo: memo ?? null, pending: approvals.filter((a: any) => !a.decision), approvals });
}
