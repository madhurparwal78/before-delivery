// Resource handlers for the API: types, objects, blocks, quotes, presence,
// revisions, daily notes, attachments, collections, boards, share links,
// saved queries, graph, search and timeline.

import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { Ctx } from "./context.js";
import type { LiveSync } from "./sync.js";
import { recordEvent } from "./sync.js";
import { HttpError, header, readBody, jsonBody, type ApiRequest, type RouteResult } from "./api-utils.js";
import { objectJson, blocksJson, boardJson, shareLinkJson, typesOfPool, type FieldDef } from "./serialize.js";
import { shareStatus, loadShareLink, newShareToken, shareScopeIds } from "./share.js";
import {
  BlockError,
  commitBlockEdit,
  createTextBlock,
  deleteTextBlock,
  moveBlock,
  createQuote,
  removeQuote,
  deleteObjectEntirely,
  backlinkCount,
  blockQuoteCount,
  opsValidShape,
  touchObject,
  type SaveBlockInput,
} from "./blocks.js";
import { sanitizeBody, plainText, editText, type Op } from "../shared/richtext.js";
import { wordDiff } from "../shared/worddiff.js";
import { parseQuery, evalQuery, compareByKind, type QueryObject, type FieldDef as QFieldDef, QUERY_TEXT_CAP } from "../shared/query.js";
import { rankSearch, tokens, SEARCH_CAP } from "../shared/ranking.js";
import { sniffType, safeFilename, UPLOAD_MAX_BYTES, UPLOAD_MAX_REQUEST } from "../shared/upload.js";
import { homeDate, zonedParts, localMinuteToUtc, dateTimeShort } from "../shared/hometime.js";

function validation(errors: Record<string, string>): HttpError {
  return new HttpError(422, { error: "validation", errors });
}

function isUuid(id: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);
}

function notFound(): HttpError {
  return new HttpError(404, { error: "not_found" });
}

function blockErrorToApi(e: BlockError): HttpError {
  switch (e.code) {
    case "not_found":
      return notFound();
    case "not_editable":
      return new HttpError(409, { error: "not_editable" });
    case "block_quoted":
      return new HttpError(409, { error: "block_quoted", quoted_in: e.extra?.quoted_in ?? 0 });
    case "validation":
      return validation({ [e.validationField ?? "body"]: e.messageText ?? "Invalid." });
    case "version_conflict":
    default:
      return new HttpError(409, { error: "version_conflict" });
  }
}

async function withTransaction<T>(ctx: Ctx, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await ctx.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Types

const KINDS = ["text", "number", "date", "url", "select", "relation"];

function validateFields(fields: unknown, errors: Record<string, string>): void {
  if (!Array.isArray(fields)) return;
  const seen = new Set<string>();
  fields.forEach((f, i) => {
    if (f === null || typeof f !== "object") {
      errors[`fields.${i}.name`] = "Give the field a name.";
      return;
    }
    const rec = f as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name : "";
    if (name.trim().length === 0 || name.length > 60) errors[`fields.${i}.name`] = "Give the field a name.";
    else {
      const key = name.toLowerCase();
      if (seen.has(key)) errors[`fields.${i}.name`] = "Field names must be different.";
      seen.add(key);
    }
    const kind = typeof rec.kind === "string" ? rec.kind : "";
    if (!KINDS.includes(kind)) errors[`fields.${i}.kind`] = "Choose text, number, date, url, select or relation.";
    if (kind === "select") {
      const options = rec.options;
      if (!Array.isArray(options) || options.length === 0 || !options.every((o) => typeof o === "string" && o.length > 0)) {
        errors[`fields.${i}.options`] = "Add at least one option.";
      }
    }
    if (kind === "relation" && typeof rec.target_type_id !== "string") {
      errors[`fields.${i}.target_type_id`] = "Choose the type this field links to.";
    }
  });
}

async function typeById(ctx: Ctx, typeId: string): Promise<{ id: string; name: string; builtin: boolean; fields: FieldDef[] } | null> {
  const types = await typesOfPool(ctx.pool);
  return types.find((t) => t.id === typeId) ?? null;
}

export async function handleTypes(ctx: Ctx, req: ApiRequest, method: string, path: string): Promise<RouteResult> {
  if (method === "GET" && path === "/api/types") {
    const types = await typesOfPool(ctx.pool);
    return {
      status: 200,
      body: {
        types: types.map((t) => ({
          id: t.id,
          name: t.name,
          builtin: t.builtin,
          fields: t.fields.map((f) => ({ name: f.name, kind: f.kind, required: f.required, options: f.options, target_type_id: f.target_type_id })),
        })),
      },
    };
  }
  if (method === "POST" && path === "/api/types") {
    const body = jsonBody(req);
    const errors: Record<string, string> = {};
    const name = typeof body.name === "string" ? body.name : "";
    if (name.trim().length === 0 || name.length > 60) errors.name = "Give the type a name.";
    else {
      const existing = await ctx.pool.query("SELECT id FROM object_types WHERE lower(name) = lower($1)", [name]);
      if (existing.rows.length > 0) errors.name = "A type with this name already exists.";
    }
    if (!Array.isArray(body.fields)) {
      errors.name = errors.name ?? "Give the type a name.";
      return { status: 422, body: { error: "validation", errors } };
    }
    validateFields(body.fields, errors);
    // relation targets must exist
    for (let i = 0; i < body.fields.length; i += 1) {
      const f = body.fields[i] as Record<string, unknown>;
      if (f.kind === "relation" && typeof f.target_type_id === "string") {
        const t = await ctx.pool.query("SELECT id FROM object_types WHERE id = $1", [f.target_type_id]);
        if (t.rows.length === 0) errors[`fields.${i}.target_type_id`] = "Choose the type this field links to.";
      }
    }
    if (Object.keys(errors).length > 0) throw validation(errors);
    const maxOrder = await ctx.pool.query<{ max: number | null }>("SELECT max(library_order) AS max FROM object_types");
    const order = (maxOrder.rows[0]?.max ?? -1) + 1;
    const typeId = randomUUID();
    await withTransaction(ctx, async (client) => {
      await client.query("INSERT INTO object_types (id, name, builtin, library_order, created_at) VALUES ($1, $2, FALSE, $3, now())", [typeId, name, order]);
      let pos = 0;
      for (const f of body.fields as Array<Record<string, unknown>>) {
        await client.query(
          "INSERT INTO type_fields (id, type_id, name, kind, required, options, target_type_id, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
          [randomUUID(), typeId, String(f.name), String(f.kind), f.required === true, JSON.stringify(f.options ?? null), typeof f.target_type_id === "string" ? f.target_type_id : null, pos]
        );
        pos += 1;
      }
    });
    const t = await typeById(ctx, typeId);
    if (t === null) throw notFound();
    return { status: 201, body: typeJson(t) };
  }
  const fieldMatch = /^\/api\/types\/([^/]+)\/fields$/.exec(path);
  if (method === "POST" && fieldMatch !== null) {
    const typeId = fieldMatch[1];
    const row = await ctx.pool.query<{ name: string }>("SELECT name FROM object_types WHERE id = $1", [typeId]);
    if (row.rows.length === 0) throw notFound();
    if (row.rows[0].name === "Daily note") throw new HttpError(409, { error: "builtin_type" });
    const body = jsonBody(req);
    const errors: Record<string, string> = {};
    const f = body as Record<string, unknown>;
    validateFields([f], errors);
    // bare keys on the single-field endpoint
    for (const k of Object.keys(errors).slice()) {
      errors[k.replace(/^fields\.0\./, "")] = errors[k];
      delete errors[k];
    }
    const fname = String(f.name ?? "");
    if (fname.trim().length > 0) {
      const dup = await ctx.pool.query("SELECT id FROM type_fields WHERE type_id = $1 AND lower(name) = lower($2)", [typeId, fname]);
      if (dup.rows.length > 0) errors.name = "Field names must be different.";
    }
    if (f.kind === "relation" && typeof f.target_type_id === "string") {
      const t = await ctx.pool.query("SELECT id FROM object_types WHERE id = $1", [f.target_type_id]);
      if (t.rows.length === 0) errors.target_type_id = "Choose the type this field links to.";
    }
    if (Object.keys(errors).length > 0) throw validation(errors);
    const maxPos = await ctx.pool.query<{ max: number | null }>("SELECT max(position) AS max FROM type_fields WHERE type_id = $1", [typeId]);
    await withTransaction(ctx, async (client) => {
      await client.query(
        "INSERT INTO type_fields (id, type_id, name, kind, required, options, target_type_id, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [randomUUID(), typeId, fname, String(f.kind), f.required === true, JSON.stringify(f.options ?? null), typeof f.target_type_id === "string" ? f.target_type_id : null, (maxPos.rows[0]?.max ?? -1) + 1]
      );
    });
    const t = await typeById(ctx, typeId);
    if (t === null) throw notFound();
    return { status: 201, body: typeJson(t) };
  }
  const delMatch = /^\/api\/types\/([^/]+)$/.exec(path);
  if (method === "DELETE" && delMatch !== null) {
    const typeId = delMatch[1];
    if (!isUuid(typeId)) throw notFound();
    const row = await ctx.pool.query<{ builtin: boolean }>("SELECT builtin FROM object_types WHERE id = $1", [typeId]);
    if (row.rows.length === 0) throw notFound();
    if (row.rows[0].builtin) throw new HttpError(409, { error: "builtin_type" });
    const count = await ctx.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM objects WHERE type_id = $1", [typeId]);
    if (Number(count.rows[0].n) > 0) throw new HttpError(409, { error: "type_in_use" });
    await withTransaction(ctx, async (client) => {
      await client.query("DELETE FROM object_types WHERE id = $1", [typeId]);
    });
    return { status: 204, body: null };
  }
  throw notFound();
}

function typeJson(t: { id: string; name: string; builtin: boolean; fields: FieldDef[] }): Record<string, unknown> {
  return {
    id: t.id,
    name: t.name,
    builtin: t.builtin,
    fields: t.fields.map((f) => ({ name: f.name, kind: f.kind, required: f.required, options: f.options, target_type_id: f.target_type_id })),
  };
}

// ---------------------------------------------------------------------------
// Objects

async function validateProperties(ctx: Ctx, typeId: string, properties: unknown, objectId: string | null, errors: Record<string, string>): Promise<void> {
  if (properties === undefined) return;
  if (properties === null || typeof properties !== "object" || Array.isArray(properties)) {
    errors["properties"] = "That field is not on this type.";
    return;
  }
  const t = await typeById(ctx, typeId);
  if (t === null) return;
  for (const [name, value] of Object.entries(properties as Record<string, unknown>)) {
    const field = t.fields.find((x) => x.name === name);
    if (field === undefined) {
      errors[`properties.${name}`] = "That field is not on this type.";
      continue;
    }
    if (value === null) {
      if (field.required) errors[`properties.${name}`] = "This field is required.";
      continue;
    }
    switch (field.kind) {
      case "text":
        if (typeof value !== "string") errors[`properties.${name}`] = "Use at most 2,000 characters.";
        else if (value.length > 2000) errors[`properties.${name}`] = "Use at most 2,000 characters.";
        break;
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) errors[`properties.${name}`] = "Enter a number.";
        break;
      case "date": {
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !isRealDate(value)) {
          errors[`properties.${name}`] = "Use a real date as YYYY-MM-DD.";
        }
        break;
      }
      case "url": {
        if (typeof value !== "string" || !/^https?:\/\//i.test(value)) errors[`properties.${name}`] = "Use a web address starting with http or https.";
        break;
      }
      case "select": {
        if (typeof value !== "string" || !(field.options ?? []).includes(value)) errors[`properties.${name}`] = "Choose one of the options.";
        break;
      }
      case "relation": {
        if (typeof value !== "string" || !/^[0-9a-fA-F-]{36}$/.test(value)) {
          errors[`properties.${name}`] = `Choose a note of type ${await typeNameOf(ctx, field.target_type_id)}.`;
          break;
        }
        const target = await ctx.pool.query<{ type_id: string }>("SELECT type_id FROM objects WHERE id = $1", [value]);
        if (target.rows.length === 0 || target.rows[0].type_id !== field.target_type_id) {
          errors[`properties.${name}`] = `Choose a note of type ${await typeNameOf(ctx, field.target_type_id)}.`;
        } else if (objectId !== null && value === objectId) {
          errors[`properties.${name}`] = "A note can't link to itself.";
        }
        break;
      }
    }
  }
}

