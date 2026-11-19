import { randomUUID } from "node:crypto";
import type pg from "pg";
import { addSeconds, now } from "../clock.js";
import { config } from "../config.js";
import { LOCK, lock, one, pool, tx } from "../db.js";
import { ApiError, FIELD, invalid, type FieldErrors } from "../errors.js";
import { logEvents } from "../events.js";
import type { Body, Viewer } from "../http.js";
import { SEND_FIELDS, SEND_FILE_PART, unacceptedKeys } from "./acceptedFields.js";
import type { MemberChannel } from "./channels.js";
import { channelUpdates, messageEvents } from "./fanout.js";
import { isUuid } from "./ids.js";
import { loadMessage, type MessageJson } from "./messages.js";
import { recordMentions } from "./mentions.js";
import { acceptPhotos, uploadDigest, type ProcessedPhoto, type Upload } from "./photos.js";
import { discardObjects } from "./removalQueue.js";
import { startsTopLevel } from "./roles.js";
import { checkSendRate } from "./sendRate.js";
import { objectKeys, putObject } from "../services/s3.js";

export const TEXT_LIMIT = 4_000;

type SendRequest = {
  keys: string[];
  clientMessageId: unknown;
  text: unknown;
  threadRootId: unknown;
  quotedMessageId: unknown;
  uploads: Upload[];
};

type SendResult = { message: MessageJson; replay: boolean };

function readRequest(body: Body): SendRequest {
  if (body.kind === "multipart") {
    const fields = new Map<string, string>();
    const keys: string[] = [];
    for (const part of body.parts) {
      if (!keys.includes(part.name)) keys.push(part.name);
      if (part.name !== SEND_FILE_PART && !fields.has(part.name)) fields.set(part.name, part.data.toString("utf8"));
    }
    const optional = (name: string) => (fields.get(name) ? fields.get(name) : null);
    return {
      keys,
      clientMessageId: fields.get("client_message_id") ?? null,
      text: fields.get("text") ?? "",
      threadRootId: optional("thread_root_id"),
      quotedMessageId: optional("quoted_message_id"),
      uploads: body.parts.filter((p) => p.name === SEND_FILE_PART).map((p) => ({ filename: p.filename, data: p.data })),
    };
  }
  const value = body.kind === "json" && typeof body.value === "object" && body.value !== null && !Array.isArray(body.value) ? (body.value as Record<string, unknown>) : null;
  if (!value) throw invalid({});
  return {
    keys: Object.keys(value),
    clientMessageId: value.client_message_id ?? null,
    text: value.text ?? "",
    threadRootId: value.thread_root_id ?? null,
    quotedMessageId: value.quoted_message_id ?? null,
    uploads: [],
  };
}

const trimmed = (text: unknown) => (typeof text === "string" ? text.trim() : null);

function fingerprint(request: SendRequest): string {
  const photos = request.uploads.map((u) => uploadDigest(u.data)).sort();
  return JSON.stringify([trimmed(request.text), request.threadRootId, request.quotedMessageId, photos]);
}

// A stored send for this author and id answers as a replay, a conflict, or message_deleted.
async function priorSend(db: pg.Pool | pg.PoolClient, authorId: string, request: SendRequest): Promise<SendResult | null> {
  if (!isUuid(request.clientMessageId)) return null;
  const prior = await one<{ message_id: string; fingerprint: string; live: boolean }>(
    db,
    `SELECT s.message_id, s.fingerprint,
            EXISTS (SELECT 1 FROM messages m WHERE m.id = s.message_id AND m.deleted_at IS NULL) AS live
       FROM send_ids s WHERE s.author_id = $1 AND s.client_message_id = $2`,
    [authorId, request.clientMessageId.toLowerCase()],
  );
  if (!prior) return null;
  if (prior.fingerprint !== fingerprint(request)) throw new ApiError("client_message_id_conflict");
  if (!prior.live) throw new ApiError("message_deleted");
  return { message: await loadMessage(db, prior.message_id), replay: true };
}

async function liveRoot(db: pg.Pool | pg.PoolClient, channelId: string, id: string, lockRow: boolean): Promise<boolean> {
  const row = await one(db, `SELECT 1 FROM messages WHERE id = $1 AND channel_id = $2 AND thread_root_id IS NULL AND deleted_at IS NULL ${lockRow ? "FOR SHARE" : ""}`, [id, channelId]);
  return row !== undefined;
}

async function liveMessage(db: pg.Pool | pg.PoolClient, channelId: string, id: string, lockRow: boolean): Promise<boolean> {
  const row = await one(db, `SELECT 1 FROM messages WHERE id = $1 AND channel_id = $2 AND deleted_at IS NULL ${lockRow ? "FOR SHARE" : ""}`, [id, channelId]);
  return row !== undefined;
}

async function validate(request: SendRequest, channelId: string): Promise<{ errors: FieldErrors; photos: ProcessedPhoto[] }> {
  const fieldErrors: FieldErrors = {};
  if (!isUuid(request.clientMessageId)) fieldErrors.client_message_id = FIELD.clientMessageId;
  const text = trimmed(request.text);
  if (text === null || (text === "" && request.uploads.length === 0)) fieldErrors.text = FIELD.textEmpty;
  else if ([...text].length > TEXT_LIMIT) fieldErrors.text = FIELD.textLong;
  if (request.threadRootId !== null && !(isUuid(request.threadRootId) && (await liveRoot(pool, channelId, request.threadRootId, false)))) {
    fieldErrors.thread_root_id = FIELD.threadRootId;
  }
  if (request.quotedMessageId !== null && !(isUuid(request.quotedMessageId) && (await liveMessage(pool, channelId, request.quotedMessageId, false)))) {
    fieldErrors.quoted_message_id = FIELD.quotedMessageId;
  }
  let photos: ProcessedPhoto[] = [];
  if (request.uploads.length > 0) {
    const verdict = await acceptPhotos(request.uploads);
    if ("reason" in verdict) fieldErrors.files = verdict.reason;
    else photos = verdict.photos;
  }
  // Entries follow the request's key order; errors for missing keys come after.
  const errors: FieldErrors = {};
  const unaccepted = unacceptedKeys(request.keys, [...SEND_FIELDS, SEND_FILE_PART]);
  for (const key of request.keys) {
    const copy = unaccepted[key] ?? fieldErrors[key === SEND_FILE_PART ? "files" : key];
    if (copy) errors[key === SEND_FILE_PART ? "files" : key] = copy;
  }
  for (const [key, copy] of Object.entries(fieldErrors)) if (!(key in errors)) errors[key] = copy;
  return { errors, photos };
}

