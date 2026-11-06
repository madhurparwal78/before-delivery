import type { Client } from "./db.ts";
import type { Ctx } from "./scope.ts";
import { instantInZone } from "./tz.ts";
import { codePointLength, isBlank, isUnstorableText } from "./text.ts";
import { ApiError } from "./errors.ts";
import type { AttachmentJson } from "./domain.ts";

export interface MessageJson {
  id: number;
  channel_id: string;
  author_id: string;
  body: string;
  thread_root_id: number | null;
  reply_count: number;
  mentions: string[];
  created_at: string;
  attachments: AttachmentJson[];
  client_key: string | null;
}

interface MessageRow {
  id: string;
  channel_id: string;
  author_id: string;
  body: string;
  thread_root_id: string | null;
  mentions: string[];
  created_at: Date;
  deleted: boolean;
  client_key: string | null;
}

export async function messageById(client: Client, id: number): Promise<MessageRow | null> {
  const res = await client.query<MessageRow>(
    "SELECT id, channel_id, author_id, body, thread_root_id, mentions, created_at, deleted, client_key FROM messages WHERE id = $1",
    [id]
  );
  return res.rows[0] ?? null;
}

export async function messageJsonFor(client: Client, row: MessageRow, viewerId: string, zone: string): Promise<MessageJson> {
  const atts = await attachmentsFor(client, "message", [String(row.id)]);
  const replyCount = await client.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM messages WHERE thread_root_id = $1 AND NOT deleted",
    [row.id]
  );
  return {
    id: Number(row.id),
    channel_id: row.channel_id,
    author_id: row.author_id,
    body: row.body,
    thread_root_id: row.thread_root_id ? Number(row.thread_root_id) : null,
    reply_count: Number(replyCount.rows[0].n),
    mentions: row.mentions ?? [],
    created_at: instantInZone(zone, Date.parse(row.created_at.toISOString())),
    attachments: atts.get(String(row.id)) ?? [],
    client_key: row.author_id === viewerId ? row.client_key : null,
  };
}

export async function attachmentsFor(
  client: Client,
  parentType: "issue" | "message" | "doc",
  parentIds: string[]
): Promise<Map<string, AttachmentJson[]>> {
  const map = new Map<string, AttachmentJson[]>();
  if (parentIds.length === 0) return map;
  const res = await client.query<{ id: string; parent_id: string; filename: string; size: string; content_type: string }>(
    "SELECT id, parent_id, filename, size, content_type FROM attachments WHERE parent_type = $1 AND parent_id = ANY($2::text[]) ORDER BY created_at, id",
    [parentType, parentIds]
  );
  for (const row of res.rows) {
    const list = map.get(row.parent_id) ?? [];
    list.push({
      id: row.id,
      filename: row.filename,
      size: Number(row.size),
      content_type: row.content_type,
      parent: { type: parentType, id: row.parent_id },
    });
    map.set(row.parent_id, list);
  }
  return map;
}

export interface DocJson {
  id: string;
  project_id: string;
  title: string;
  body: string;
  version: number;
  updated_by: string | null;
  updated_at: string;
  attachments: AttachmentJson[];
}

export async function docJsonFor(client: Client, docId: string, zone: string): Promise<DocJson | null> {
  const res = await client.query<{
    id: string;
    project_id: string;
    title: string;
    body: string;
    version: number;
    updated_by: string | null;
    updated_at: Date;
  }>("SELECT id, project_id, title, body, version, updated_by, updated_at FROM docs WHERE id = $1", [docId]);
  if (res.rows.length === 0) return null;
  const atts = await attachmentsFor(client, "doc", [docId]);
  const row = res.rows[0];
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    body: row.body,
    version: row.version,
    updated_by: row.updated_by,
    updated_at: instantInZone(zone, Date.parse(row.updated_at.toISOString())),
    attachments: atts.get(docId) ?? [],
  };
}

export interface RoomJson {
  id: string;
  name: string;
  kind: "open" | "private";
  x: number;
  y: number;
  w: number;
  h: number;
  occupants: { person_id: string; name: string; status: "active" | "away" }[];
}

