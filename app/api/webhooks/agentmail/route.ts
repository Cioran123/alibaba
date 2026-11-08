import { verifyAgentMailWebhook, getMessage, messageText } from "@/lib/agentmail";
import { ingestInbound } from "@/lib/channels";
import { audit } from "@/lib/db";
import { json } from "@/lib/http";

export const maxDuration = 60;

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyAgentMailWebhook(raw, req.headers, process.env.AGENTMAIL_WEBHOOK_SECRET)) return json({ error: "bad signature" }, { status: 401 });
  const evt = JSON.parse(raw);
  const type: string = evt.eventType ?? evt.event_type ?? evt.type ?? "";
  if (!type.startsWith("message.received")) {
    await audit(`agentmail.${type || "unknown"}`, { eventId: evt.eventId });
    return json({ ignored: type });
  }
  let m = evt.message ?? {};
  if (!messageText(m) && m.messageId) {
    try { m = await getMessage(m.messageId); } catch {}
  }
  const fromRaw: string = Array.isArray(m.from) ? m.from[0] : String(m.from ?? "");
  const from = (fromRaw.match(/<([^>]+)>/)?.[1] ?? fromRaw).trim().toLowerCase();
  const body = messageText(m) || "(empty message)";
  const attachments = (m.attachments ?? []).map((a: any) => a.filename).filter(Boolean);
  const r = await ingestInbound({
    channel: "email", from, externalThreadId: m.threadId ?? `email:${from}`, externalId: m.messageId ?? evt.eventId,
    body: m.subject ? `Subject: ${m.subject}\n\n${body}` : body, ts: m.timestamp ? new Date(m.timestamp) : undefined,
    attachmentsText: attachments.length ? `Attachments: ${attachments.join(", ")}` : null,
  });
  return json(r);
}