function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m === null) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= days[mo - 1];
}

async function typeNameOf(ctx: Ctx, typeId: string | null): Promise<string> {
  if (typeId === null) return "";
  const res = await ctx.pool.query<{ name: string }>("SELECT name FROM object_types WHERE id = $1", [typeId]);
  return res.rows[0]?.name ?? "";
}

export async function handleObjects(ctx: Ctx, sync: LiveSync, req: ApiRequest, method: string, path: string): Promise<RouteResult> {
  if (method === "GET" && path === "/api/objects") {
    const typeId = req.query.get("type_id");
    const params: string[] = [];
    let sql = "SELECT o.id FROM objects o";
    if (typeId !== null) {
      sql += " WHERE o.type_id = $1";
      params.push(typeId);
    }
    sql += " ORDER BY lower(o.title) ASC, o.id ASC";
    const rows = await ctx.pool.query<{ id: string }>(sql, params);
    const objects = [];
    for (const r of rows.rows) {
      const o = await objectJson(ctx.pool, r.id, false);
      if (o !== null) objects.push(o);
    }
    return { status: 200, body: { objects } };
  }
  if (method === "POST" && path === "/api/objects") {
    const body = jsonBody(req);
    const errors: Record<string, string> = {};
    const typeId = typeof body.type_id === "string" ? body.type_id : "";
    const title = typeof body.title === "string" ? body.title : "";
    if (title.trim().length === 0 || title.length > 200) errors.title = "Give the note a title.";
    if (typeof body.type_id !== "string") errors.type_id = "Choose a type.";
    const t = typeId !== "" ? await typeById(ctx, typeId) : null;
    if (typeof body.type_id === "string" && t === null) errors.type_id = "Choose a type.";
    if (t !== null && t.name === "Daily note") errors.type_id = "Daily notes are created from Today.";
    await validateProperties(ctx, t === null ? "" : t.id, body.properties, null, errors);
    if (t !== null && body.properties !== null && typeof body.properties === "object" && !Array.isArray(body.properties)) {
      const given = (body.properties ?? {}) as Record<string, unknown>;
      for (const f of t.fields) {
        if (f.required && !(f.name in given)) errors[`properties.${f.name}`] = "This field is required.";
      }
    } else if (t !== null) {
      for (const f of t.fields) {
        if (f.required) errors[`properties.${f.name}`] = "This field is required.";
      }
    }
    if (Object.keys(errors).length > 0) throw validation(errors);
    const id = randomUUID();
    await withTransaction(ctx, async (client) => {
      await client.query(
        "INSERT INTO objects (id, type_id, title, daily_date, share_visibility, created_at, updated_at) VALUES ($1, $2, $3, NULL, 'follow', now(), now())",
        [id, typeId, title]
      );
      if (body.properties !== undefined && body.properties !== null && typeof body.properties === "object" && !Array.isArray(body.properties)) {
        for (const [name, value] of Object.entries(body.properties as Record<string, unknown>)) {
          if (value === undefined) continue;
          await client.query("INSERT INTO properties (object_id, field_name, value) VALUES ($1, $2, $3)", [id, name, JSON.stringify(value ?? null)]);
        }
      }
      // relation edges
      for (const [name, value] of Object.entries(body.properties === undefined || body.properties === null ? {} : (body.properties as Record<string, unknown>))) {
        if (t === null) break;
        const field = t.fields.find((x) => x.name === name);
        if (field !== undefined && field.kind === "relation" && typeof value === "string") {
          await client.query(
            "INSERT INTO link_edges (from_object_id, to_object_id, kind, block_id, field_name, created_at) VALUES ($1, $2, 'relation', NULL, $3, now())",
            [id, value, name]
          );
        }
      }
      await recordEvent(client, "object.saved", { object_id: id });
    });
    const o = await objectJson(ctx.pool, id, true);
    return { status: 201, body: o };
  }
  const objMatch = /^\/api\/objects\/([^/]+)(\/.*)?$/.exec(path);
  if (objMatch === null) throw notFound();
  const objectId = objMatch[1];
  const rest = objMatch[2] ?? "";
  if (!isUuid(objectId)) throw notFound();

  if (rest === "" && method === "GET") {
    const o = await objectJson(ctx.pool, objectId, true);
    if (o === null) throw notFound();
    return { status: 200, body: o };
  }
  if (rest === "" && method === "PATCH") {
    const body = jsonBody(req);
    const errors: Record<string, string> = {};
    const row = await ctx.pool.query<{ type_id: string }>("SELECT type_id FROM objects WHERE id = $1", [objectId]);
    if (row.rows.length === 0) throw notFound();
    const typeId = row.rows[0].type_id;
    if ("title" in body) {
      const t = body.title;
      if (typeof t !== "string" || t.trim().length === 0 || t.length > 200) errors.title = "Give the note a title.";
    }
    if ("share_visibility" in body) {
      const v = body.share_visibility;
      if (v !== "follow" && v !== "never") errors.share_visibility = "Choose follow or never.";
    }
    await validateProperties(ctx, typeId, body.properties, objectId, errors);
    if (Object.keys(errors).length > 0) throw validation(errors);
    await withTransaction(ctx, async (client) => {
      if ("title" in body && typeof body.title === "string") {
        await client.query("UPDATE objects SET title = $1 WHERE id = $2", [body.title, objectId]);
      }
      if ("share_visibility" in body && (body.share_visibility === "follow" || body.share_visibility === "never")) {
        await client.query("UPDATE objects SET share_visibility = $1 WHERE id = $2", [body.share_visibility, objectId]);
      }
      if (body.properties !== undefined && body.properties !== null && typeof body.properties === "object" && !Array.isArray(body.properties)) {
        const t = await typeById(ctx, typeId);
        for (const [name, value] of Object.entries(body.properties as Record<string, unknown>)) {
          if (value === undefined) continue;
          await client.query(
            `INSERT INTO properties (object_id, field_name, value) VALUES ($1, $2, $3)
             ON CONFLICT (object_id, field_name) DO UPDATE SET value = $3`,
            [objectId, name, JSON.stringify(value ?? null)]
          );
          const field = t === null ? undefined : t.fields.find((x) => x.name === name);
          if (field !== undefined && field.kind === "relation") {
            const old = await client.query<{ value: string | null }>("SELECT value FROM properties WHERE object_id = $1 AND field_name = $2", [objectId, name]);
            const oldTarget = typeof old.rows[0]?.value === "string" ? old.rows[0].value : null;
            await client.query("DELETE FROM link_edges WHERE from_object_id = $1 AND field_name = $2 AND kind = 'relation'", [objectId, name]);
            if (typeof value === "string") {
              await client.query(
                "INSERT INTO link_edges (from_object_id, to_object_id, kind, block_id, field_name, created_at) VALUES ($1, $2, 'relation', NULL, $3, now())",
                [objectId, value, name]
              );
              const count = await backlinkCount(client, value);
              await recordEvent(client, "backlinks.changed", { object_id: value, backlinks: count });
            }
            if (oldTarget !== null && oldTarget !== value) {
              const oldCount = await backlinkCount(client, oldTarget);
              await recordEvent(client, "backlinks.changed", { object_id: oldTarget, backlinks: oldCount });
            }
          }
        }
      }
      await touchObject(client, objectId);
      await recordEvent(client, "object.saved", { object_id: objectId });
    });
    const o = await objectJson(ctx.pool, objectId, true);
    return { status: 200, body: o };
  }
  if (rest === "" && method === "DELETE") {
    const row = await ctx.pool.query("SELECT id FROM objects WHERE id = $1", [objectId]);
    if (row.rows.length === 0) throw notFound();
    const s3Delete = (key: string): void => {
      ctx.s3.deleteObjectRetry(key).catch(() => undefined);
    };
    await withTransaction(ctx, async (client) => {
      await deleteObjectEntirely(client, objectId, s3Delete);
    });
    return { status: 204, body: null };
  }
  if (rest === "/backlinks" && method === "GET") {
    const row = await ctx.pool.query("SELECT id FROM objects WHERE id = $1", [objectId]);
    if (row.rows.length === 0) throw notFound();
    const count = await ctx.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM link_edges WHERE to_object_id = $1", [objectId]);
    const edges = await ctx.pool.query<{ edge_id: string; from_object_id: string; from_title: string; kind: string; field_name: string | null; block_id: string | null }>(
      `SELECT e.id::text AS edge_id, e.from_object_id, o.title AS from_title, e.kind, e.field_name, e.block_id
       FROM link_edges e JOIN objects o ON o.id = e.from_object_id
       WHERE e.to_object_id = $1 ORDER BY e.id DESC`,
      [objectId]
    );
    return {
      status: 200,
      body: {
        count: Number(count.rows[0].n),
        backlinks: edges.rows.map((e) => ({
          edge_id: e.edge_id,
          from_object_id: e.from_object_id,
          from_title: e.from_title,
          kind: e.kind,
          field_name: e.field_name,
          block_id: e.block_id,
        })),
      },
    };
  }
  if (rest === "/blocks" && method === "POST") {
    const body = jsonBody(req);
    const row = await ctx.pool.query("SELECT id FROM objects WHERE id = $1", [objectId]);
    if (row.rows.length === 0) throw notFound();
    const errors: Record<string, string> = {};
    if (typeof body.body !== "string") errors.body = "A block can hold at most 20,000 characters.";
    if (body.after_block_id !== null && body.after_block_id !== undefined && typeof body.after_block_id !== "string") errors.after_block_id = "That block is not in this note.";
    if (Object.keys(errors).length > 0) throw validation(errors);
    let block = null;
    try {
      block = await withTransaction(ctx, async (client) => {
        return createTextBlock(client, objectId, typeof body.body === "string" ? body.body : "", body.after_block_id === undefined ? null : (body.after_block_id as string | null), req.session?.label ?? "Unknown browser");
      });
    } catch (e) {
      if (e instanceof BlockError) throw blockErrorToApi(e);
      throw e;
    }
    const blockList = await blocksJson(ctx.pool, objectId);
    const bj = blockList.find((b) => b.id === block.id);
    return { status: 201, body: bj ?? null };
  }
  if (rest === "/quotes" && method === "POST") {
    const body = jsonBody(req);
    const idem = await idempotencyPreCheck(ctx, req, `POST /api/objects/${objectId}/quotes`, body);
    if (idem.replay !== null) return { status: idem.replay.status, body: JSON.parse(idem.replay.body), headers: { "Idempotent-Replay": "true" } };
    if (idem.conflict) throw new HttpError(409, { error: "idempotency_conflict" });
    const row = await ctx.pool.query("SELECT id FROM objects WHERE id = $1", [objectId]);
    if (row.rows.length === 0) throw notFound();
    const errors: Record<string, string> = {};
    if (typeof body.origin_block_id !== "string") errors.origin_block_id = "That block no longer exists.";
    if (Object.keys(errors).length > 0) throw validation(errors);
    let result = null;
    try {
      result = await withTransaction(ctx, async (client) => {
        return createQuote(client, objectId, body.origin_block_id as string, body.after_block_id === undefined || body.after_block_id === null ? null : (body.after_block_id as string), req.session?.label ?? "Unknown browser");
      });
    } catch (e) {
      if (e instanceof BlockError) throw blockErrorToApi(e);
      throw e;
    }
    const blockList = await blocksJson(ctx.pool, objectId);
    const bj = blockList.find((b) => b.id === result.quoteBlockId);
    const responseBody = { block: bj, origin_backlinks: result.originBacklinks };
    await storeIdempotency(ctx, req, `POST /api/objects/${objectId}/quotes`, body, 201, JSON.stringify(responseBody));
    return { status: 201, body: responseBody };
  }
  if (rest === "/attachments" && method === "POST") {
    return handleAttachmentUpload(ctx, sync, req.raw, req);
  }
  throw notFound();
}

