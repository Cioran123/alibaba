/**
 * procurement-ops MCP server (Streamable HTTP). Declared on Naive agents as mcp_servers[{name:'procops', url}]
 * with a vault static_bearer credential; Naive injects "Authorization: Bearer <MCP_SHARED_SECRET>".
 * Tools are gated in Naive as "procops.<tool>".
 */
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { sql, audit, limits, advanceStage } from "@/lib/db";
import { checkOffer } from "@/lib/limits";
import { draftZh, memoCompose } from "@/lib/llm";
import { sendEmail } from "@/lib/agentmail";
import { recordOutbound } from "@/lib/channels";
import { DEVICES } from "@/lib/mobilerun";

export const maxDuration = 120;

const json = (x: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(x, null, 1) }] });
const COMPANY = process.env.COMPANY_NAME || "Sentinel Care";

async function supplierLedger(id: number) {
  const [supplier] = await sql`select * from suppliers where id = ${id}`;
  if (!supplier) return { error: `supplier ${id} not found` };
  const contacts = await sql`select channel, handle, label from supplier_contacts where supplier_id = ${id}`;
  const convs = await sql`select id, channel, external_thread_id, naive_session_id, state, next_followup_at from conversations where supplier_id = ${id} order by id`;
  const conversations = [];
  for (const c of convs) {
    const messages = await sql`select id, direction, sent_by, body_original, body_en, ts, screenshot_url from messages where conversation_id = ${c.id} order by ts desc limit 30`;
    conversations.push({ ...c, messages: messages.reverse() });
  }
  const quotes = await sql`select * from quotes where supplier_id = ${id} order by id`;
  const pending_jobs = await sql`select id, kind, status, payload->>'contact' as contact, left(payload->>'text', 120) as text, created_at from device_jobs where (payload->>'supplier_id')::int = ${id} and status in ('queued','running') order by id`;
  return { supplier, contacts, conversations, quotes, pending_jobs };
}

async function overviewLedger() {
  const suppliers = await sql`
    select s.id, s.name, s.source, s.country, s.years, s.verified, s.trade_assurance, s.stage,
      (select json_agg(json_build_object('channel', c.channel, 'handle', c.handle)) from supplier_contacts c where c.supplier_id = s.id) as contacts,
      (select json_build_object('direction', m.direction, 'text', coalesce(m.body_en, m.body_original), 'ts', m.ts)
         from messages m join conversations cv on cv.id = m.conversation_id where cv.supplier_id = s.id order by m.ts desc limit 1) as last_message,
      (select json_agg(q.*) from quotes q where q.supplier_id = s.id) as quotes
    from suppliers s where s.stage <> 'found' order by s.id`;
  const [{ found }] = await sql`select count(*)::int as found from suppliers where stage = 'found'`;
  return { company: COMPANY, suppliers, not_yet_contacted: found };
}

