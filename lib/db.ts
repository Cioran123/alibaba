import { neon } from "@neondatabase/serverless";

// Lazy: neon() only parses the URL; a missing DATABASE_URL fails at first query, not at build/import time.
export const sql = neon(process.env.DATABASE_URL || "postgresql://missing:missing@localhost/missing");

export async function audit(kind: string, payload: unknown) {
  await sql`insert into audit_events(kind, payload) values (${kind}, ${JSON.stringify(payload)}::jsonb)`;
}

export type Stage =
  | "found" | "contacted" | "replied" | "negotiating" | "recommended" | "approved" | "ordered" | "rejected";

const ORDER: Stage[] = ["found", "contacted", "replied", "negotiating", "recommended", "approved", "ordered", "rejected"];

/** Move a supplier forward only (never back), except to `rejected`. */
export async function advanceStage(supplierId: number, stage: Stage) {
  const [row] = await sql`select stage from suppliers where id = ${supplierId}`;
  if (!row) return;
  const cur = row.stage as Stage;
  if (stage !== "rejected" && ORDER.indexOf(stage) <= ORDER.indexOf(cur)) return;
  await sql`update suppliers set stage = ${stage}, updated_at = now() where id = ${supplierId}`;
}

/** Find or create the conversation for a supplier on a channel. */
export async function getConversation(supplierId: number, channel: string, externalThreadId: string) {
  const rows = await sql`
    insert into conversations(supplier_id, channel, external_thread_id)
    values (${supplierId}, ${channel}, ${externalThreadId})
    on conflict (channel, external_thread_id) do update set supplier_id = excluded.supplier_id
    returning *`;
  return rows[0];
}

/** Insert a message; returns null if external_id was already seen. */
export async function insertMessage(m: {
  conversationId: number; direction: "in" | "out"; externalId: string; bodyOriginal: string;
  bodyEn?: string | null; attachments?: unknown; screenshotUrl?: string | null; sentBy: "agent" | "human" | "supplier"; ts?: Date;
}) {
  const rows = await sql`
    insert into messages(conversation_id, direction, external_id, body_original, body_en, attachments, screenshot_url, sent_by, ts)
    values (${m.conversationId}, ${m.direction}, ${m.externalId}, ${m.bodyOriginal}, ${m.bodyEn ?? null},
            ${m.attachments ? JSON.stringify(m.attachments) : null}::jsonb, ${m.screenshotUrl ?? null}, ${m.sentBy}, ${m.ts ?? new Date()})
    on conflict (external_id) do nothing
    returning *`;
  return rows[0] ?? null;
}

export async function limits(): Promise<Record<string, any>> {
  const rows = await sql`select key, value from authority_limits`;
  return Object.fromEntries(rows.map((r: any) => [r.key, r.value]));
}