// ---------------------------------------------------------------------------
// Idempotency: the single home of the replay lookup

interface IdempotencyMatch {
  replay: { status: number; body: string } | null;
  conflict: boolean;
}

function validIdempotencyKey(key: string): boolean {
  if (key.length < 1 || key.length > 100) return false;
  for (let i = 0; i < key.length; i += 1) {
    const c = key.charCodeAt(i);
    if (c < 0x21 || c > 0x7e) return false;
  }
  return true;
}

function canonicalJson(body: Record<string, unknown>): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>).filter(([, val]) => val !== undefined);
      entries.sort((a, b) => (a[0] < b[0] ? -1 : 1));
      return Object.fromEntries(entries.map(([k, val]) => [k, sort(val)]));
    }
    return v;
  };
  return JSON.stringify(sort(body));
}

async function idempotencyPreCheck(ctx: Ctx, req: ApiRequest, endpoint: string, body: Record<string, unknown>): Promise<IdempotencyMatch> {
  const rawKey = header(req, "idempotency-key");
  if (rawKey === undefined) return { replay: null, conflict: false };
  if (!validIdempotencyKey(rawKey)) {
    throw validation({ idempotency_key: "Use 1 to 100 visible characters." });
  }
  const res = await ctx.pool.query<{ status: number; response_body: string; request_hash: string }>(
    "SELECT status, response_body, request_hash FROM idempotency WHERE owner_key = $1 AND key = $2 AND endpoint = $3",
    ["owner", rawKey, endpoint]
  );
  if (res.rows.length === 0) return { replay: null, conflict: false };
  const row = res.rows[0];
  if (row.request_hash !== canonicalJson(body)) return { replay: null, conflict: true };
  return { replay: { status: row.status, body: row.response_body }, conflict: false };
}

async function storeIdempotency(ctx: Ctx, req: ApiRequest, endpoint: string, body: Record<string, unknown>, status: number, responseBody: string): Promise<void> {
  const rawKey = header(req, "idempotency-key");
  if (rawKey === undefined) return;
  await ctx.pool.query(
    `INSERT INTO idempotency (owner_key, key, endpoint, request_hash, status, response_body, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (owner_key, key, endpoint) DO NOTHING`,
    ["owner", rawKey, endpoint, canonicalJson(body), status, responseBody]
  );
}

// ---------------------------------------------------------------------------
// Blocks

