import { now } from "../clock.js";
import { one, pool, rows, tx } from "../db.js";
import { ApiError } from "../errors.js";
import { logEvents } from "../events.js";
import type { Viewer } from "../http.js";
import { channelUpdates, messageEvents } from "./fanout.js";
import { visibleMessage } from "./messages.js";
import { processRemovals, queueAttachmentRemoval } from "./removalQueue.js";
import { moderates } from "./roles.js";

const REMOVAL_BUDGET_MS = 1_500;

// Deleting a message removes it everywhere in one transaction and queues its stored objects;
// the objects go before the 204 when storage answers within the budget.
export async function deleteMessage(viewer: Viewer, id: string): Promise<void> {
  const access = await visibleMessage(pool, viewer, id);
  if (access.author_id !== viewer.id && !moderates(viewer.role)) throw new ApiError("forbidden");

  const keys = await tx(async (client) => {
    const row = await visibleMessage(client, viewer, id, { forUpdate: true });
    const attachments = await rows<{ id: string; workspace_id: string; message_id: string }>(
      client,
      "SELECT id, workspace_id, message_id FROM attachments WHERE message_id = $1 AND state = 'stored'",
      [row.id],
    );
    const queued = await queueAttachmentRemoval(client, attachments);
    for (const table of ["message_versions", "reads", "deliveries", "mentions"]) {
      await client.query(`DELETE FROM ${table} WHERE message_id = $1`, [row.id]);
    }
    const keepsReplies =
      row.thread_root_id === null && (await one(client, "SELECT 1 FROM messages WHERE thread_root_id = $1 AND deleted_at IS NULL LIMIT 1", [row.id]));
    if (keepsReplies) {
      await client.query("UPDATE messages SET deleted_at = $2, text = '', pinned_by = NULL, pinned_at = NULL WHERE id = $1", [row.id, now()]);
    } else {
      await client.query("DELETE FROM messages WHERE id = $1", [row.id]);
    }
    await logEvents(client, async () => [
      { workspaceId: row.workspace_id, channelId: row.channel_id, userId: null, name: "message.deleted", payload: { message_id: row.id, channel_id: row.channel_id } },
      ...(row.thread_root_id ? await messageEvents(client, "message.updated", row.workspace_id, row.channel_id, [row.thread_root_id]) : []),
      ...(await channelUpdates(client, row.workspace_id, row.channel_id, null)),
    ]);
    return queued;
  });

  if (keys.length > 0) {
    await Promise.race([
      processRemovals(keys, REMOVAL_BUDGET_MS).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, REMOVAL_BUDGET_MS + 100)),
    ]);
  }
}
