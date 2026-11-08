/**
 * Inbound ingestion shared by every channel (AgentMail webhook, WeChat/Alibaba phone sweeps):
 * normalize → Neon (idempotent) → wake the supplier's Envoy session (or create one).
 */
import { sql, audit, advanceStage, getConversation, insertMessage, limits } from "./db";
import { fenceSupplierText, sendToSession, startSession } from "./naive";
import { translateToEn } from "./llm";

export type Channel = "email" | "wechat" | "alibaba";

export async function resolveSupplier(channel: Channel, handle: string): Promise<number | null> {
  const rows = await sql`select supplier_id from supplier_contacts where channel = ${channel} and lower(handle) = lower(${handle}) limit 1`;
  if (rows[0]) return rows[0].supplier_id;
  // WeChat/Alibaba contacts are named "S012 ..." — match by the S-prefix code in the remark.
  const m = handle.match(/\bS(\d{3})\b/);
  if (m) {
    const r2 = await sql`select id from suppliers where id = ${Number(m[1])}`;
    if (r2[0]) return r2[0].id;
  }
  const r3 = await sql`select supplier_id from conversations where channel = ${channel} and external_thread_id = ${handle} limit 1`;
  if (r3[0]) return r3[0].supplier_id;
  // Alibaba sweeps return "Rep Name (Company Co., Ltd.)" or just the company; match the company part against supplier names.
  const candidates = [handle, ...(handle.match(/\(([^)]+)\)/g) ?? []).map((m) => m.slice(1, -1)), handle.replace(/\s*\([^)]*\)\s*/g, "")]
    .map((c) => c.trim()).filter((c) => c.length >= 4);
  for (const cand of candidates) {
    const r4 = await sql`select supplier_id from supplier_contacts where lower(label) = lower(${cand}) limit 1`;
    if (r4[0]) return r4[0].supplier_id;
    const r5 = await sql`select id from suppliers where lower(name) = lower(${cand}) or lower(${cand}) like lower(name) || '%' or lower(name) like lower(${cand}) || '%' or lower(name) like '%' || lower(${cand}) || '%' or lower(${cand}) like '%' || lower(name) || '%' order by id limit 1`;
    if (r5[0]) return r5[0].id;
    // company-name core: drop legal suffixes and compare the first 3 words
    const core = cand.toLowerCase().replace(/\b(co\.?|ltd\.?|limited|technology|electronics?|electronic|trading|industrial|inc\.?|corp\.?)\b/g, " ").replace(/[.,]/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 3).join(" ");
    if (core.length >= 6) {
      const r6 = await sql`select id from suppliers where lower(name) like '%' || ${core} || '%' order by id limit 1`;
      if (r6[0]) return r6[0].id;
    }
  }
  return null;
}

export async function ingestInbound(p: {
  channel: Channel;
  from: string;                 // email address | WeChat remark | Alibaba supplier name
  externalThreadId: string;     // AgentMail thread_id | remark | supplier name
  externalId: string;           // provider message id or a stable hash
  body: string;
  ts?: Date;
  screenshotUrl?: string | null;
  attachmentsText?: string | null;
  supplierId?: number | null;
}) {
  let supplierId = p.supplierId ?? (await resolveSupplier(p.channel, p.from));
  if (!supplierId) {
    const [s] = await sql`insert into suppliers(name, source, stage, notes) values (${`Unknown (${p.from})`}, 'inbound', 'replied', 'auto-created from inbound message') returning id`;
    supplierId = s.id;
    await sql`insert into supplier_contacts(supplier_id, channel, handle) values (${supplierId}, ${p.channel}, ${p.from}) on conflict do nothing`;
  }
  const conv = await getConversation(supplierId!, p.channel, p.externalThreadId);
  const bodyEn = await translateToEn(p.body).catch(() => null);
  const msg = await insertMessage({
    conversationId: conv.id, direction: "in", externalId: p.externalId, bodyOriginal: p.body, bodyEn,
    screenshotUrl: p.screenshotUrl ?? null, sentBy: "supplier", ts: p.ts,
    attachments: p.attachmentsText ? { text: p.attachmentsText } : undefined,
  });
  if (!msg) return { duplicate: true as const, conversationId: conv.id, supplierId };

  await advanceStage(supplierId!, "replied");
  await sql`update conversations set state = 'open' where id = ${conv.id}`;
  await audit("inbound", { channel: p.channel, from: p.from, supplierId, messageId: msg.id });

  const text = fenceSupplierText(p.channel, p.from, redact(p.body) + (bodyEn && bodyEn !== p.body ? `\n\n[EN] ${redact(bodyEn)}` : ""), p.attachmentsText ? `Attachment text:\n${redact(p.attachmentsText).slice(0, 4000)}` : undefined);
  let sessionId: string | null = conv.naive_session_id;
  if (sessionId) {
    await sendToSession(sessionId, `${await ledgerSnapshot(supplierId!)}\n\n${text}`);
  } else {
    sessionId = await ensureEnvoySession(conv.id, text);
  }
  return { duplicate: false as const, conversationId: conv.id, supplierId, messageId: msg.id, sessionId };
}

/** Strip contact-like data (emails, phones, WeChat ids) so agent-facing text never looks like "people's data". */
export function redact(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/(\+?\d[\d\s-]{8,}\d)/g, "[phone]")
    .replace(/(微信|wechat|wx)\s*(id|号)?\s*[:：]?\s*[A-Za-z][\w-]{4,}/gi, "$1: [wechat-id]");
}