export async function handleBlocks(ctx: Ctx, sync: LiveSync, req: ApiRequest, method: string, path: string): Promise<RouteResult> {
  const searchMatch = path === "/api/blocks/search";
  if (searchMatch && method === "GET") {
    const q = (req.query.get("q") ?? "").trim();
    if (q.length > SEARCH_CAP) throw validation({ q: "Search with at most 200 characters." });
    const exclude = req.query.get("exclude_object_id");
    if (q.length === 0) {
      const rows = await ctx.pool.query<{ id: string; object_id: string; plain: string; title: string }>(
        `SELECT b.id, b.object_id, r.plain, o.title
         FROM blocks b
         JOIN revisions r ON r.block_id = b.id AND r.version = b.version
         JOIN objects o ON o.id = b.object_id
         WHERE b.kind = 'text' AND ($1::text IS NULL OR b.object_id::text <> $1)
         ORDER BY b.updated_at DESC LIMIT 20`,
        [exclude]
      );
      return {
        status: 200,
        body: {
          results: rows.rows.map((r) => ({
            block_id: r.id,
            object_id: r.object_id,
            object_title: r.title,
            excerpt: r.plain.slice(0, 60),
          })),
        },
      };
    }
    const lower = q.toLowerCase();
    const rows = await ctx.pool.query<{ id: string; object_id: string; plain: string; title: string }>(
      `SELECT b.id, b.object_id, r.plain, o.title
       FROM blocks b
       JOIN revisions r ON r.block_id = b.id AND r.version = b.version
       JOIN objects o ON o.id = b.object_id
       WHERE b.kind = 'text' AND lower(r.plain) LIKE $1 AND ($2::text IS NULL OR b.object_id::text <> $2)
       ORDER BY b.updated_at DESC LIMIT 20`,
      [`%${lower}%`, exclude]
    );
    return {
      status: 200,
      body: {
        results: rows.rows.map((r) => ({
          block_id: r.id,
          object_id: r.object_id,
          object_title: r.title,
          excerpt: r.plain.slice(0, 60),
        })),
      },
    };
  }

  const patchMatch = /^\/api\/blocks\/([^/]+)$/.exec(path);
  if (method === "PATCH" && patchMatch !== null) {
    const blockId = patchMatch[1];
    if (!isUuid(blockId)) throw notFound();
    const body = jsonBody(req);
    const errors: Record<string, string> = {};
    if (typeof body.base_version !== "number" || !Number.isInteger(body.base_version) || body.base_version < 1) {
      errors.base_version = "Send the version you started from.";
    }
    if (body.edit_id !== undefined && body.edit_id !== null) {
      if (typeof body.edit_id !== "string" || body.edit_id.length < 1 || body.edit_id.length > 64 || !/^[\x20-\x7e]+$/.test(body.edit_id)) {
        errors.edit_id = "Use 1 to 64 visible characters.";
      }
    }
    const hasOps = body.ops !== undefined;
    const hasBody = body.body !== undefined;
    if (hasOps === hasBody) {
      errors.body = "A block can hold at most 20,000 characters.";
    } else if (hasOps && !opsValidShape(body.ops)) {
      errors.ops = `Those changes don't fit version ${body.base_version}.`;
    }
    if (Object.keys(errors).length > 0) throw validation(errors);
    let result = null;
    try {
      result = await withTransaction(ctx, async (client) => {
        const input: SaveBlockInput = {
          blockId,
          body: body.body,
          ops: body.ops,
          baseVersion: body.base_version as number,
          editId: body.edit_id === undefined || body.edit_id === null ? null : String(body.edit_id),
          label: req.session?.label ?? "Unknown browser",
          kind: hasOps ? "ops" : "full",
        };
        return commitBlockEdit(client, input);
      });
    } catch (e) {
      if (e instanceof BlockError) {
        const apiErr = blockErrorToApi(e);
        if (e.code === "version_conflict") {
          const current = await currentBlockForConflict(ctx, blockId);
          throw new HttpError(409, { error: "version_conflict", current });
        }
        throw apiErr;
      }
      throw e;
    }
    const bj = await blockById(ctx, blockId);
    return { status: 200, body: bj };
  }

  const delMatch = /^\/api\/blocks\/([^/]+)$/.exec(path);
  if (method === "DELETE" && delMatch !== null) {
    const blockId = delMatch[1];
    if (!isUuid(blockId)) throw notFound();
    let res = null;
    try {
      res = await withTransaction(ctx, async (client) => {
        return deleteTextBlock(client, blockId);
      });
    } catch (e) {
      if (e instanceof BlockError) {
        if (e.code === "block_quoted") {
          throw new HttpError(409, { error: "block_quoted", quoted_in: e.extra?.quoted_in ?? 0 });
        }
        throw blockErrorToApi(e);
      }
      throw e;
    }
    if (res.wasQuote) {
      return {
        status: 200,
        body: { origin_object_id: res.originObjectId ?? res.objectId, origin_backlinks: res.originBacklinks },
      };
    }
    return { status: 204, body: null };
  }

  const moveMatch = /^\/api\/blocks\/([^/]+)\/move$/.exec(path);
  if (method === "POST" && moveMatch !== null) {
    const blockId = moveMatch[1];
    if (!isUuid(blockId)) throw notFound();
    const body = jsonBody(req);
    const errors: Record<string, string> = {};
    if (typeof body.object_id !== "string") errors.object_id = "That note no longer exists.";
    if (body.after_block_id !== undefined && body.after_block_id !== null && typeof body.after_block_id !== "string") {
      errors.after_block_id = "That block is not in this note.";
    }
    if (Object.keys(errors).length > 0) throw validation(errors);
    let result = null;
    try {
      result = await withTransaction(ctx, async (client) => {
        return moveBlock(client, blockId, body.object_id as string, body.after_block_id === undefined || body.after_block_id === null ? null : (body.after_block_id as string), req.session?.label ?? "Unknown browser");
      });
    } catch (e) {
      if (e instanceof BlockError) {
        if (e.code === "not_editable") throw new HttpError(409, { error: "not_movable" });
        throw blockErrorToApi(e);
      }
      throw e;
    }
    const bj = await blockById(ctx, blockId);
    return { status: 200, body: bj };
  }

  const presenceMatch = /^\/api\/blocks\/([^/]+)\/presence$/.exec(path);
  if (presenceMatch !== null) {
    const blockId = presenceMatch[1];
    if (!isUuid(blockId)) throw notFound();
    if (method === "POST") {
      const body = jsonBody(req);
      const errors: Record<string, string> = {};
      if (typeof body.version !== "number" || typeof body.anchor !== "number" || typeof body.head !== "number") {
        errors.anchor = "Use offsets inside the block.";
        errors.head = "Use offsets inside the block.";
        throw validation(errors);
      }
      const originId = await resolveOriginBlock(ctx, blockId);
      if (originId === null) throw notFound();
      const origin = await ctx.pool.query<{ kind: string; version: number; body: string }>(
        "SELECT kind, version, body FROM blocks WHERE id = $1",
        [originId]
      );
      if (origin.rows.length === 0) throw notFound();
      if (origin.rows[0].kind === "attachment") throw new HttpError(409, { error: "not_editable" });
      const currentVersion = origin.rows[0].version;
      // offsets are reported against a kept version and moved to the current one
      let anchor = body.anchor;
      let head = body.head;
      if (body.version !== currentVersion) {
        const revisions = await ctx.pool.query<{ version: number; body: string; ops: Op[] | null; is_full: boolean }>(
          "SELECT version, body, ops, is_full FROM revisions WHERE block_id = $1 AND version > $2 ORDER BY version ASC",
          [originId, body.version]
        );
        const baseRev = await ctx.pool.query<{ body: string }>(
          "SELECT body FROM revisions WHERE block_id = $1 AND version = $2",
          [originId, body.version]
        );
        if (baseRev.rows.length === 0) {
          throw validation({ anchor: "Use offsets inside the block.", head: "Use offsets inside the block." });
        }
        const baseLen = editText(baseRev.rows[0].body).length;
        if (body.anchor < 0 || body.anchor > baseLen || body.head < 0 || body.head > baseLen || !Number.isInteger(body.anchor) || !Number.isInteger(body.head)) {
          throw validation({ anchor: "Use offsets inside the block.", head: "Use offsets inside the block." });
        }
        for (const rev of revisions.rows) {
          if (rev.is_full || rev.ops === null) {
            anchor = Math.min(anchor, editText(rev.body).length);
            head = Math.min(head, editText(rev.body).length);
          } else {
            const revOps = rev.ops;
            const shift = (offset: number): number => {
              let pos = 0;
              let result = offset;
              for (const op of revOps) {
                if ("retain" in op) pos += op.retain;
                else if ("insert" in op) {
                  if (pos <= offset) result += op.insert.length;
                } else {
                  if (pos + op.delete <= offset) result -= op.delete;
                  else if (pos < offset) result = pos;
                  pos += op.delete;
                }
              }
              return result;
            };
            anchor = shift(anchor);
            head = shift(head);
          }
        }
        const finalLen = editText(origin.rows[0].body).length;
        anchor = Math.max(0, Math.min(anchor, finalLen));
        head = Math.max(0, Math.min(head, finalLen));
      } else {
        const len = editText(origin.rows[0].body).length;
        if (body.anchor < 0 || body.anchor > len || body.head < 0 || body.head > len || !Number.isInteger(body.anchor) || !Number.isInteger(body.head)) {
          throw validation({ anchor: "Use offsets inside the block.", head: "Use offsets inside the block." });
        }
      }
      const label = req.session?.label ?? "Unknown browser";
      const publicId = req.session?.public_id ?? "";
      await ctx.pool.query(
        `INSERT INTO presence (session_id, block_id, anchor, head, updated_at) VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (session_id, block_id) DO UPDATE SET anchor = $3, head = $4, updated_at = now()`,
        [req.session?.id ?? "", originId, anchor, head]
      );
      sync.presenceChanged({ block_id: originId, session_id: publicId, label, anchor, head }, req.session?.id ?? null);
      return { status: 204, body: null };
    }
    if (method === "DELETE") {
      const originId = await resolveOriginBlock(ctx, blockId);
      await ctx.pool.query("DELETE FROM presence WHERE session_id = $1 AND block_id = $2", [req.session?.id ?? "", originId ?? blockId]);
      sync.presenceChanged({ block_id: originId ?? blockId, session_id: req.session?.public_id ?? "", label: req.session?.label ?? "", anchor: null, head: null }, req.session?.id ?? null);
      return { status: 204, body: null };
    }
  }

  const revMatch = /^\/api\/blocks\/([^/]+)\/revisions$/.exec(path);
  if (method === "GET" && revMatch !== null) {
    const blockId = revMatch[1];
    if (!isUuid(blockId)) throw notFound();
    const originId = await resolveOriginBlock(ctx, blockId);
    if (originId === null) throw notFound();
    const rows = await ctx.pool.query<{ version: number; body: string; plain: string; label: string; created_at: Date }>(
      "SELECT version, body, plain, label, created_at FROM revisions WHERE block_id = $1 ORDER BY version DESC",
      [originId]
    );
    return {
      status: 200,
      body: {
        revisions: rows.rows.map((r) => ({
          version: r.version,
          body: r.body,
          plain: r.plain,
          label: r.label,
          created_at: r.created_at.toISOString(),
        })),
      },
    };
  }

  const diffMatch = /^\/api\/blocks\/([^/]+)\/diff$/.exec(path);
  if (method === "GET" && diffMatch !== null) {
    const blockId = diffMatch[1];
    if (!isUuid(blockId)) throw notFound();
    const from = req.query.get("from");
    const to = req.query.get("to");
    if (from === null || to === null || !/^\d+$/.test(from) || !/^\d+$/.test(to)) {
      throw validation({ from: "That version is not kept." });
    }
    const originId = await resolveOriginBlock(ctx, blockId);
    if (originId === null) throw notFound();
    const fromRev = await ctx.pool.query<{ body: string }>("SELECT body FROM revisions WHERE block_id = $1 AND version = $2", [originId, Number(from)]);
    const toRev = await ctx.pool.query<{ body: string }>("SELECT body FROM revisions WHERE block_id = $1 AND version = $2", [originId, Number(to)]);
    if (fromRev.rows.length === 0 || toRev.rows.length === 0) {
      throw validation({ from: "That version is not kept.", to: "That version is not kept." });
    }
    const ops = wordDiff(plainText(fromRev.rows[0].body), plainText(toRev.rows[0].body));
    return { status: 200, body: { from: Number(from), to: Number(to), ops } };
  }

  const restoreMatch = /^\/api\/blocks\/([^/]+)\/restore$/.exec(path);
  if (method === "POST" && restoreMatch !== null) {
    const blockId = restoreMatch[1];
    if (!isUuid(blockId)) throw notFound();
    const body = jsonBody(req);
    const errors: Record<string, string> = {};
    if (typeof body.version !== "number" || !Number.isInteger(body.version)) errors.version = "That version is not kept.";
    if (typeof body.base_version !== "number" || !Number.isInteger(body.base_version)) errors.base_version = "Send the version you started from.";
    if (Object.keys(errors).length > 0) throw validation(errors);
    const originId = await resolveOriginBlock(ctx, blockId);
    if (originId === null) throw notFound();
    const rev = await ctx.pool.query<{ body: string }>("SELECT body FROM revisions WHERE block_id = $1 AND version = $2", [originId, body.version]);
    if (rev.rows.length === 0) throw validation({ version: "That version is not kept." });
    try {
      await withTransaction(ctx, async (client) => {
        const input: SaveBlockInput = {
          blockId: originId,
          body: rev.rows[0].body,
          baseVersion: body.base_version as number,
          editId: null,
          label: req.session?.label ?? "Unknown browser",
          kind: "full",
        };
        return commitBlockEdit(client, input);
      });
    } catch (e) {
      if (e instanceof BlockError) {
        if (e.code === "version_conflict") {
          const current = await currentBlockForConflict(ctx, originId);
          throw new HttpError(409, { error: "version_conflict", current });
        }
        throw blockErrorToApi(e);
      }
      throw e;
    }
    const bj = await blockById(ctx, originId);
    return { status: 200, body: bj };
  }
  throw notFound();
}

async function resolveOriginBlock(ctx: Ctx, blockId: string): Promise<string | null> {
  const row = await ctx.pool.query<{ id: string; kind: string; origin_block_id: string | null }>(
    "SELECT id, kind, origin_block_id FROM blocks WHERE id = $1",
    [blockId]
  );
  if (row.rows.length === 0) return null;
  if (row.rows[0].kind === "quote" && row.rows[0].origin_block_id !== null) return row.rows[0].origin_block_id;
  return row.rows[0].id;
}

async function currentBlockForConflict(ctx: Ctx, blockId: string): Promise<unknown> {
  const bj = await blockById(ctx, blockId);
  return bj;
}

