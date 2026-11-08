import { AgentMailClient } from "agentmail";
import { createHmac, timingSafeEqual } from "node:crypto";

export const agentmail = new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY });
export const INBOX = process.env.AGENTMAIL_INBOX_ID || "";

const DISCLOSURE =
  "\n\n--\nThis message was sent by an AI procurement assistant on behalf of a human founder. " +
  "Reply to this email to reach us; reply \"unsubscribe\" and we will not write again.";

export async function sendEmail(p: { to: string; subject: string; text: string; replyToMessageId?: string | null }) {
  if (!INBOX) throw new Error("AGENTMAIL_INBOX_ID is not set");
  const text = p.text.includes("AI procurement assistant") ? p.text : p.text + DISCLOSURE;
  if (p.replyToMessageId) {
    return agentmail.inboxes.messages.reply(INBOX, p.replyToMessageId, { text } as any);
  }
  return agentmail.inboxes.messages.send(INBOX, { to: [p.to], subject: p.subject, text } as any);
}

export async function getMessage(messageId: string) {
  return agentmail.inboxes.messages.get(INBOX, messageId);
}

/**
 * Verify an AgentMail (Svix-style) webhook: headers svix-id / svix-timestamp / svix-signature ("v1,<base64>"),
 * signed content "{id}.{timestamp}.{body}", key = base64(secret without the "whsec_" prefix).
 * Returns true when the secret is not configured (dev), false on a bad signature.
 */
export function verifyAgentMailWebhook(rawBody: string, headers: Headers, secret: string | undefined) {
  if (!secret) return true;
  const id = headers.get("svix-id") ?? headers.get("webhook-id");
  const ts = headers.get("svix-timestamp") ?? headers.get("webhook-timestamp");
  const sig = headers.get("svix-signature") ?? headers.get("webhook-signature");
  if (!id || !ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest();
  return sig.split(" ").some((part) => {
    const [, b64] = part.split(",");
    if (!b64) return false;
    const got = Buffer.from(b64, "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/** Best-effort plain text from a received message payload. */
export function messageText(m: any): string {
  return (m?.extractedText || m?.text || m?.preview || "").toString().trim();
}