export async function sendMessage(viewer: Viewer, channel: MemberChannel, body: Body): Promise<SendResult> {
  const receivedAt = now();
  const request = readRequest(body);
  if (request.threadRootId === null && !startsTopLevel(viewer.role, channel.kind)) throw new ApiError("broadcast_only");
  const replay = await priorSend(pool, viewer.id, request);
  if (replay) return replay;
  await checkSendRate(pool, viewer.id, receivedAt);
  const { errors, photos } = await validate(request, channel.id);
  if (Object.keys(errors).length > 0) throw invalid(errors);

  const messageId = randomUUID();
  const written: string[] = [];
  const stored = photos.map((photo) => {
    const id = randomUUID();
    return { ...photo, id, keys: objectKeys(channel.workspace_id, messageId, id) };
  });
  try {
    for (const photo of stored) {
      await putObject(photo.keys.original, photo.original, photo.contentType);
      written.push(photo.keys.original);
      await putObject(photo.keys.thumb, photo.thumb, "image/jpeg");
      written.push(photo.keys.thumb);
    }
  } catch (error) {
    await discardObjects(written);
    throw error;
  }

  const text = trimmed(request.text) ?? "";
  const threadRootId = (request.threadRootId as string | null)?.toLowerCase() ?? null;
  const quotedId = (request.quotedMessageId as string | null)?.toLowerCase() ?? null;
  try {
    return await tx(async (client) => {
      await lock(client, LOCK.author, viewer.id);
      const raced = await priorSend(client, viewer.id, request);
      if (raced) return raced;
      const sentAt = now();
      await checkSendRate(client, viewer.id, receivedAt);
      if (threadRootId && !(await liveRoot(client, channel.id, threadRootId, true))) throw invalid({ thread_root_id: FIELD.threadRootId });
      if (quotedId && !(await liveMessage(client, channel.id, quotedId, true))) throw invalid({ quoted_message_id: FIELD.quotedMessageId });
      await client.query(
        `INSERT INTO messages (id, workspace_id, channel_id, author_id, client_message_id, via_send, text, version, sent_at, editable_until, thread_root_id, quoted_message_id)
         VALUES ($1, $2, $3, $4, $5, true, $6, 1, $7, $8, $9, $10)`,
        [messageId, channel.workspace_id, channel.id, viewer.id, (request.clientMessageId as string).toLowerCase(), text, sentAt,
          addSeconds(sentAt, config.editWindowSeconds), threadRootId, quotedId],
      );
      await client.query("INSERT INTO send_ids (author_id, client_message_id, message_id, fingerprint) VALUES ($1, $2, $3, $4)", [
        viewer.id, (request.clientMessageId as string).toLowerCase(), messageId, fingerprint(request),
      ]);
      await storeMessageRecords(client, { id: messageId, channelId: channel.id, authorId: viewer.id, text, sentAt });
      for (const [position, photo] of stored.entries()) {
        await client.query(
          `INSERT INTO attachments (id, message_id, workspace_id, channel_id, position, filename, content_type, bytes, width, height, upload_sha256, uploaded_by, uploaded_at, state)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'stored')`,
          [photo.id, messageId, channel.workspace_id, channel.id, position, photo.filename, photo.contentType, photo.original.length,
            photo.width, photo.height, photo.uploadSha256, viewer.id, sentAt],
        );
      }
      await logEvents(client, () => createdEvents(client, channel.workspace_id, channel.id, messageId, viewer.id, threadRootId));
      return { message: await loadMessage(client, messageId), replay: false };
    }).then(async (result) => {
      if (result.replay) await discardObjects(written);
      return result;
    });
  } catch (error) {
    await discardObjects(written);
    throw error;
  }
}

// Version 1, one delivery record per current recipient, and the mentions in the text as sent.
export async function storeMessageRecords(client: pg.PoolClient, message: { id: string; channelId: string; authorId: string; text: string; sentAt: Date }): Promise<void> {
  await client.query("INSERT INTO message_versions (message_id, version, text, edited_by, created_at) VALUES ($1, 1, $2, $3, $4)", [
    message.id, message.text, message.authorId, message.sentAt,
  ]);
  await client.query("INSERT INTO deliveries (message_id, user_id) SELECT $1, user_id FROM memberships WHERE channel_id = $2 AND user_id <> $3", [
    message.id, message.channelId, message.authorId,
  ]);
  await recordMentions(client, message);
}

export async function createdEvents(client: pg.PoolClient, workspaceId: string, channelId: string, messageId: string, authorId: string, threadRootId: string | null) {
  return [
    ...(await messageEvents(client, "message.created", workspaceId, channelId, [messageId])),
    ...(threadRootId ? await messageEvents(client, "message.updated", workspaceId, channelId, [threadRootId]) : []),
    ...(await channelUpdates(client, workspaceId, channelId, authorId)),
  ];
}