async function blockById(ctx: Ctx, blockId: string): Promise<unknown> {
  const row = await ctx.pool.query<{ object_id: string }>("SELECT object_id FROM blocks WHERE id = $1", [blockId]);
  if (row.rows.length === 0) return null;
  const list = await blocksJson(ctx.pool, row.rows[0].object_id);
  return list.find((b) => b.id === blockId) ?? null;
}

// ---------------------------------------------------------------------------
// Daily notes

async function dailyNoteForDate(client: PoolClient, date: string): Promise<{ id: string; created: boolean } | null> {
  const dailyType = await client.query<{ id: string }>("SELECT id FROM object_types WHERE name = 'Daily note' LIMIT 1");
  if (dailyType.rows.length === 0) return null;
  const existing = await client.query<{ id: string }>("SELECT id FROM objects WHERE daily_date = $1", [date]);
  if (existing.rows.length > 0) return { id: existing.rows[0].id, created: false };
  const id = randomUUID();
  await client.query(
    "INSERT INTO objects (id, type_id, title, daily_date, share_visibility, created_at, updated_at) VALUES ($1, $2, $3, $4, 'follow', now(), now())",
    [id, dailyType.rows[0].id, date, date]
  );
  await recordEvent(client, "object.saved", { object_id: id });
  return { id, created: true };
}

export async function handleDaily(ctx: Ctx, sync: LiveSync, req: ApiRequest, method: string, path: string): Promise<RouteResult> {
  if (method === "POST" && path === "/api/daily/today") {
    const today = ctx.today();
    const note = await withTransaction(ctx, async (client) => {
      return dailyNoteForDate(client, today);
    });
    if (note === null) throw notFound();
    const o = await objectJson(ctx.pool, note.id, true);
    return { status: note.created ? 201 : 200, body: { date: today, object: o } };
  }
  if (method === "POST" && path === "/api/daily/today/blocks") {
    const body = jsonBody(req);
    const idem = await idempotencyPreCheck(ctx, req, "POST /api/daily/today/blocks", body);
    if (idem.replay !== null) return { status: idem.replay.status, body: JSON.parse(idem.replay.body), headers: { "Idempotent-Replay": "true" } };
    if (idem.conflict) throw new HttpError(409, { error: "idempotency_conflict" });
    const today = ctx.today();
    let block = null;
    let noteId = "";
    try {
      const res = await withTransaction(ctx, async (client) => {
        const note = await dailyNoteForDate(client, today);
        if (note === null) throw notFound();
        noteId = note.id;
        const afterBlockId = typeof body.after_block_id === "string" ? body.after_block_id : null;
        // after_block_id must be a block of this note to place; anything else goes to the end
        let placeAfter: string | null = null;
        if (afterBlockId !== null) {
          const owner = await client.query<{ object_id: string }>("SELECT object_id FROM blocks WHERE id = $1", [afterBlockId]);
          if (owner.rows.length > 0 && owner.rows[0].object_id === note.id) placeAfter = afterBlockId;
        }
        const created = await createTextBlock(client, note.id, typeof body.body === "string" ? body.body : "", placeAfter, req.session?.label ?? "Unknown browser");
        return { block: created, noteId: note.id, created: note.created };
      });
      block = res.block;
    } catch (e) {
      if (e instanceof BlockError) throw blockErrorToApi(e);
      throw e;
    }
    const blockList = await blocksJson(ctx.pool, noteId);
    const bj = blockList.find((b) => b.id === block.id);
    const responseBody = { date: today, object_id: noteId, block: bj };
    await storeIdempotency(ctx, req, "POST /api/daily/today/blocks", body, 201, JSON.stringify(responseBody));
    return { status: 201, body: responseBody };
  }
  if (method === "GET" && path === "/api/daily") {
    const date = req.query.get("date");
    if (date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw validation({ date: "Use YYYY-MM-DD." });
    const row = await ctx.pool.query<{ id: string }>("SELECT id FROM objects WHERE daily_date = $1", [date]);
    if (row.rows.length === 0) throw notFound();
    const o = await objectJson(ctx.pool, row.rows[0].id, true);
    return { status: 200, body: o };
  }
  if (method === "GET" && path === "/api/daily/recent") {
    const rows = await ctx.pool.query<{ date: string; object_id: string }>(
      "SELECT daily_date AS date, id AS object_id FROM objects WHERE daily_date IS NOT NULL ORDER BY daily_date DESC LIMIT 7"
    );
    return { status: 200, body: { notes: rows.rows } };
  }
  throw notFound();
}

// ---------------------------------------------------------------------------
// Attachments

export async function handleAttachmentUpload(ctx: Ctx, sync: LiveSync, raw: IncomingMessage, req: ApiRequest): Promise<RouteResult> {
  const objectIdMatch = /\/api\/objects\/([^/]+)\/attachments\/?$/.exec(req.path);
  if (objectIdMatch === null) throw notFound();
  const objectId = objectIdMatch[1];

  // multipart parsing: whole request at most 10,100,000 bytes
  const { ok, tooLarge } = await readBody(raw, UPLOAD_MAX_REQUEST + 1048576);
  if (tooLarge || (ok !== null && ok.length > UPLOAD_MAX_REQUEST)) {
    throw new HttpError(413, { error: "too_large" });
  }
  const buf = ok ?? Buffer.alloc(0);
  const ct = (header(req, "content-type") ?? "").toLowerCase();
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/.exec(ct);
  if (boundaryMatch === null || !ct.startsWith("multipart/form-data")) {
    throw new HttpError(415, { error: "unsupported_media_type" });
  }
  const boundary = `--${(boundaryMatch[1] ?? boundaryMatch[2]).trim()}`;
  const parsed = parseMultipart(buf, boundary);
  const file = parsed.find((p) => p.name === "file");
  if (file === undefined) throw validation({ file: "Attach a file." });
  if (file.bytes.length > UPLOAD_MAX_BYTES) throw new HttpError(413, { error: "too_large" });

  const detected = sniffType(file.bytes.subarray(0, 16));
  if (detected === null || detected !== file.contentType) {
    throw new HttpError(415, { error: "unsupported_media_type" });
  }
  // storage must be reachable before anything is stored
  const available = await ctx.s3.available();
  if (!available) throw new HttpError(503, { error: "storage_unavailable" });

  const row = await ctx.pool.query("SELECT id FROM objects WHERE id = $1", [objectId]);
  if (row.rows.length === 0) throw notFound();
  const filename = safeFilename(file.filename ?? "attachment");
  const attachmentId = randomUUID();
  const key = `attachments/${objectId}/${attachmentId}`;
  const written = await ctx.s3.putObject(key, file.bytes, detected);
  if (!written) {
    await ctx.s3.deleteObjectRetry(key);
    throw new HttpError(503, { error: "storage_unavailable" });
  }
  const confirmedSize = await ctx.s3.statObject(key);
  if (confirmedSize !== file.bytes.length) {
    await ctx.s3.deleteObjectRetry(key);
    throw new HttpError(503, { error: "storage_unavailable" });
  }
  let block = null;
  try {
    block = await withTransaction(ctx, async (client) => {
      await client.query(
        "INSERT INTO attachments (id, object_id, filename, content_type, size_bytes, created_at) VALUES ($1, $2, $3, $4, $5, now())",
        [attachmentId, objectId, filename, detected, file.bytes.length]
      );
      const max = await client.query<{ max: number | null }>("SELECT max(position) AS max FROM blocks WHERE object_id = $1", [objectId]);
      const position = (max.rows[0].max ?? 0) + 1;
      const blockId = randomUUID();
      await client.query(
        "INSERT INTO blocks (id, object_id, kind, position, body, version, origin_block_id, attachment_id, created_at, updated_at) VALUES ($1, $2, 'attachment', $3, '', 1, NULL, $4, now(), now())",
        [blockId, objectId, position, attachmentId]
      );
      await touchObject(client, objectId);
      await recordEvent(client, "block.saved", {
        object_id: objectId,
        block: { id: blockId, object_id: objectId, kind: "attachment", position, body: null, version: 1, origin: null, attachment: { id: attachmentId, filename, content_type: detected, size_bytes: file.bytes.length } },
        ops: null,
        base_version: 0,
        label: req.session?.label ?? "Unknown browser",
        edit_id: null,
      });
      return blockId;
    });
  } catch (e) {
    await ctx.s3.deleteObjectRetry(key);
    throw e;
  }
  const blockList = await blocksJson(ctx.pool, objectId);
  const bj = blockList.find((b) => b.id === block);
  return { status: 201, body: bj };
}

interface MultipartPart {
  name: string;
  filename: string | null;
  contentType: string;
  bytes: Buffer;
}

function parseMultipart(buf: Buffer, boundary: string): MultipartPart[] {
  const parts: MultipartPart[] = [];
  const bBytes = Buffer.from(boundary);
  let idx = buf.indexOf(bBytes);
  while (idx !== -1) {
    const start = idx + bBytes.length;
    // terminal boundary "--"
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break;
    // skip CRLF after boundary
    let cursor = start;
    if (buf[cursor] === 0x0d && buf[cursor + 1] === 0x0a) cursor += 2;
    // headers end at CRLFCRLF
    const headerEnd = buf.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd === -1) break;
    const headerText = buf.subarray(cursor, headerEnd).toString("utf8");
    let name = "";
    let filename: string | null = null;
    let contentType = "application/octet-stream";
    for (const line of headerText.split("\r\n")) {
      const cd = /^content-disposition:\s*(.*)$/i.exec(line);
      if (cd !== null) {
        const nameM = /name="((?:[^"\\]|\\.)*)"/.exec(cd[1]);
        if (nameM !== null) name = nameM[1].replace(/\\(.)/g, "$1");
        const fileM = /filename="((?:[^"\\]|\\.)*)"/.exec(cd[1]);
        if (fileM !== null) filename = fileM[1].replace(/\\(.)/g, "$1");
      }
      const ctM = /^content-type:\s*(.*)$/i.exec(line);
      if (ctM !== null) contentType = ctM[1].trim();
    }
    const bodyStart = headerEnd + 4;
    const nextBoundary = buf.indexOf(Buffer.from(`\r\n${boundary}`), bodyStart);
    const bodyEnd = nextBoundary === -1 ? buf.length : nextBoundary;
    parts.push({ name, filename, contentType, bytes: buf.subarray(bodyStart, bodyEnd) });
    idx = nextBoundary;
  }
  return parts;
}