export async function roomJson(client: Client, roomId: string): Promise<RoomJson | null> {
  const res = await client.query<{ id: string; name: string; kind: string; x: number; y: number; w: number; h: number }>(
    "SELECT id, name, kind, x, y, w, h FROM rooms WHERE id = $1",
    [roomId]
  );
  if (res.rows.length === 0) return null;
  const room = res.rows[0];
  const occ = await client.query<{ person_id: string; name: string; status: string }>(
    `SELECT o.person_id, p.name, COALESCE(pr.status, 'active') AS status
     FROM room_occupants o JOIN people p ON p.id = o.person_id
     LEFT JOIN presence pr ON pr.person_id = o.person_id
     WHERE o.room_id = $1 ORDER BY p.name`,
    [roomId]
  );
  return {
    id: room.id,
    name: room.name,
    kind: room.kind as "open" | "private",
    x: room.x,
    y: room.y,
    w: room.w,
    h: room.h,
    occupants: occ.rows.map((o) => ({
      person_id: o.person_id,
      name: o.name,
      status: o.status === "away" ? "away" : "active",
    })),
  };
}

export interface KnockJson {
  id: string;
  room_id: string;
  person_id: string;
  status: "waiting" | "let_in" | "not_now" | "expired";
  created_at: string;
  expires_at: string;
}

export function knockStatusOf(status: string): KnockJson["status"] {
  return status === "waiting" || status === "let_in" || status === "not_now" ? status : "expired";
}

export function knockJson(row: { id: string; room_id: string; person_id: string; status: string; created_at: Date }, zone: string, ttlSeconds: number): KnockJson {
  const createdAt = Date.parse(row.created_at.toISOString());
  const expiresAt = createdAt + ttlSeconds * 1000;
  return {
    id: row.id,
    room_id: row.room_id,
    person_id: row.person_id,
    status: knockStatusOf(row.status),
    created_at: instantInZone(zone, createdAt),
    expires_at: instantInZone(zone, expiresAt),
  };
}

export interface InviteJson {
  id: string;
  email: string;
  role: string;
  project_ids: string[];
  channel_ids: string[];
  status: "pending" | "accepted" | "revoked" | "expired";
  created_at: string;
  expires_at: string;
  workspace_name: string;
}

export function inviteStatusOf(
  row: { status: string; created_at: Date },
  ttlSeconds: number,
  nowMs: number
): InviteJson["status"] {
  if (row.status !== "pending") return row.status as InviteJson["status"];
  const created = Date.parse(row.created_at.toISOString());
  if (created + ttlSeconds * 1000 <= nowMs) return "expired";
  return "pending";
}

export function inviteJson(
  client: Client,
  row: { id: string; email: string; role: string; project_ids: string[]; channel_ids: string[]; status: string; created_at: Date },
  zone: string,
  ttlSeconds: number,
  workspaceName: string,
  nowMs: number
): InviteJson {
  const created = Date.parse(row.created_at.toISOString());
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    project_ids: row.project_ids ?? [],
    channel_ids: row.channel_ids ?? [],
    status: inviteStatusOf(row, ttlSeconds, nowMs),
    created_at: instantInZone(zone, created),
    expires_at: instantInZone(zone, created + ttlSeconds * 1000),
    workspace_name: workspaceName,
  };
}

/** Field validation helpers shared by handlers. */
export function requireNonBlankText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string" || isBlank(value)) {
    const message = "That field is required.";
    throw new ApiError("validation", message, { [field]: message });
  }
  if (isUnstorableText(value)) {
    throw new ApiError("validation", "That text cannot be stored.", { [field]: "That text cannot be stored." });
  }
  const len = codePointLength(value);
  if (len < min || len > max) {
    const message = `Use ${min} to ${max} characters.`;
    throw new ApiError("validation", message, { [field]: message });
  }
  return value;
}

export function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError("validation", "That text cannot be stored.", { [field]: "That text cannot be stored." });
  }
  if (isUnstorableText(value)) {
    throw new ApiError("validation", "That text cannot be stored.", { [field]: "That text cannot be stored." });
  }
  const len = codePointLength(value);
  if (len > max) {
    const message = `Use up to ${max} characters.`;
    throw new ApiError("validation", message, { [field]: message });
  }
  return value;
}
