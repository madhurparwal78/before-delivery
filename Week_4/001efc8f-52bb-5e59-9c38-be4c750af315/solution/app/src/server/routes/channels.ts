import { pool, rows } from "../db.js";
import { channelFor, channelsFor, memberChannel } from "../domain/channels.js";
import { encodeCursor, instantCursor, pageParams } from "../domain/cursor.js";
import { addMember, channelMembers, removeMember } from "../domain/membership.js";
import { attachmentUrls, historyPage } from "../domain/messages.js";
import { pinMessage, unpinMessage } from "../domain/pins.js";
import { schedulePost, scheduledFor } from "../domain/schedule.js";
import { sendMessage } from "../domain/send.js";
import { empty, json, route } from "../http.js";
import { objectBody } from "./people.js";

export function registerChannelRoutes(): void {
  route("GET", "/api/channels", async ({ viewer }) => json(200, { channels: await channelsFor(pool, viewer.id) }));

  route("GET", "/api/channels/:id", async ({ viewer, params }) => {
    const channel = await memberChannel(pool, viewer, params.id ?? "");
    return json(200, { channel: await channelFor(pool, channel.id, viewer.id), members: await channelMembers(viewer, channel.id) });
  });

  route("POST", "/api/channels/:id/members", async ({ viewer, params, body }) => {
    const channel = await memberChannel(pool, viewer, params.id ?? "");
    return json(201, { member: await addMember(viewer, channel, objectBody(body)) });
  });

  route("DELETE", "/api/channels/:id/members/:userId", async ({ viewer, params }) => {
    const channel = await memberChannel(pool, viewer, params.id ?? "");
    await removeMember(viewer, channel, params.userId ?? "");
    return empty();
  });

  route("GET", "/api/channels/:id/messages", async ({ viewer, params, url }) => {
    const channel = await memberChannel(pool, viewer, params.id ?? "");
    const page = await historyPage(pool, channel.id, pageParams(url));
    return json(200, { messages: page.items, next_cursor: page.next_cursor });
  });

  route(
    "POST",
    "/api/channels/:id/messages",
    async ({ viewer, params, body }) => {
      const channel = await memberChannel(pool, viewer, params.id ?? "");
      const result = await sendMessage(viewer, channel, body);
      return json(201, { message: result.message }, result.replay ? { "Rimewire-Replay": "true" } : undefined);
    },
    { multipart: true },
  );

  route("POST", "/api/channels/:id/pins", async ({ viewer, params, body }) => {
    const channel = await memberChannel(pool, viewer, params.id ?? "");
    return json(201, { pinned_message_ids: await pinMessage(viewer, channel, body) });
  });

  route("DELETE", "/api/channels/:id/pins/:messageId", async ({ viewer, params }) => {
    const channel = await memberChannel(pool, viewer, params.id ?? "");
    await unpinMessage(viewer, channel, params.messageId ?? "");
    return empty();
  });

  route("GET", "/api/channels/:id/gallery", async ({ viewer, params, url }) => {
    const channel = await memberChannel(pool, viewer, params.id ?? "");
    const page = pageParams(url);
    const cursor = instantCursor(page.before, 2);
    const found = await rows<{ id: string; message_id: string; filename: string; content_type: string; bytes: number; uploader_id: string; uploader_name: string; uploaded_at: Date }>(
      pool,
      `SELECT a.id, a.message_id, a.filename, a.content_type, a.bytes, u.id AS uploader_id, u.name AS uploader_name, a.uploaded_at
         FROM attachments a JOIN users u ON u.id = a.uploaded_by
        WHERE a.channel_id = $1 AND a.state = 'stored'
          ${cursor ? "AND (a.uploaded_at, a.id::text) < ($3::timestamptz, $4)" : ""}
        ORDER BY a.uploaded_at DESC, a.id::text DESC LIMIT $2`,
      cursor ? [channel.id, page.limit + 1, cursor[0], cursor[1]] : [channel.id, page.limit + 1],
    );
    const pageRows = found.slice(0, page.limit);
    const last = pageRows[pageRows.length - 1];
    return json(200, {
      photos: pageRows.map((a) => ({
        attachment_id: a.id, message_id: a.message_id, filename: a.filename, content_type: a.content_type, bytes: a.bytes,
        uploaded_by: { id: a.uploader_id, name: a.uploader_name }, uploaded_at: a.uploaded_at.toISOString(), ...attachmentUrls(a.id),
      })),
      next_cursor: found.length > page.limit && last ? encodeCursor([last.uploaded_at.toISOString(), last.id]) : null,
    });
  });

  route("GET", "/api/channels/:id/scheduled", async ({ viewer, params }) => {
    const channel = await memberChannel(pool, viewer, params.id ?? "");
    return json(200, { scheduled: await scheduledFor(channel.id) });
  });

  route("POST", "/api/channels/:id/scheduled", async ({ viewer, params, body }) => {
    const channel = await memberChannel(pool, viewer, params.id ?? "");
    return json(201, { scheduled: await schedulePost(viewer, channel, objectBody(body)) });
  });
}
