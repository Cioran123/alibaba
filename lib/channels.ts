/**
 * Inbound ingestion shared by every channel (AgentMail webhook, WeChat/Alibaba phone sweeps):
 * normalize → Neon (idempotent) → wake the supplier's Envoy session (or create one).
 */
import { sql, audit, advanceStage, getConversation, insertMessage } from "./db";
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
  // Alibaba sweeps return the supplier's display name; match by contact label or supplier name (prefix-insensitive).
  const r4 = await sql`select supplier_id from supplier_contacts where lower(label) = lower(${handle}) limit 1`;
  if (r4[0]) return r4[0].supplier_id;
  const r5 = await sql`select id from suppliers where lower(name) = lower(${handle}) or lower(${handle}) like lower(name) || '%' or lower(name) like lower(${handle}) || '%' order by id limit 1`;
  return r5[0]?.id ?? null;
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

  const text = fenceSupplierText(p.channel, p.from, p.body + (bodyEn && bodyEn !== p.body ? `\n\n[EN] ${bodyEn}` : ""), p.attachmentsText ? `Attachment text:\n${p.attachmentsText.slice(0, 4000)}` : undefined);
  let sessionId: string | null = conv.naive_session_id;
  if (sessionId) {
    await sendToSession(sessionId, text);
  } else {
    sessionId = await ensureEnvoySession(conv.id, text);
  }
  return { duplicate: false as const, conversationId: conv.id, supplierId, messageId: msg.id, sessionId };
}

/** Create the Envoy session for a conversation if NAIVE_ENVOY_AGENT_ID is set; stores naive_session_id. */
export async function ensureEnvoySession(conversationId: number, firstMessage?: string): Promise<string | null> {
  const agentId = process.env.NAIVE_ENVOY_AGENT_ID;
  const [conv] = await sql`select c.*, s.name as supplier_name from conversations c join suppliers s on s.id = c.supplier_id where c.id = ${conversationId}`;
  if (!conv) return null;
  if (conv.naive_session_id) return conv.naive_session_id;
  if (!agentId) return null;
  const intro =
    `You are now handling supplier #${conv.supplier_id} "${conv.supplier_name}" on channel ${conv.channel} (conversation ${conversationId}). ` +
    `Start by calling ledger_read(supplier_id=${conv.supplier_id}).` + (firstMessage ? `\n\n${firstMessage}` : "");
  const s = await startSession(agentId, intro, { supplier_id: conv.supplier_id, conversation_id: conversationId, channel: conv.channel });
  await sql`update conversations set naive_session_id = ${s.id} where id = ${conversationId}`;
  await audit("session.created", { conversationId, sessionId: s.id });
  return s.id;
}

/** Record an outbound message we sent (any channel). */
export async function recordOutbound(p: { supplierId: number; channel: Channel; externalThreadId: string; externalId: string; body: string; sentBy: "agent" | "human"; bodyEn?: string | null }) {
  const conv = await getConversation(p.supplierId, p.channel, p.externalThreadId);
  const msg = await insertMessage({ conversationId: conv.id, direction: "out", externalId: p.externalId, bodyOriginal: p.body, bodyEn: p.bodyEn ?? null, sentBy: p.sentBy });
  await advanceStage(p.supplierId, "contacted");
  await sql`update conversations set state = 'waiting_supplier' where id = ${conv.id}`;
  return { conversationId: conv.id, messageId: msg?.id ?? null };
}
