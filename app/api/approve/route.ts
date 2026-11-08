import { answerQuestion, confirmTool } from "@/lib/naive";
import { sql, audit, advanceStage } from "@/lib/db";
import { json, options, readBody } from "@/lib/http";
import { dashboardAuthorized, unauthorized } from "@/lib/auth";

export const OPTIONS = options;

/** POST {approval_id, decision: proceed|counter|reject, note?, supplier_id?} → resumes the Head session. */
export async function POST(req: Request) {
  if (!dashboardAuthorized(req)) return unauthorized();
  const b = await readBody(req);
  const approvalId = Number(b.approval_id);
  const decision = String(b.decision || "proceed");
  const note = String(b.note || "");
  const [a] = await sql`select * from approvals where id = ${approvalId}`;
  if (!a) return json({ error: "approval not found" }, { status: 404 });
  if (a.decision) return json({ error: "already decided", decision: a.decision }, { status: 409 });

  const q = a.question ?? {};
  let result: any;
  if (q.kind === "tool") {
    result = await confirmTool(a.naive_session_id, a.tool_call_id, decision === "reject" ? "deny" : "allow", note || undefined);
  } else {
    const [memo] = a.memo_id ? await sql`select ranked from decision_memos where id = ${a.memo_id}` : [null];
    const recommended = memo?.ranked?.recommended_supplier_id ?? null;
    const supplierId = b.supplier_id ? String(b.supplier_id) : recommended ? String(recommended) : "";
    const fields: any[] = q.question?.fields ?? q.args?.fields ?? [];
    const answers: Record<string, string> = {};
    for (const f of fields) {
      const key = String(f.key ?? f.name ?? "");
      if (!key) continue;
      if (/decision|choice|action/i.test(key)) answers[key] = decision;
      else if (/supplier/i.test(key)) answers[key] = supplierId || "as recommended";
      else answers[key] = note || "Proceed as recommended.";
    }
    if (!Object.keys(answers).length) answers.decision = decision;
    result = await answerQuestion(a.naive_session_id, a.tool_call_id, answers);
    if (supplierId && /^\d+$/.test(supplierId)) await advanceStage(Number(supplierId), decision === "reject" ? "rejected" : decision === "proceed" ? "approved" : "negotiating");
  }
  await sql`update approvals set decision = ${decision}, note = ${note}, decided_at = now() where id = ${approvalId}`;
  await sql`update conversations set state = 'open' where naive_session_id = ${a.naive_session_id}`;
  await audit("founder.decision", { approvalId, decision, note });
  if ((req.headers.get("content-type") || "").includes("form")) {
    const back = new URL("/ops", req.url);
    if (process.env.DASHBOARD_TOKEN) back.searchParams.set("token", process.env.DASHBOARD_TOKEN);
    return Response.redirect(back, 303);
  }
  return json({ ok: true, decision, session: { id: result?.id, status: result?.status, stop_reason: result?.stop_reason } });
}
