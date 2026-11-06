// JSON shapes for the API: object JSON, block JSON, board JSON, share link
// JSON. The single home of the API response forms.

import type { Pool, PoolClient } from "pg";
import { expiresDisplay, zonedParts } from "../shared/hometime.js";

export interface FieldDef {
  name: string;
  kind: "text" | "number" | "date" | "url" | "select" | "relation";
  required: boolean;
  options: string[] | null;
  target_type_id: string | null;
}

export interface ObjectJson {
  id: string;
  type_id: string;
  type_name: string;
  title: string;
  daily_date: string | null;
  properties: Record<string, unknown>;
  share_visibility: "follow" | "never";
  collection_ids: string[];
  backlinks: number;
  created_at: string;
  updated_at: string;
  blocks?: BlockJson[];
}

export interface BlockJson {
  id: string;
  object_id: string;
  kind: "text" | "quote" | "attachment";
  position: number;
  body: string | null;
  version: number;
  origin: { block_id: string; object_id: string; object_title: string; backlinks: number } | null;
  attachment: { id: string; filename: string; content_type: string; size_bytes: number } | null;
}

export async function typesOfPool(client: Pool | PoolClient): Promise<Array<{ id: string; name: string; builtin: boolean; library_order: number; fields: FieldDef[] }>> {
  const typesRes = await client.query<{ id: string; name: string; builtin: boolean; library_order: number }>(
    "SELECT id, name, builtin, library_order FROM object_types ORDER BY library_order ASC"
  );
  const fieldsRes = await client.query<{ type_id: string; name: string; kind: FieldDef["kind"]; required: boolean; options: string[] | null; target_type_id: string | null }>(
    "SELECT type_id, name, kind, required, options, target_type_id FROM type_fields ORDER BY position ASC"
  );
  return typesRes.rows.map((t) => ({
    id: t.id,
    name: t.name,
    builtin: t.builtin,
    library_order: t.library_order,
    fields: fieldsRes.rows.filter((f) => f.type_id === t.id).map((f) => ({ name: f.name, kind: f.kind, required: f.required, options: f.options, target_type_id: f.target_type_id })),
  }));
}

