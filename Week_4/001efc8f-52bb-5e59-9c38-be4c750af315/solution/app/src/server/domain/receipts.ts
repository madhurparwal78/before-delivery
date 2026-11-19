import { now } from "../clock.js";
import { pool, rows, tx } from "../db.js";
import { ApiError, FIELD, invalid, type FieldErrors } from "../errors.js";
import { logEvents, type LoggedEvent } from "../events.js";
import type { Body, Viewer } from "../http.js";
import { recipientsJoin } from "./counts.js";
import { channelUpdates, messageEvents } from "./fanout.js";
import { isUuid } from "./ids.js";
import { loadMessages, visibleMessage } from "./messages.js";
import { moderates } from "./roles.js";

const MAX_IDS = 100;

// Delivery and read reports. A read is recorded against the version current when it arrives,
// once per person and version; reports about one's own messages change nothing.
export async function recordReceipts(viewer: Viewer, body: Body): Promise<number> {
  const value = body.kind === "json" && typeof body.value === "object" && body.value !== null ? (body.value as Record<string, unknown>) : {};
  const ids = value.message_ids;
  const state = value.state;
  const wellFormed = Array.isArray(ids) ? [...new Set(ids.filter(isUuid).map((id) => id.toLowerCase()))] : [];
  const readable = await rows<{ id: string; author_id: string; channel_id: string; workspace_id: string }>(
    pool,
    `SELECT m.id, m.author_id, m.channel_id, m.workspace_id FROM messages m
      WHERE m.id = ANY($1::uuid[]) AND m.deleted_at IS NULL AND m.workspace_id = $3
        AND EXISTS (SELECT 1 FROM memberships mb WHERE mb.channel_id = m.channel_id AND mb.user_id = $2)`,
    [wellFormed, viewer.id, viewer.workspace.id],
  );
  if (readable.length !== wellFormed.length) throw new ApiError("not_found");
  const errors: FieldErrors = {};
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_IDS || ids.some((id) => !isUuid(id))) errors.message_ids = FIELD.messageIds;
  if (state !== "delivered" && state !== "read") errors.state = FIELD.state;
  if (Object.keys(errors).length > 0) throw invalid(errors);

  return tx(async (client) => {
    const at = now();
    const changed: typeof readable = [];
    for (const message of readable) {
      if (message.author_id === viewer.id) continue;
      const delivered = await client.query(
        `INSERT INTO deliveries (message_id, user_id, delivered_at) VALUES ($1, $2, $3)
         ON CONFLICT (message_id, user_id) DO UPDATE SET delivered_at = EXCLUDED.delivered_at WHERE deliveries.delivered_at IS NULL`,
        [message.id, viewer.id, at],
      );
      let didChange = state === "delivered" && (delivered.rowCount ?? 0) > 0;
      if (state === "read") {
        const read = await client.query(
          `INSERT INTO reads (message_id, user_id, version, read_at)
           SELECT id, $2, version, $3 FROM messages WHERE id = $1 ON CONFLICT DO NOTHING`,
          [message.id, viewer.id, at],
        );
        didChange = (read.rowCount ?? 0) > 0;
      }
      if (didChange) changed.push(message);
    }
    if (changed.length === 0) return 0;
    await logEvents(client, async () => {
      const events: LoggedEvent[] = [];
      const loaded = await loadMessages(client, changed.map((m) => m.id));
      for (const message of changed) {
        const counts = loaded.get(message.id);
        if (!counts || counts.deleted) continue;
        events.push({
          workspaceId: message.workspace_id, channelId: message.channel_id, userId: null, name: "receipts.updated",
          payload: { message_id: message.id, channel_id: message.channel_id, recipient_count: counts.recipient_count, delivered_count: counts.delivered_count, read_count: counts.read_count },
        });
        events.push(...(await messageEvents(client, "message.updated", message.workspace_id, message.channel_id, [message.id])));
      }
      if (state === "read") {
        for (const channelId of new Set(changed.map((m) => m.channel_id))) {
          const own = (await channelUpdates(client, viewer.workspace.id, channelId, null)).filter((e) => e.userId === viewer.id);
          events.push(...own);
        }
      }
      return events;
    });
    return changed.length;
  });
}

type ReceiptsJson = {
  message_id: string;
  sent_at: string;
  as_of: string;
  versions: { version: number; text: string; edited_by: { id: string; name: string }; created_at: string }[];
  recipients: { user: { id: string; name: string }; delivered_at: string | null; reads: { version: number; read_at: string }[] }[];
  recipient_count: number;
  delivered_count: number;
  read_count: number;
};

export async function versionsOf(messageId: string): Promise<ReceiptsJson["versions"]> {
  const found = await rows<{ version: number; text: string; editor_id: string; editor_name: string; created_at: Date }>(
    pool,
    `SELECT v.version, v.text, u.id AS editor_id, u.name AS editor_name, v.created_at
       FROM message_versions v JOIN users u ON u.id = v.edited_by WHERE v.message_id = $1 ORDER BY v.version`,
    [messageId],
  );
  return found.map((v) => ({ version: v.version, text: v.text, edited_by: { id: v.editor_id, name: v.editor_name }, created_at: v.created_at.toISOString() }));
}

// The receipts timeline, for the author and for crew leads, dispatchers and operations managers.
export async function receiptsFor(viewer: Viewer, id: string): Promise<ReceiptsJson> {
  const access = await visibleMessage(pool, viewer, id);
  if (access.author_id !== viewer.id && !moderates(viewer.role)) throw new ApiError("forbidden");
  const asOf = now();
  const message = (await loadMessages(pool, [access.id])).get(access.id);
  if (!message || message.deleted) throw new ApiError("not_found");
  const recipients = await rows<{ id: string; name: string; delivered_at: Date | null; reads: { version: number; read_at: string }[] }>(
    pool,
    `SELECT ru.id, ru.name,
            (SELECT d.delivered_at FROM deliveries d WHERE d.message_id = m.id AND d.user_id = ru.id) AS delivered_at,
            COALESCE((SELECT json_agg(json_build_object('version', r.version, 'read_at', r.read_at) ORDER BY r.read_at, r.version)
                        FROM reads r WHERE r.message_id = m.id AND r.user_id = ru.id), '[]') AS reads
       FROM messages m, ${recipientsJoin("m")} AND m.id = $1
      ORDER BY ru.name`,
    [access.id],
  );
  return {
    message_id: access.id,
    sent_at: message.sent_at,
    as_of: asOf.toISOString(),
    versions: await versionsOf(access.id),
    recipients: recipients.map((r) => ({
      user: { id: r.id, name: r.name },
      delivered_at: r.delivered_at?.toISOString() ?? null,
      reads: r.reads.map((read) => ({ version: read.version, read_at: new Date(read.read_at).toISOString() })),
    })),
    recipient_count: message.recipient_count,
    delivered_count: message.delivered_count,
    read_count: message.read_count,
  };
}
