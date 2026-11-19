import { one, pool } from "../db.js";
import { deleteMessage } from "../domain/deletion.js";
import { editMessage } from "../domain/edits.js";
import { pageParams } from "../domain/cursor.js";
import { isUuid } from "../domain/ids.js";
import { loadMessage, loadMessages, threadPage, visibleMessage } from "../domain/messages.js";
import { receiptsFor, recordReceipts, versionsOf } from "../domain/receipts.js";
import { cancelScheduled } from "../domain/schedule.js";
import { search } from "../domain/search.js";
import { ApiError } from "../errors.js";
import { openStream } from "../events.js";
import { empty, json, publicRoute, route, type Reply } from "../http.js";
import { healthBody } from "../services/health.js";
import { getObject, objectKeys } from "../services/s3.js";
import type { Viewer } from "../http.js";

async function attachmentBytes(viewer: Viewer, id: string, which: "original" | "thumb"): Promise<Reply> {
  if (!isUuid(id)) throw new ApiError("not_found");
  const attachment = await one<{ id: string; workspace_id: string; message_id: string; content_type: string }>(
    pool,
    `SELECT a.id, a.workspace_id, a.message_id, a.content_type FROM attachments a
      WHERE a.id = $1 AND a.state = 'stored' AND a.workspace_id = $3
        AND EXISTS (SELECT 1 FROM memberships m WHERE m.channel_id = a.channel_id AND m.user_id = $2)`,
    [id, viewer.id, viewer.workspace.id],
  );
  if (!attachment) throw new ApiError("not_found");
  const keys = objectKeys(attachment.workspace_id, attachment.message_id, attachment.id);
  const body = await getObject(which === "original" ? keys.original : keys.thumb);
  return {
    kind: "bytes",
    status: 200,
    body,
    headers: {
      "Content-Type": which === "original" ? attachment.content_type : "image/jpeg",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  };
}

export function registerMessageRoutes(): void {
  route("GET", "/api/messages/:id", async ({ viewer, params }) => {
    const access = await visibleMessage(pool, viewer, params.id ?? "");
    return json(200, { message: await loadMessage(pool, access.id) });
  });

  route("PATCH", "/api/messages/:id", async ({ viewer, params, body }) => json(200, { message: await editMessage(viewer, params.id ?? "", body) }));

  route("DELETE", "/api/messages/:id", async ({ viewer, params }) => {
    await deleteMessage(viewer, params.id ?? "");
    return empty();
  });

  route("GET", "/api/messages/:id/thread", async ({ viewer, params, url }) => {
    const root = await visibleMessage(pool, viewer, params.id ?? "", { allowPlaceholder: true });
    if (root.thread_root_id !== null) throw new ApiError("not_found");
    const page = await threadPage(pool, root.id, pageParams(url));
    const rootJson = (await loadMessages(pool, [root.id])).get(root.id);
    if (!rootJson || (rootJson.deleted && rootJson.reply_count === 0)) throw new ApiError("not_found");
    return json(200, { root: rootJson, replies: page.items, next_cursor: page.next_cursor });
  });

  route("GET", "/api/messages/:id/versions", async ({ viewer, params }) => {
    const access = await visibleMessage(pool, viewer, params.id ?? "");
    return json(200, { versions: await versionsOf(access.id) });
  });

  route("GET", "/api/messages/:id/receipts", async ({ viewer, params }) => json(200, await receiptsFor(viewer, params.id ?? "")));

  route("POST", "/api/receipts", async ({ viewer, body }) => json(200, { updated: await recordReceipts(viewer, body) }));

  route("DELETE", "/api/scheduled/:id", async ({ viewer, params }) => json(200, { scheduled: await cancelScheduled(viewer, params.id ?? "") }));

  route("GET", "/api/search", async ({ viewer, url }) => json(200, await search(viewer, url.searchParams.get("q"), pageParams(url))));

  route("GET", "/api/attachments/:id", async ({ viewer, params }) => attachmentBytes(viewer, params.id ?? "", "original"));

  route("GET", "/api/attachments/:id/thumb", async ({ viewer, params }) => attachmentBytes(viewer, params.id ?? "", "thumb"));

  route("GET", "/api/events", (ctx) => openStream(ctx));

  publicRoute("GET", "/api/health", async () => json(200, await healthBody()));
}