export async function handleAttachmentDownload(ctx: Ctx, req: ApiRequest, path: string): Promise<RouteResult> {
  const match = /^\/api\/attachments\/([^/]+)$/.exec(path);
  if (match === null) throw notFound();
  const attachmentId = match[1];
  const row = await ctx.pool.query<{ object_id: string; filename: string; content_type: string }>(
    "SELECT object_id, filename, content_type FROM attachments WHERE id = $1",
    [attachmentId]
  );
  if (row.rows.length === 0) throw notFound();
  const bytes = await ctx.s3.getObject(`attachments/${row.rows[0].object_id}/${attachmentId}`);
  if (bytes === null) throw new HttpError(503, { error: "storage_unavailable" });
  const disposition = row.rows[0].content_type.startsWith("image/") ? "inline" : "attachment";
  return {
    status: 200,
    body: bytes,
    headers: {
      "Content-Type": row.rows[0].content_type,
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${disposition}; filename="${row.rows[0].filename.replace(/["\\]/g, "")}"`,
    },
  };
}

// ---------------------------------------------------------------------------
// Collections, boards and share links

export async function handleCollections(ctx: Ctx, sync: LiveSync, req: ApiRequest, method: string, path: string): Promise<RouteResult> {
  if (method === "GET" && path === "/api/collections") {
    const rows = await ctx.pool.query<{ id: string; name: string; object_count: string }>(
      `SELECT c.id, c.name, (SELECT count(*) FROM collection_members m WHERE m.collection_id = c.id)::text AS object_count
       FROM collections c ORDER BY lower(c.name) ASC`
    );
    return {
      status: 200,
      body: {
        collections: rows.rows.map((r) => ({ id: r.id, name: r.name, object_count: Number(r.object_count) })),
      },
    };
  }
  if (method === "POST" && path === "/api/collections") {
    const body = jsonBody(req);
    const name = typeof body.name === "string" ? body.name : "";
    const errors: Record<string, string> = {};
    if (name.trim().length === 0) errors.name = "Give the collection a name.";
    else {
      const dup = await ctx.pool.query("SELECT id FROM collections WHERE lower(name) = lower($1)", [name]);
      if (dup.rows.length > 0) errors.name = "A collection with this name already exists.";
    }
    if (Object.keys(errors).length > 0) throw validation(errors);
    const id = randomUUID();
    await withTransaction(ctx, async (client) => {
      await client.query("INSERT INTO collections (id, name, created_at) VALUES ($1, $2, now())", [id, name]);
    });
    return { status: 201, body: { id, name, object_count: 0 } };
  }
  const collMatch = /^\/api\/collections\/([^/]+)(\/.*)?$/.exec(path);
  if (collMatch === null) throw notFound();
  const collectionId = collMatch[1];
  if (!isUuid(collectionId)) throw notFound();
  const rest = collMatch[2] ?? "";
  const exists = await ctx.pool.query("SELECT id FROM collections WHERE id = $1", [collectionId]);
  if (exists.rows.length === 0) throw notFound();

  if (rest === "" && method === "GET") {
    const row = await ctx.pool.query<{ name: string }>("SELECT name FROM collections WHERE id = $1", [collectionId]);
    const members = await ctx.pool.query<{ id: string }>(
      "SELECT o.id FROM collection_members m JOIN objects o ON o.id = m.object_id WHERE m.collection_id = $1 ORDER BY lower(o.title) ASC, o.id ASC",
      [collectionId]
    );
    const objects = [];
    for (const m of members.rows) {
      const o = await objectJson(ctx.pool, m.id, false);
      if (o !== null) objects.push(o);
    }
    return { status: 200, body: { id: collectionId, name: row.rows[0].name, objects } };
  }
  if (rest === "" && method === "DELETE") {
    // revoke active links, delete the collection
    await withTransaction(ctx, async (client) => {
      const links = await client.query<{ id: string }>("SELECT id FROM share_links WHERE collection_id = $1 AND status = 'active'", [collectionId]);
      for (const link of links.rows) {
        await client.query("UPDATE share_links SET status = 'revoked', revoked_at = now() WHERE id = $1 AND status = 'active'", [link.id]);
        await recordEvent(client, "share_link.changed", { collection_id: collectionId, share_link_id: link.id });
      }
      await client.query("DELETE FROM collections WHERE id = $1", [collectionId]);
    });
    return { status: 204, body: null };
  }
  if (rest === "/board" && method === "GET") {
    const b = await boardJson(ctx.pool, collectionId);
    return { status: 200, body: b };
  }
  if (rest === "/board" && method === "PUT") {
    const body = jsonBody(req);
    const positions = body.positions;
    if (!Array.isArray(positions) || positions.length < 1 || positions.length > 200) {
      throw validation({ positions: "Send 1 to 200 positions." });
    }
    const memberIds = new Set((await ctx.pool.query<{ object_id: string }>("SELECT object_id FROM collection_members WHERE collection_id = $1", [collectionId])).rows.map((r) => r.object_id));
    const errors: Record<string, string> = {};
    positions.forEach((p, i) => {
      if (p === null || typeof p !== "object" || typeof (p as Record<string, unknown>).object_id !== "string") {
        errors[`positions.${i}.object_id`] = "That note is not in this collection.";
        return;
      }
      const rec = p as Record<string, unknown>;
      if (!memberIds.has(String(rec.object_id))) errors[`positions.${i}.object_id`] = "That note is not in this collection.";
      for (const axis of ["x", "y"] as const) {
        const v = rec[axis];
        if (typeof v !== "number" || !Number.isInteger(v) || v % 8 !== 0 || v < -8000 || v > 8000) {
          errors[`positions.${i}.${axis}`] = "Use a multiple of 8 between -8000 and 8000.";
        }
      }
    });
    if (Object.keys(errors).length > 0) throw validation(errors);
    await withTransaction(ctx, async (client) => {
      for (const p of positions as Array<Record<string, unknown>>) {
        await client.query(
          `INSERT INTO board_positions (collection_id, object_id, x, y) VALUES ($1, $2, $3, $4)
           ON CONFLICT (collection_id, object_id) DO UPDATE SET x = $3, y = $4`,
          [collectionId, String(p.object_id), p.x as number, p.y as number]
        );
      }
      await recordEvent(client, "board.saved", {
        collection_id: collectionId,
        positions: (positions as Array<Record<string, unknown>>).map((p) => ({ object_id: String(p.object_id), x: p.x as number, y: p.y as number })),
      });
    });
    const b = await boardJson(ctx.pool, collectionId);
    return { status: 200, body: b };
  }
  if (rest === "/objects" && method === "POST") {
    const body = jsonBody(req);
    if (typeof body.object_id !== "string") {
      throw validation({ object_id: "That note no longer exists." });
    }
    const obj = await ctx.pool.query("SELECT id FROM objects WHERE id = $1", [body.object_id]);
    if (obj.rows.length === 0) throw validation({ object_id: "That note no longer exists." });
    await withTransaction(ctx, async (client) => {
      await client.query(
        `INSERT INTO collection_members (collection_id, object_id) VALUES ($1, $2)
         ON CONFLICT (collection_id, object_id) DO NOTHING`,
        [collectionId, body.object_id as string]
      );
      await touchObject(client, String(body.object_id));
      await recordEvent(client, "object.saved", { object_id: String(body.object_id) });
    });
    return { status: 204, body: null };
  }
  const memberMatch = /^\/objects\/([^/]+)$/.exec(rest);
  if (memberMatch !== null && method === "DELETE") {
    const objectId = memberMatch[1];
    const res = await withTransaction(ctx, async (client) => {
      const del = await client.query("DELETE FROM collection_members WHERE collection_id = $1 AND object_id = $2", [collectionId, objectId]);
      if (del.rowCount === 1) {
        await client.query("DELETE FROM board_positions WHERE collection_id = $1 AND object_id = $2", [collectionId, objectId]);
        await recordEvent(client, "object.saved", { object_id: objectId });
        return true;
      }
      return false;
    });
    if (!res) throw notFound();
    return { status: 204, body: null };
  }
  if (rest === "/share-links" && method === "GET") {
    const rows = await ctx.pool.query("SELECT id, collection_id, token, expires_at, status, created_at, revoked_at FROM share_links WHERE collection_id = $1 ORDER BY created_at DESC", [collectionId]);
    return {
      status: 200,
      body: { share_links: rows.rows.map((r) => shareLinkJson(r, ctx.homeTimeZone)) },
    };
  }
  if (rest === "/share-links" && method === "POST") {
    const body = jsonBody(req);
    const errors: Record<string, string> = {};
    const raw = typeof body.expires_at === "string" ? body.expires_at : "";
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(raw);
    let instant: Date | null = null;
    if (m === null) {
      errors.expires_at = "Use a date and time.";
    } else {
      if (!isRealDate(m[1])) errors.expires_at = "Use a date and time.";
      else {
        instant = localMinuteToUtc(m[1], m[2], ctx.homeTimeZone, new Date());
        if (instant === null) errors.expires_at = "That time does not exist in your home clock.";
        else {
          const now = new Date();
          if (instant.getTime() <= now.getTime()) errors.expires_at = "Choose a time after the current minute.";
          else if (instant.getTime() > now.getTime() + 90 * 86400000) errors.expires_at = "Links can last at most 90 days.";
        }
      }
    }
    if (Object.keys(errors).length > 0) throw validation(errors);
    const id = randomUUID();
    const token = newShareToken();
    await withTransaction(ctx, async (client) => {
      await client.query(
        "INSERT INTO share_links (id, collection_id, token, expires_at, status, created_at, revoked_at) VALUES ($1, $2, $3, $4, 'active', now(), NULL)",
        [id, collectionId, token, instant as Date]
      );
      await recordEvent(client, "share_link.changed", { collection_id: collectionId, share_link_id: id });
    });
    const link = await loadShareLink(ctx.pool, id);
    if (link === null) throw notFound();
    return { status: 201, body: shareLinkJson(link, ctx.homeTimeZone) };
  }
  throw notFound();
}