export async function objectJson(client: Pool | PoolClient, objectId: string, withBlocks: boolean): Promise<ObjectJson | null> {
  const res = await client.query<{ id: string; type_id: string; title: string; daily_date: string | null; share_visibility: "follow" | "never"; created_at: Date; updated_at: Date; type_name: string }>(
    `SELECT o.id, o.type_id, o.title, o.daily_date, o.share_visibility, o.created_at, o.updated_at, t.name AS type_name
     FROM objects o JOIN object_types t ON t.id = o.type_id WHERE o.id = $1`,
    [objectId]
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  const props = await client.query<{ field_name: string; value: unknown }>("SELECT field_name, value FROM properties WHERE object_id = $1", [objectId]);
  const collections = await client.query<{ collection_id: string }>("SELECT collection_id FROM collection_members WHERE object_id = $1", [objectId]);
  const backlinks = await client.query<{ n: string }>("SELECT count(*)::text AS n FROM link_edges WHERE to_object_id = $1", [objectId]);
  const json: ObjectJson = {
    id: row.id,
    type_id: row.type_id,
    type_name: row.type_name,
    title: row.title,
    daily_date: row.daily_date,
    properties: Object.fromEntries(props.rows.map((p) => [p.field_name, p.value])),
    share_visibility: row.share_visibility,
    collection_ids: collections.rows.map((c) => c.collection_id),
    backlinks: Number(backlinks.rows[0].n),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
  if (withBlocks) json.blocks = await blocksJson(client, objectId);
  return json;
}

export async function objectsJson(client: Pool | PoolClient, objectIds: string[]): Promise<ObjectJson[]> {
  const out: ObjectJson[] = [];
  for (const id of objectIds) {
    const o = await objectJson(client, id, false);
    if (o !== null) out.push(o);
  }
  return out;
}

export async function blocksJson(client: Pool | PoolClient, objectId: string): Promise<BlockJson[]> {
  const res = await client.query<{
    id: string;
    object_id: string;
    kind: "text" | "quote" | "attachment";
    position: number;
    body: string;
    version: number;
    origin_block_id: string | null;
    attachment_id: string | null;
    origin_body: string | null;
    origin_version: number | null;
    origin_object_id: string | null;
    origin_title: string | null;
    filename: string | null;
    content_type: string | null;
    size_bytes: string | null;
  }>(
    `SELECT b.id, b.object_id, b.kind, b.position,
            CASE WHEN b.kind = 'quote' THEN ob.body ELSE b.body END AS body,
            CASE WHEN b.kind = 'quote' THEN ob.version ELSE b.version END AS version,
            b.origin_block_id, b.attachment_id,
            ob.body AS origin_body, ob.version AS origin_version,
            ob.object_id AS origin_object_id,
            ot.title AS origin_title,
            a.filename, a.content_type, a.size_bytes::text
     FROM blocks b
     LEFT JOIN blocks ob ON ob.id = b.origin_block_id
     LEFT JOIN objects ot ON ot.id = ob.object_id
     LEFT JOIN attachments a ON a.id = b.attachment_id
     WHERE b.object_id = $1
     ORDER BY b.position ASC`,
    [objectId]
  );
  const out: BlockJson[] = [];
  for (const row of res.rows) {
    if (row.kind === "quote") {
      const backlinks = await client.query<{ n: string }>("SELECT count(*)::text AS n FROM link_edges WHERE to_object_id = $1", [row.origin_object_id ?? ""]);
      out.push({
        id: row.id,
        object_id: row.object_id,
        kind: "quote",
        position: row.position,
        body: row.origin_body ?? "",
        version: row.origin_version ?? 1,
        origin: {
          block_id: row.origin_block_id ?? "",
          object_id: row.origin_object_id ?? "",
          object_title: row.origin_title ?? "",
          backlinks: Number(backlinks.rows[0].n),
        },
        attachment: null,
      });
    } else if (row.kind === "attachment") {
      out.push({
        id: row.id,
        object_id: row.object_id,
        kind: "attachment",
        position: row.position,
        body: null,
        version: 1,
        origin: null,
        attachment: {
          id: row.attachment_id ?? "",
          filename: row.filename ?? "attachment",
          content_type: row.content_type ?? "application/octet-stream",
          size_bytes: Number(row.size_bytes ?? 0),
        },
      });
    } else {
      out.push({
        id: row.id,
        object_id: row.object_id,
        kind: "text",
        position: row.position,
        body: row.body,
        version: row.version,
        origin: null,
        attachment: null,
      });
    }
  }
  return out;
}

export interface ShareLinkJson {
  id: string;
  collection_id: string;
  url: string;
  status: "active" | "expired" | "revoked";
  expires_at: string;
  expires_at_display: string;
  expires_at_utc: string;
  time_zone: string;
  created_at: string;
  revoked_at: string | null;
}

export function shareLinkJson(row: { id: string; collection_id: string; token: string; expires_at: Date; status: string; created_at: Date; revoked_at: Date | null }, zone: string): ShareLinkJson {
  const status = row.status === "revoked" ? "revoked" : row.expires_at.getTime() <= Date.now() ? "expired" : "active";
  const p = zonedParts(row.expires_at, zone);
  return {
    id: row.id,
    collection_id: row.collection_id,
    url: `/s/${row.token}`,
    status,
    expires_at: `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`,
    expires_at_display: expiresDisplay(row.expires_at, zone),
    expires_at_utc: row.expires_at.toISOString(),
    time_zone: zone,
    created_at: row.created_at.toISOString(),
    revoked_at: row.revoked_at === null ? null : row.revoked_at.toISOString(),
  };
}

export interface BoardJson {
  collection_id: string;
  cards: Array<{ object_id: string; title: string; x: number; y: number; stored: boolean }>;
  edges: Array<{ id: number; from: string; to: string }>;
}

export async function boardJson(client: Pool | PoolClient, collectionId: string): Promise<BoardJson | null> {
  const members = await client.query<{ id: string; title: string; x: number | null; y: number | null }>(
    `SELECT o.id, o.title, p.x, p.y
     FROM collection_members m
     JOIN objects o ON o.id = m.object_id
     LEFT JOIN board_positions p ON p.collection_id = m.collection_id AND p.object_id = m.object_id
     WHERE m.collection_id = $1
     ORDER BY lower(o.title) ASC, o.id ASC`,
    [collectionId]
  );
  if (members.rows.length === 0) {
    const coll = await client.query("SELECT id FROM collections WHERE id = $1", [collectionId]);
    if (coll.rows.length === 0) return null;
  }
  const cards = members.rows.map((r, i) => ({
    object_id: r.id,
    title: r.title,
    x: r.x !== null && r.y !== null ? r.x : 16 + (i % 4) * 256,
    y: r.x !== null && r.y !== null ? r.y : 16 + Math.floor(i / 4) * 192,
    stored: r.x !== null && r.y !== null,
  }));
  const edges = await client.query<{ id: string; from_object_id: string; to_object_id: string }>(
    `SELECT e.id::text AS id, e.from_object_id, e.to_object_id
     FROM link_edges e
     JOIN collection_members m1 ON m1.object_id = e.from_object_id AND m1.collection_id = $1
     JOIN collection_members m2 ON m2.object_id = e.to_object_id AND m2.collection_id = $1`,
    [collectionId]
  );
  return {
    collection_id: collectionId,
    cards,
    edges: edges.rows.map((e) => ({ id: Number(e.id), from: e.from_object_id, to: e.to_object_id })),
  };
}
