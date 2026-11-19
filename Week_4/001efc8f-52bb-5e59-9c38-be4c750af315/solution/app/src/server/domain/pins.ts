import { now } from "../clock.js";
import { one, pool, rows, tx, type Queryable } from "../db.js";
import { ApiError, FIELD, invalid } from "../errors.js";
import { logEvents } from "../events.js";
import type { Body, Viewer } from "../http.js";
import type { MemberChannel } from "./channels.js";
import { channelUpdates, messageEvents } from "./fanout.js";
import { isUuid } from "./ids.js";
import { moderates } from "./roles.js";

const PIN_LIMIT = 3;

async function pinnedIds(db: Queryable, channelId: string): Promise<string[]> {
  const found = await rows<{ id: string }>(
    db,
    "SELECT id FROM messages WHERE channel_id = $1 AND pinned_at IS NOT NULL AND deleted_at IS NULL ORDER BY pinned_at, id::text",
    [channelId],
  );
  return found.map((r) => r.id);
}

const LIVE_IN_CHANNEL = "SELECT id, pinned_at FROM messages WHERE id = $1 AND channel_id = $2 AND deleted_at IS NULL";

export async function pinMessage(viewer: Viewer, channel: MemberChannel, body: Body): Promise<string[]> {
  const value = body.kind === "json" && typeof body.value === "object" && body.value !== null ? (body.value as Record<string, unknown>) : {};
  const messageId = value.message_id;
  if (isUuid(messageId) && !(await one(pool, LIVE_IN_CHANNEL, [messageId, channel.id]))) throw new ApiError("not_found");
  if (!moderates(viewer.role)) throw new ApiError("forbidden");
  if (!isUuid(messageId)) throw invalid({ message_id: FIELD.pinMessageId });

  return tx(async (client) => {
    await client.query("SELECT id FROM channels WHERE id = $1 FOR UPDATE", [channel.id]);
    const message = await one<{ id: string; pinned_at: Date | null }>(client, `${LIVE_IN_CHANNEL} FOR UPDATE`, [messageId, channel.id]);
    if (!message) throw new ApiError("not_found");
    if (message.pinned_at !== null) throw new ApiError("already_pinned");
    if ((await pinnedIds(client, channel.id)).length >= PIN_LIMIT) throw new ApiError("pin_limit");
    await client.query("UPDATE messages SET pinned_by = $2, pinned_at = $3 WHERE id = $1", [message.id, viewer.id, now()]);
    await logEvents(client, async () => [
      ...(await messageEvents(client, "message.updated", channel.workspace_id, channel.id, [message.id])),
      ...(await channelUpdates(client, channel.workspace_id, channel.id, null)),
    ]);
    return pinnedIds(client, channel.id);
  });
}

export async function unpinMessage(viewer: Viewer, channel: MemberChannel, messageId: string): Promise<void> {
  if (!isUuid(messageId) || !(await one(pool, LIVE_IN_CHANNEL, [messageId, channel.id]))) throw new ApiError("not_found");
  if (!moderates(viewer.role)) throw new ApiError("forbidden");
  await tx(async (client) => {
    await client.query("SELECT id FROM channels WHERE id = $1 FOR UPDATE", [channel.id]);
    const message = await one<{ id: string; pinned_at: Date | null }>(client, `${LIVE_IN_CHANNEL} FOR UPDATE`, [messageId, channel.id]);
    if (!message || message.pinned_at === null) throw new ApiError("not_found");
    await client.query("UPDATE messages SET pinned_by = NULL, pinned_at = NULL WHERE id = $1", [message.id]);
    await logEvents(client, async () => [
      ...(await messageEvents(client, "message.updated", channel.workspace_id, channel.id, [message.id])),
      ...(await channelUpdates(client, channel.workspace_id, channel.id, null)),
    ]);
  });
}