export async function handleShareLinkActions(ctx: Ctx, sync: LiveSync, req: ApiRequest, method: string, path: string): Promise<RouteResult> {
  const revokeMatch = /^\/api\/share-links\/([^/]+)\/(revoke|regenerate)$/.exec(path);
  if (method !== "POST" || revokeMatch === null) throw notFound();
  const linkId = revokeMatch[1];
  if (!isUuid(linkId)) throw notFound();
  const action = revokeMatch[2];

  // one winner: the conditional update under the row lock decides
  interface Outcome {
    notFound?: boolean;
    notActive?: string;
    regenerated?: string;
    revoked?: boolean;
  }
  const result = await withTransaction<Outcome>(ctx, async (client): Promise<Outcome> => {
    const locked = await client.query("SELECT id, collection_id, token, expires_at, status, created_at, revoked_at FROM share_links WHERE id = $1 FOR UPDATE", [linkId]);
    if (locked.rows.length === 0) return { notFound: true };
    const link = locked.rows[0];
    const status = shareStatus(link);
    if (status !== "active") {
      return { notActive: status };
    }
    const upd = await client.query("UPDATE share_links SET status = 'revoked', revoked_at = now() WHERE id = $1 AND status = 'active'", [linkId]);
    if (upd.rowCount !== 1) return { notActive: shareStatus(link) };
    await recordEvent(client, "share_link.changed", { collection_id: link.collection_id, share_link_id: linkId });
    if (action === "revoke") {
      return { revoked: true };
    }
    // regenerate: same collection and expiry, a new active link
    const newId = randomUUID();
    const token = newShareToken();
    await client.query(
      "INSERT INTO share_links (id, collection_id, token, expires_at, status, created_at, revoked_at) VALUES ($1, $2, $3, $4, 'active', now(), NULL)",
      [newId, link.collection_id, token, link.expires_at]
    );
    await recordEvent(client, "share_link.changed", { collection_id: link.collection_id, share_link_id: newId });
    return { regenerated: newId };
  });

  if (result.notFound === true) throw notFound();
  if (result.notActive !== undefined) {
    throw new HttpError(409, { error: "link_not_active", status: result.notActive });
  }
  void result.revoked;
  // remove the cached renderings of the affected link(s)
  ctx.s3.listPrefix(`share-cache/${linkId}/`).then((keys) => {
    for (const k of keys) ctx.s3.deleteObjectRetry(k).catch(() => undefined);
  });
  if (result.regenerated !== undefined) {
    const link = await loadShareLink(ctx.pool, result.regenerated);
    if (link === null) throw notFound();
    return { status: 201, body: shareLinkJson(link, ctx.homeTimeZone) };
  }
  const link = await loadShareLink(ctx.pool, linkId);
  if (link === null) throw notFound();
  return { status: 200, body: shareLinkJson(link, ctx.homeTimeZone) };
}

// ---------------------------------------------------------------------------
// Saved queries

interface QueryRow {
  id: string;
  name: string;
  type_id: string;
  text: string;
  group_by: string | null;
  sort: Array<{ key: string; dir: string }>;
}

async function queryById(ctx: Ctx, id: string): Promise<QueryRow | null> {
  const res = await ctx.pool.query<{ id: string; name: string; type_id: string; text: string; group_by: string | null; sort: Array<{ key: string; dir: string }> }>(
    "SELECT id, name, type_id, text, group_by, sort FROM saved_queries WHERE id = $1",
    [id]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0];
}

function queryJson(q: QueryRow): Record<string, unknown> {
  return { id: q.id, name: q.name, type_id: q.type_id, text: q.text, group_by: q.group_by, sort: q.sort };
}

async function checkQueryText(ctx: Ctx, typeId: string, text: string): Promise<string | null> {
  const t = await typeById(ctx, typeId);
  if (t === null) return null;
  const types = await typesOfPool(ctx.pool);
  const relationTarget = (field: { target_type_id: string | null }): { id: string; name: string; fields: QFieldDef[] } | null => {
    const target = types.find((x) => x.id === field.target_type_id);
    return target ? { id: target.id, name: target.name, fields: target.fields } : null;
  };
  const parsed = parseQuery(text, { type: { id: t.id, name: t.name, fields: t.fields }, today: ctx.today(), relationTarget });
  return parsed.error === null ? null : parsed.error.message;
}

async function computeResults(ctx: Ctx, q: QueryRow): Promise<Record<string, unknown>> {
  const t = await typeById(ctx, q.type_id);
  if (t === null) throw notFound();
  const types = await typesOfPool(ctx.pool);
  const rows = await ctx.pool.query<{ id: string; title: string; created_at: Date; updated_at: Date }>(
    "SELECT id, title, created_at, updated_at FROM objects WHERE type_id = $1",
    [q.type_id]
  );
  const props = await ctx.pool.query<{ object_id: string; field_name: string; value: unknown }>("SELECT object_id, field_name, value FROM properties");
  const backlinkRows = await ctx.pool.query<{ to_object_id: string; n: string }>(
    "SELECT to_object_id, count(*)::text AS n FROM link_edges GROUP BY to_object_id"
  );
  const backlinks = new Map(backlinkRows.rows.map((r) => [r.to_object_id, Number(r.n)]));
  const propMap = new Map<string, Record<string, unknown>>();
  for (const p of props.rows) {
    const entry = propMap.get(p.object_id) ?? {};
    entry[p.field_name] = p.value;
    propMap.set(p.object_id, entry);
  }
  const titleById = new Map(rows.rows.map((r) => [r.id, r.title]));
  const zone = ctx.homeTimeZone;

  const relationTarget = (field: { target_type_id: string | null }): { id: string; name: string; fields: QFieldDef[] } | null => {
    const target = types.find((x) => x.id === field.target_type_id);
    return target ? { id: target.id, name: target.name, fields: target.fields } : null;
  };
  const parsed = parseQuery(q.text, { type: { id: t.id, name: t.name, fields: t.fields }, today: ctx.today(), relationTarget });
  if (parsed.error !== null) throw validation({ text: parsed.error.message });

  interface Row {
    id: string;
    title: string;
    type_name: string;
    backlinks: number;
    updated_at: string;
    updated_date: string;
    properties: Record<string, unknown>;
  }
  const matching: Row[] = [];
  for (const r of rows.rows) {
    const qObj = {
      id: r.id,
      title: r.title,
      properties: propMap.get(r.id) ?? {},
      backlinks: backlinks.get(r.id) ?? 0,
      updated_at: r.updated_at.toISOString(),
      updated_date: homeDate(r.updated_at, zone),
    };
    if (evalQuery(parsed.ast, qObj, {
      today: ctx.today(),
      resolveRelation: (id: unknown): { id: string; title: string; properties: Record<string, unknown>; backlinks: number; updated_at: string; updated_date: string } | null => {
        const oid = typeof id === "string" ? id : null;
        if (oid === null) return null;
        const row = rows.rows.find((x) => x.id === oid);
        if (row === undefined) return null;
        return {
          id: row.id,
          title: row.title,
          properties: propMap.get(row.id) ?? {},
          backlinks: backlinks.get(row.id) ?? 0,
          updated_at: row.updated_at.toISOString(),
          updated_date: homeDate(row.updated_at, zone),
        };
      },
    })) {
      matching.push({
        id: r.id,
        title: r.title,
        type_name: t.name,
        backlinks: backlinks.get(r.id) ?? 0,
        updated_at: r.updated_at.toISOString(),
        updated_date: homeDate(r.updated_at, zone),
        properties: propMap.get(r.id) ?? {},
      });
    }
  }

  // sorting: one to three keys, nulls last, then title ascending, then id
  const sortOf = (key: string): { kind: "text" | "url" | "select" | "relation" | "number" | "date"; options: string[] | null } | null => {
    if (key === "@title") return { kind: "text", options: null };
    if (key === "@backlinks") return { kind: "number", options: null };
    if (key === "@updated") return { kind: "date", options: null };
    const field = t.fields.find((f) => f.name === key);
    if (field === undefined) return null;
    return { kind: field.kind as "text" | "url" | "select" | "relation" | "number" | "date", options: field.options };
  };
  const valueOf = (row: Row, key: string): unknown => {
    if (key === "@title") return row.title;
    if (key === "@backlinks") return row.backlinks;
    if (key === "@updated") return row.updated_date;
    return row.properties[key] ?? null;
  };
  const cmpCtx = { titleOf: (id: unknown): string | null => (typeof id === "string" ? titleById.get(id) ?? null : null) };
  matching.sort((a, b) => {
    for (const key of q.sort) {
      const s = sortOf(key.key);
      if (s === null) continue;
      let cmp = compareByKind(s.kind, valueOf(a, key.key), valueOf(b, key.key), cmpCtx, s.options);
      if (key.dir === "desc") cmp = -cmp;
      if (cmp !== 0) return cmp;
    }
    const tc = compareByKind("text", a.title, b.title, cmpCtx);
    if (tc !== 0) return tc;
    return a.id < b.id ? -1 : 1;
  });
  const capped = matching.slice(0, 200);
  const rowJson = (r: Row): Record<string, unknown> => ({
    id: r.id,
    title: r.title,
    type_name: r.type_name,
    backlinks: r.backlinks,
    updated_at: r.updated_at,
  });
  const results = capped.map(rowJson);

  let groups: Array<{ key: unknown; label: string; count: number; results: Array<Record<string, unknown>> }> | null = null;
  if (q.group_by !== null) {
    const field = t.fields.find((f) => f.name === q.group_by);
    const kind = field !== undefined && (field.kind === "select" || field.kind === "relation" || field.kind === "date" || field.kind === "text") ? field.kind : null;
    if (kind !== null) {
      const buckets = new Map<unknown, Array<Record<string, unknown>>>();
      const labels = new Map<unknown, string>();
      for (const r of capped) {
        const value = r.properties[q.group_by] ?? null;
        const key = value === null ? null : value;
        let label = "No value";
        if (value !== null) {
          if (kind === "relation") label = (typeof value === "string" ? titleById.get(value) : null) ?? "No value";
          else label = String(value);
        }
        const bucket = buckets.get(key) ?? [];
        bucket.push(rowJson(r));
        buckets.set(key, bucket);
        labels.set(key, label);
      }
      groups = [];
      const entries = [...buckets.entries()];
      for (const [key, list] of entries) {
        const label = labels.get(key) ?? "No value";
        groups.push({
          key,
          label,
          count: list.length,
          results: list,
        });
      }
      groups.sort((a, b) => {
        if (a.label === "No value" && b.label !== "No value") return 1;
        if (b.label === "No value" && a.label !== "No value") return -1;
        return compareByKind("text", a.label, b.label, cmpCtx);
      });
    }
  }
  return { results, groups };
}