const QuoteInput = z.object({
  supplier_id: z.number().int(),
  message_id: z.number().int().optional(),
  unit_price: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  moq: z.number().int().nullable().optional(),
  lead_time_days: z.number().int().nullable().optional(),
  certs: z.array(z.string()).optional(),
  sample_cost: z.number().nullable().optional(),
  sample_lead_days: z.number().int().nullable().optional(),
  payment_terms: z.string().nullable().optional(),
  incoterm: z.string().nullable().optional(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
  notes: z.string().optional(),
});

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "ledger_read",
      { title: "Read ledger", description: "Load a supplier's full thread, contacts, recorded quotes, pending phone jobs and the authority limits. Omit supplier_id for the overview of every contacted supplier.", inputSchema: z.object({ supplier_id: z.number().int().optional() }) },
      async ({ supplier_id }) => json({ authority_limits: await limits(), ...(supplier_id ? await supplierLedger(supplier_id) : await overviewLedger()) }),
    );

    server.registerTool(
      "draft_zh",
      { title: "Draft Chinese", description: "Turn an intent into a natural, polite Chinese B2B message (WeChat / Alibaba chat tone). Returns text_zh and its English translation.", inputSchema: z.object({ intent: z.string(), context: z.string().default("") }) },
      async ({ intent, context }) => json(await draftZh(intent, context)),
    );

    server.registerTool(
      "email_send",
      { title: "Send email", description: "Send an email to the supplier's email contact via AgentMail (replies in-thread when a thread exists). An AI disclosure is appended automatically.", inputSchema: z.object({ supplier_id: z.number().int(), subject: z.string(), text: z.string() }) },
      async ({ supplier_id, subject, text }) => {
        const [c] = await sql`select handle, label from supplier_contacts where supplier_id = ${supplier_id} and channel = 'email' limit 1`;
        if (!c) return json({ ok: false, error: "no email contact for this supplier; use alibaba_send or wechat_send" });
        const [last] = await sql`select m.external_id, cv.external_thread_id from messages m join conversations cv on cv.id = m.conversation_id where cv.supplier_id = ${supplier_id} and cv.channel = 'email' and m.direction = 'in' order by m.ts desc limit 1`;
        const r: any = await sendEmail({ to: c.handle, subject, text, replyToMessageId: last?.external_id ?? null });
        const threadId = r.threadId ?? last?.external_thread_id ?? `email:${c.handle}`;
        const out = await recordOutbound({ supplierId: supplier_id, channel: "email", externalThreadId: threadId, externalId: r.messageId ?? `out:${threadId}:${Date.now()}`, body: text, sentBy: "agent" });
        await audit("tool.email_send", { supplier_id, to: c.handle, messageId: r.messageId });
        return json({ ok: true, to: c.handle, thread_id: threadId, message_id: out.messageId });
      },
    );

    server.registerTool(
      "alibaba_send",
      { title: "Send Alibaba chat", description: "Queue a message to the supplier in the Alibaba.com app (sent by the phone agent within minutes; check pending_jobs in ledger_read).", inputSchema: z.object({ supplier_id: z.number().int(), text: z.string() }) },
      async ({ supplier_id, text }) => {
        const [s] = await sql`select name from suppliers where id = ${supplier_id}`;
        const [c] = await sql`select handle from supplier_contacts where supplier_id = ${supplier_id} and channel = 'alibaba' limit 1`;
        if (!s) return json({ ok: false, error: "unknown supplier" });
        if (!DEVICES.android) return json({ ok: false, error: "Alibaba phone not configured" });
        const [job] = await sql`insert into device_jobs(device_id, kind, payload) values (${DEVICES.android}, 'alibaba_send', ${JSON.stringify({ supplier_id, contact: s.name, url: c?.handle ?? null, text })}::jsonb) returning id`;
        await audit("tool.alibaba_send", { supplier_id, job: job.id });
        return json({ ok: true, job_id: job.id, status: "queued", note: "The phone agent sends this within a few minutes. Do not resend." });
      },
    );

    server.registerTool(
      "wechat_send",
      { title: "Send WeChat", description: "Queue a Chinese WeChat message to the supplier's WeChat contact (sent on a real phone within minutes). Requires a wechat contact; otherwise use alibaba_send or email_send.", inputSchema: z.object({ supplier_id: z.number().int(), text_zh: z.string(), text_en: z.string().optional() }) },
      async ({ supplier_id, text_zh, text_en }) => {
        const [c] = await sql`select handle from supplier_contacts where supplier_id = ${supplier_id} and channel = 'wechat' limit 1`;
        if (!c) return json({ ok: false, error: "no WeChat contact for this supplier yet; ask for their WeChat ID via alibaba_send or email_send" });
        if (!DEVICES.iphone) return json({ ok: false, error: "WeChat phone not configured" });
        const [{ n }] = await sql`select count(*)::int as n from device_jobs where kind = 'wechat_send' and created_at > now() - interval '1 day'`;
        if (n >= 30) return json({ ok: false, error: "daily WeChat send cap reached (30)" });
        const [job] = await sql`insert into device_jobs(device_id, kind, payload) values (${DEVICES.iphone}, 'wechat_send', ${JSON.stringify({ supplier_id, contact: c.handle, text: text_zh, text_en: text_en ?? null })}::jsonb) returning id`;
        await audit("tool.wechat_send", { supplier_id, job: job.id });
        return json({ ok: true, job_id: job.id, status: "queued", note: "The phone agent sends this within a few minutes. Do not resend." });
      },
    );

    server.registerTool(
      "record_quote",
      { title: "Record quote", description: "Save commercial terms the supplier stated (price, MOQ, lead time, samples, certs, payment terms). Call before replying.", inputSchema: QuoteInput },
      async (q) => {
        const [row] = await sql`insert into quotes(supplier_id, message_id, unit_price, currency, moq, lead_time_days, certs, sample_cost, sample_lead_days, payment_terms, incoterm, confidence, raw)
          values (${q.supplier_id}, ${q.message_id ?? null}, ${q.unit_price ?? null}, ${q.currency ?? null}, ${q.moq ?? null}, ${q.lead_time_days ?? null}, ${q.certs ?? []}, ${q.sample_cost ?? null}, ${q.sample_lead_days ?? null}, ${q.payment_terms ?? null}, ${q.incoterm ?? null}, ${q.confidence ?? "medium"}, ${JSON.stringify(q)}::jsonb) returning id`;
        await advanceStage(q.supplier_id, "negotiating");
        await audit("tool.record_quote", { supplier_id: q.supplier_id, quote_id: row.id });
        return json({ ok: true, quote_id: row.id });
      },
    );

    server.registerTool(
      "propose_offer",
      { title: "Check offer against authority", description: "MUST be called before proposing any price, quantity, sample spend, incoterm or payment terms. Returns ok=false with the reason when the founder must decide.", inputSchema: z.object({ supplier_id: z.number().int(), unit_price_usd: z.number().optional(), moq: z.number().int().optional(), sample_spend_usd: z.number().optional(), incoterm: z.string().optional(), payment_terms: z.string().optional() }) },
      async (o) => {
        const r = await checkOffer(o);
        await audit("tool.propose_offer", { ...o, ...r });
        return json(r.ok ? { ok: true, note: "within authority; you may propose this" } : { ok: false, reason: r.reason, say: "I need to confirm this with our founder and will get back to you." });
      },
    );

    server.registerTool(
      "memo_compose",
      { title: "Compose decision memo", description: "Rank every supplier with quotes and write the founder decision memo. Returns memo_id, markdown, recommended_supplier_id, ranked.", inputSchema: z.object({ session_id: z.string().optional() }) },
      async ({ session_id }) => {
        const L = await limits();
        const ov = await overviewLedger();
        const memo = await memoCompose({ company: COMPANY, target_qty: Number(L.target_qty ?? 500), limits: L, suppliers: ov.suppliers });
        const [row] = await sql`insert into decision_memos(naive_session_id, markdown, ranked) values (${session_id ?? null}, ${memo.markdown}, ${JSON.stringify({ ranked: memo.ranked, recommended_supplier_id: memo.recommended_supplier_id, proposed_next_step: memo.proposed_next_step })}::jsonb) returning id`;
        if (memo.recommended_supplier_id) await advanceStage(memo.recommended_supplier_id, "recommended");
        await audit("tool.memo_compose", { memo_id: row.id });
        return json({ memo_id: row.id, ...memo });
      },
    );
  },
  { serverInfo: { name: "procurement-ops", version: "0.1.0" } },
);

function guard(req: Request) {
  const secret = process.env.MCP_SHARED_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (secret && auth !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  return handler(req);
}

export { guard as GET, guard as POST };