/**
 * Compact ledger snapshot delivered INSIDE the session message, so the agent never needs a read tool
 * (Naive flags chats that read contacts/messages through tools and then asks on every later tool call).
 */
export async function ledgerSnapshot(supplierId: number): Promise<string> {
  const [s] = await sql`select id, name, source, country, years, verified, trade_assurance, stage from suppliers where id = ${supplierId}`;
  if (!s) return `supplier ${supplierId}: not found`;
  const chans = await sql`select distinct channel from supplier_contacts where supplier_id = ${supplierId}`;
  const quotes = await sql`select unit_price, currency, moq, lead_time_days, certs, sample_cost, payment_terms, incoterm, created_at from quotes where supplier_id = ${supplierId} order by id`;
  const log = await sql`select cv.channel, m.direction, coalesce(m.body_en, m.body_original) as text, m.ts from messages m join conversations cv on cv.id = m.conversation_id where cv.supplier_id = ${supplierId} order by m.ts desc limit 12`;
  const jobs = await sql`select kind, status from device_jobs where (payload->>'supplier_id')::int = ${supplierId} and status in ('queued','running')`;
  const L = await limits();
  const lines = [
    `LEDGER SNAPSHOT — supplier #${s.id} ${s.name} (${s.source}, ${s.country ?? "?"}, ${s.years ?? "?"} yrs, verified=${s.verified}, trade_assurance=${s.trade_assurance}) stage=${s.stage}`,
    `channels available: ${chans.map((c: any) => c.channel).join(", ") || "none"}${jobs.length ? ` | queued phone jobs: ${jobs.map((j: any) => j.kind).join(", ")} (do not resend)` : ""}`,
    `authority limits: max unit price $${L.max_unit_price_usd}, max MOQ ${L.max_moq}, max sample spend $${L.max_sample_spend_usd}, incoterms ${(L.allowed_incoterms || []).join("/")}, payment ${(L.allowed_payment_terms || []).join(" | ")}, target qty ${L.target_qty}`,
    quotes.length ? `recorded quotes: ${quotes.map((q: any) => `${q.unit_price ?? "?"} ${q.currency ?? ""} @MOQ ${q.moq ?? "?"} lead ${q.lead_time_days ?? "?"}d sample ${q.sample_cost ?? "?"} certs ${(q.certs || []).join("/")} terms ${q.payment_terms ?? "?"}`).join("; ")}` : "recorded quotes: none yet",
    log.length ? `recent negotiation log (newest first):\n${log.map((m: any) => `  ${m.direction === "in" ? "SUPPLIER" : "US"} [${m.channel}, ${new Date(m.ts).toISOString().slice(0, 16)}]: ${redact(String(m.text)).slice(0, 400)}`).join("\n")}` : "negotiation log: no messages yet",
  ];
  return lines.join("\n");
}

/** Overview snapshot for the Head agent: every contacted supplier with quotes, in one message. */
export async function overviewSnapshot(): Promise<string> {
  const rows = await sql`select id from suppliers where stage <> 'found' order by id`;
  if (!rows.length) return "OVERVIEW: no supplier has been contacted yet.";
  const parts = [];
  for (const r of rows) parts.push(await ledgerSnapshot(r.id));
  return `OVERVIEW of ${rows.length} contacted suppliers:\n\n${parts.join("\n\n")}`;
}

/** Create the Envoy session for a conversation if NAIVE_ENVOY_AGENT_ID is set; stores naive_session_id. */
export async function ensureEnvoySession(conversationId: number, firstMessage?: string): Promise<string | null> {
  const agentId = process.env.NAIVE_ENVOY_AGENT_ID;
  const [conv] = await sql`select c.*, s.name as supplier_name from conversations c join suppliers s on s.id = c.supplier_id where c.id = ${conversationId}`;
  if (!conv) return null;
  if (conv.naive_session_id) return conv.naive_session_id;
  if (!agentId) return null;
  const intro =
    `You are now handling supplier #${conv.supplier_id} "${conv.supplier_name}" on channel ${conv.channel} (conversation ${conversationId}).\n\n` +
    (await ledgerSnapshot(conv.supplier_id)) + (firstMessage ? `\n\n${firstMessage}` : "");
  const s = await startSession(agentId, intro, { supplier_id: conv.supplier_id, conversation_id: conversationId, channel: conv.channel });
  await sql`update conversations set naive_session_id = ${s.id} where id = ${conversationId}`;
  await audit("session.created", { conversationId, sessionId: s.id });
  return s.id;
}

/** Record an outbound message we sent (any channel). */
export async function recordOutbound(p: { supplierId: number; channel: Channel; externalThreadId: string; externalId: string; body: string; sentBy: "agent" | "human"; bodyEn?: string | null; screenshotUrl?: string | null }) {
  const conv = await getConversation(p.supplierId, p.channel, p.externalThreadId);
  const msg = await insertMessage({ conversationId: conv.id, direction: "out", externalId: p.externalId, bodyOriginal: p.body, bodyEn: p.bodyEn ?? null, sentBy: p.sentBy, screenshotUrl: p.screenshotUrl ?? null });
  await advanceStage(p.supplierId, "contacted");
  await sql`update conversations set state = 'waiting_supplier' where id = ${conv.id}`;
  return { conversationId: conv.id, messageId: msg?.id ?? null };
}