export async function handleQueries(ctx: Ctx, sync: LiveSync, req: ApiRequest, method: string, path: string): Promise<RouteResult> {
  if (method === "GET" && path === "/api/queries") {
    const rows = await ctx.pool.query("SELECT id, name, type_id, text, group_by, sort FROM saved_queries ORDER BY lower(name) ASC");
    return { status: 200, body: { queries: rows.rows.map((r) => queryJson(r)) } };
  }
  if (method === "POST" && path === "/api/queries/check") {
    const body = jsonBody(req);
    const errors: Record<string, string> = {};
    const typeId = typeof body.type_id === "string" ? body.type_id : "";
    const t = typeId !== "" ? await typeById(ctx, typeId) : null;
    if (t === null) errors.type_id = "Choose a type.";
    const text = typeof body.text === "string" ? body.text : "";
    if (text.length > QUERY_TEXT_CAP) errors.text = "Use at most 500 characters.";
    else if (t !== null) {
      const err = await checkQueryText(ctx, t.id, text);
      if (err !== null) errors.text = err;
    }
    if (Object.keys(errors).length > 0) throw validation(errors);
    return { status: 200, body: { ok: true } };
  }
  if (method === "POST" && path === "/api/queries") {
    const body = jsonBody(req);
    const errors: Record<string, string> = {};
    const name = typeof body.name === "string" ? body.name : "";
    if (name.trim().length === 0) errors.name = "Give the query a name.";
    const typeId = typeof body.type_id === "string" ? body.type_id : "";
    const t = typeId !== "" ? await typeById(ctx, typeId) : null;
    if (t === null) errors.type_id = "Choose a type.";
    const text = typeof body.text === "string" ? body.text : "";
    if (text.length > QUERY_TEXT_CAP) errors.text = "Use at most 500 characters.";
    else if (t !== null) {
      const err = await checkQueryText(ctx, t.id, text);
      if (err !== null) errors.text = err;
    }
    let groupBy: string | null = null;
    if (body.group_by !== undefined && body.group_by !== null) {
      if (typeof body.group_by !== "string") {
        errors.group_by = "Group by a select, relation, date or text field of this type.";
      } else {
        const field = t?.fields.find((f) => f.name === body.group_by && (f.kind === "select" || f.kind === "relation" || f.kind === "date" || f.kind === "text"));
        if (field === undefined) errors.group_by = "Group by a select, relation, date or text field of this type.";
        else groupBy = body.group_by;
      }
    }
    const sort = body.sort;
    if (!Array.isArray(sort) || sort.length < 1 || sort.length > 3) {
      errors.sort = "Use one to three sort keys.";
    } else {
      sort.forEach((s, i) => {
        if (s === null || typeof s !== "object" || typeof (s as Record<string, unknown>).key !== "string") {
          errors[`sort.${i}.key`] = "That sort key is not on this type.";
        } else {
          const key = (s as Record<string, unknown>).key as string;
          if (key !== "@title" && key !== "@backlinks" && key !== "@updated" && t?.fields.find((f) => f.name === key) === undefined) {
            errors[`sort.${i}.key`] = "That sort key is not on this type.";
          }
        }
        const dir = s !== null && typeof s === "object" ? (s as Record<string, unknown>).dir : undefined;
        if (dir !== "asc" && dir !== "desc") errors[`sort.${i}.dir`] = "Use asc or desc.";
      });
    }
    if (Object.keys(errors).length > 0) throw validation(errors);
    const id = randomUUID();
    await withTransaction(ctx, async (client) => {
      await client.query(
        "INSERT INTO saved_queries (id, name, type_id, text, group_by, sort, created_at) VALUES ($1, $2, $3, $4, $5, $6, now())",
        [id, name, typeId, text, groupBy, JSON.stringify(sort)]
      );
    });
    const q = await queryById(ctx, id);
    if (q === null) throw notFound();
    return { status: 201, body: queryJson(q) };
  }
  const qMatch = /^\/api\/queries\/([^/]+)(\/results)?$/.exec(path);
  if (qMatch === null) throw notFound();
  const id = qMatch[1];
  if (!isUuid(id)) throw notFound();
  const wantResults = qMatch[2] === "/results";
  const q = await queryById(ctx, id);
  if (q === null) throw notFound();
  if (wantResults && method === "GET") {
    const body = await computeResults(ctx, q);
    return { status: 200, body };
  }
  if (!wantResults && method === "GET") {
    return { status: 200, body: queryJson(q) };
  }
  if (!wantResults && method === "DELETE") {
    await ctx.pool.query("DELETE FROM saved_queries WHERE id = $1", [id]);
    return { status: 204, body: null };
  }
  throw notFound();
}

// ---------------------------------------------------------------------------
// Graph, search and timeline

export async function handleGraph(ctx: Ctx, req: ApiRequest): Promise<RouteResult> {
  const shareLinkId = req.query.get("share_link_id");
  let scope: Set<string> | null = null;
  if (shareLinkId !== null) {
    const link = await loadShareLink(ctx.pool, shareLinkId);
    if (link === null || shareStatus(link) !== "active") {
      throw validation({ share_link_id: "Choose an active share link." });
    }
    scope = await shareScopeIds(ctx.pool, link.collection_id);
  }
  const objects = await ctx.pool.query<{ id: string; title: string; type_id: string; type_name: string; share_visibility: string }>(
    `SELECT o.id, o.title, o.type_id, t.name AS type_name, o.share_visibility
     FROM objects o JOIN object_types t ON t.id = o.type_id
     ORDER BY t.library_order ASC, lower(o.title) ASC, o.id ASC`
  );
  const members = await ctx.pool.query<{ collection_id: string; object_id: string }>("SELECT collection_id, object_id FROM collection_members");
  const edges = await ctx.pool.query<{ id: string; from_object_id: string; to_object_id: string; kind: string }>(
    "SELECT id::text AS id, from_object_id, to_object_id, kind FROM link_edges ORDER BY id ASC"
  );
  return {
    status: 200,
    body: {
      nodes: objects.rows.map((o) => ({
        id: o.id,
        title: o.title,
        type_id: o.type_id,
        type_name: o.type_name,
        collection_ids: members.rows.filter((m) => m.object_id === o.id).map((m) => m.collection_id),
        backlinks: 0,
        ...(scope !== null ? { in_scope: scope.has(o.id) } : {}),
      })),
      edges: edges.rows.map((e) => ({ id: Number(e.id), from: e.from_object_id, to: e.to_object_id, kind: e.kind })),
    },
  };
}

export async function handleSearch(ctx: Ctx, req: ApiRequest): Promise<RouteResult> {
  const q = req.query.get("q") ?? "";
  if (q.trim().length > SEARCH_CAP) throw validation({ q: "Search with at most 200 characters." });
  if (q.trim().length === 0) return { status: 200, body: { results: [] } };
  const types = await typesOfPool(ctx.pool);
  const objects = await ctx.pool.query<{ id: string; title: string; type_id: string; updated_at: Date }>(
    "SELECT id, title, type_id, updated_at FROM objects ORDER BY lower(title) ASC"
  );
  const blocks = await ctx.pool.query<{ object_id: string; body: string; position: number }>(
    "SELECT object_id, body, position FROM blocks WHERE kind = 'text' ORDER BY object_id ASC, position ASC"
  );
  const docs = objects.rows.map((o) => {
    const own = blocks.rows.filter((b) => b.object_id === o.id).map((b) => ({ plain: plainText(b.body), tokens: tokens(plainText(b.body)) }));
    return {
      objectId: o.id,
      title: o.title,
      titleTokens: tokens(o.title),
      blocks: own,
      updatedDate: homeDate(o.updated_at, ctx.homeTimeZone),
    };
  });
  const ranked = rankSearch(q, docs, ctx.today());
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const titleById = new Map(objects.rows.map((o) => [o.id, o.title]));
  void titleById;
  return {
    status: 200,
    body: {
      results: ranked.map((r) => ({
        object_id: r.object_id,
        title: r.title,
        type_name: typeName.get(objects.rows.find((o) => o.id === r.object_id)?.type_id ?? "") ?? "",
        score: r.score,
        snippet: r.snippet,
      })),
    },
  };
}

export async function handleTimeline(ctx: Ctx, req: ApiRequest): Promise<RouteResult> {
  const today = ctx.today();
  const earliest = await ctx.pool.query<{ date: string }>("SELECT min(daily_date) AS date FROM objects WHERE daily_date IS NOT NULL");
  const start = earliest.rows[0].date ?? today;
  const notes = await ctx.pool.query<{ id: string; daily_date: string }>("SELECT id, daily_date FROM objects WHERE daily_date IS NOT NULL");
  const noteByDate = new Map(notes.rows.map((n) => [n.daily_date, n.id]));
  const blockRows = await ctx.pool.query<{ object_id: string; id: string; kind: string; body: string; position: number; filename: string | null; origin_plain: string | null }>(
    `SELECT b.object_id, b.id, b.kind, b.body, b.position, a.filename,
            CASE WHEN b.kind = 'quote' THEN (SELECT rb.body FROM blocks rb WHERE rb.id = b.origin_block_id) ELSE NULL END AS origin_plain
     FROM blocks b LEFT JOIN attachments a ON a.id = b.attachment_id
     ORDER BY b.object_id ASC, b.position ASC`
  );
  const blocksByNote = new Map<string, Array<{ id: string; kind: string; excerpt: string; movable: boolean }>>();
  for (const b of blockRows.rows) {
    const list = blocksByNote.get(b.object_id) ?? [];
    const plain = b.kind === "quote" ? plainText(b.origin_plain ?? "") : b.kind === "attachment" ? (b.filename ?? "") : plainText(b.body);
    list.push({ id: b.id, kind: b.kind, excerpt: plain.slice(0, 30), movable: b.kind !== "attachment" });
    blocksByNote.set(b.object_id, list);
  }
  const days: Array<{ date: string; object_id: string | null; block_count: number; blocks: Array<{ id: string; kind: string; excerpt: string; movable: boolean }> }> = [];
  let cursor = new Date(`${start}T00:00:00Z`).getTime();
  const end = new Date(`${today}T00:00:00Z`).getTime();
  if (end < cursor) {
    days.push({ date: today, object_id: noteByDate.get(today) ?? null, block_count: 0, blocks: [] });
  }
  while (cursor <= end) {
    const date = new Date(cursor).toISOString().slice(0, 10);
    const objectId = noteByDate.get(date) ?? null;
    const blocks = objectId !== null ? blocksByNote.get(objectId) ?? [] : [];
    days.push({ date, object_id: objectId, block_count: blocks.length, blocks });
    cursor += 86400000;
  }
  return { status: 200, body: { today, days } };
}
