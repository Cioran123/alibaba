import { sql } from "@/lib/db";
import { json, options } from "@/lib/http";

export const dynamic = "force-dynamic";
export const OPTIONS = options;

/** GET → [{id, name, stage, source, country, channels[], last_message, quote, session_id}] */
export async function GET() {
  const rows = await sql`
    select s.id, s.name, s.stage, s.source, s.country, s.years, s.verified, s.trade_assurance, s.score, s.updated_at,
      (select array_agg(distinct c.channel) from supplier_contacts c where c.supplier_id = s.id) as channels,
      (select json_build_object('direction', m.direction, 'channel', cv.channel, 'text', coalesce(m.body_en, m.body_original), 'original', m.body_original, 'ts', m.ts)
         from messages m join conversations cv on cv.id = m.conversation_id where cv.supplier_id = s.id order by m.ts desc limit 1) as last_message,
      (select json_build_object('unit_price', q.unit_price, 'currency', q.currency, 'moq', q.moq, 'lead_time_days', q.lead_time_days, 'sample_cost', q.sample_cost, 'certs', q.certs)
         from quotes q where q.supplier_id = s.id order by q.id desc limit 1) as quote,
      (select cv.naive_session_id from conversations cv where cv.supplier_id = s.id and cv.naive_session_id is not null limit 1) as session_id,
      (select count(*)::int from messages m join conversations cv on cv.id = m.conversation_id where cv.supplier_id = s.id) as message_count
    from suppliers s order by case s.stage when 'approved' then 0 when 'recommended' then 1 when 'negotiating' then 2 when 'replied' then 3 when 'contacted' then 4 when 'found' then 5 else 6 end, s.updated_at desc`;
  const [stats] = await sql`select
      (select count(*)::int from suppliers) as suppliers,
      (select count(*)::int from suppliers where stage <> 'found') as contacted,
      (select count(*)::int from suppliers where stage in ('replied','negotiating','recommended','approved','ordered')) as replied,
      (select count(*)::int from quotes) as quotes,
      (select count(*)::int from messages where sent_by = 'agent') as agent_messages,
      (select count(*)::int from approvals where decision is not null) as human_decisions,
      (select count(*)::int from approvals where decision is null) as pending_approvals`;
  return json({ stats, suppliers: rows });
}
