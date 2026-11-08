import { sql } from "@/lib/db";
import { json, options } from "@/lib/http";

export const dynamic = "force-dynamic";
export const OPTIONS = options;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sid = Number(id);
  const [supplier] = await sql`select * from suppliers where id = ${sid}`;
  if (!supplier) return json({ error: "not found" }, { status: 404 });
  const contacts = await sql`select channel, handle, label from supplier_contacts where supplier_id = ${sid}`;
  const convs = await sql`select id, channel, external_thread_id, naive_session_id, state, next_followup_at from conversations where supplier_id = ${sid} order by id`;
  const conversations = [];
  for (const c of convs) {
    const messages = await sql`select id, direction, sent_by, body_original, body_en, attachments, screenshot_url, ts from messages where conversation_id = ${c.id} order by ts`;
    conversations.push({ ...c, messages });
  }
  const quotes = await sql`select * from quotes where supplier_id = ${sid} order by id`;
  const jobs = await sql`select id, kind, status, error, created_at, finished_at from device_jobs where (payload->>'supplier_id')::int = ${sid} order by id desc limit 20`;
  return json({ supplier, contacts, conversations, quotes, jobs });
}
