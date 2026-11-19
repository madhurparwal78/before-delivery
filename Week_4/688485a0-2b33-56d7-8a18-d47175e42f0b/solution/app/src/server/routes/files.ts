import { randomUUID } from "node:crypto";
import type { JsonObject, JsonValue } from "../../shared/json.js";
import { type ErrorBody, documentMessage } from "../../shared/messages.js";
import { isUuid, openCollection, projectAccess, requireWriter } from "../access.js";
import { requireUser } from "../auth.js";
import { config } from "../config.js";
import { db, transaction } from "../db.js";
import { parseCsv, renderCsv, renderJsonLines } from "../engine/csv.js";
import { choosePlan } from "../engine/indexes.js";
import { compact, dateInstant, isPlainObject } from "../engine/value.js";
import { ApiError, fail } from "../errors.js";
import { route } from "../http.js";
import { getObject, putObject } from "../s3.js";
import { utcText } from "../time.js";
import { ID_INDEX, findConflicts, insertDocuments, loadIndexes, prepareDocument } from "../store.js";
import { compileQuery, loadForPlan, matchingDocuments } from "./queries.js";

/** File loads (stored before they are parsed) and collection downloads. */

const base = "/api/projects/:pid/collections/:cid";
const ERROR_CAP = 20;
const FORMATS = ["jsonl", "csv"];

interface LineError {
  line: number;
  message: string;
}

type Row = { line: number; doc: JsonObject } | { line: number; error: string };

function inferCell(cell: string): JsonValue {
  if (cell === "true" || cell === "false") return cell === "true";
  if (cell === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(cell)) return Number(cell);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(cell) && dateInstant(cell) !== null) return { $date: cell };
  return cell;
}

function setNested(target: JsonObject, path: string[], value: JsonValue): void {
  const [head, ...rest] = path;
  if (head === undefined) return;
  if (rest.length === 0) {
    target[head] = value;
    return;
  }
  const inner = target[head];
  const child: JsonObject = isPlainObject(inner) ? inner : {};
  target[head] = child;
  setNested(child, rest, value);
}

type Parsed = { dataLines: number; headerErrors: LineError[]; rows: () => Row[] };

function parseJsonLines(text: string): Parsed {
  const physical = (text.startsWith("﻿") ? text.slice(1) : text).split("\n");
  const lines = physical.flatMap((raw, index) => {
    const content = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    return content.trim() === "" ? [] : [{ line: index + 1, content }];
  });
  const rows = (): Row[] =>
    lines.map(({ line, content }) => {
      let parsed: JsonValue;
      try {
        parsed = JSON.parse(content) as JsonValue;
      } catch {
        return { line, error: "not valid JSON" };
      }
      const isObject = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
      return isObject ? { line, doc: parsed as JsonObject } : { line, error: "not an object" };
    });
  return { dataLines: lines.length, headerErrors: [], rows };
}

function parseCsvFile(text: string): Parsed {
  const [header, ...records] = parseCsv(text);
  if (!header) return { dataLines: 0, headerErrors: [{ line: 1, message: "missing header row" }], rows: () => [] };
  const names = header.cells;
  const headerErrors: LineError[] = [];
  names.forEach((name, index) => {
    if (names.indexOf(name) < index) headerErrors.push({ line: 1, message: `duplicate header ${name}` });
  });
  for (const name of names) {
    if (names.some((other) => other.startsWith(`${name}.`))) headerErrors.push({ line: 1, message: `conflicting header ${name}` });
  }
  const rows = (): Row[] =>
    records.map(({ line, cells }) => {
      if (cells.length !== names.length) return { line, error: `row has ${cells.length} cells, header has ${names.length}` };
      const doc: JsonObject = {};
      names.forEach((name, index) => {
        const cell = cells[index] as string;
        if (cell !== "" && name !== "") setNested(doc, name.split("."), inferCell(cell));
      });
      return { line, doc };
    });
  return { dataLines: records.length, headerErrors, rows };
}

const lineMessage = (error: ApiError, validator: JsonObject | null): string => documentMessage(error.body() as ErrorBody, validator) ?? error.code;

interface LoadRow {
  id: string;
  file_name: string;
  format: string;
  state: string;
  bytes: number;
  inserted: number;
  errors: string;
  created_at: Date;
}

const loadJson = (row: LoadRow): JsonObject => ({
  id: row.id,
  file_name: row.file_name,
  format: row.format,
  state: row.state,
  bytes: row.bytes,
  inserted: row.inserted,
  errors: JSON.parse(row.errors) as JsonValue,
  created_at: utcText(row.created_at),
});

const LOAD_COLUMNS = "id, file_name, format, state, bytes, inserted, errors, created_at";

async function findLoad(collectionId: string, id: string): Promise<LoadRow> {
  const found = isUuid(id) ? (await db.query<LoadRow>(`SELECT ${LOAD_COLUMNS} FROM file_loads WHERE id = $1 AND collection_id = $2`, [id, collectionId])).rows[0] : undefined;
  return found ?? fail("not_found");
}

function uploadName(header: string | string[] | undefined): string {
  const raw = (Array.isArray(header) ? header[0] : header) ?? "";
  try {
    return decodeURIComponent(raw) || "upload";
  } catch {
    return raw || "upload";
  }
}

route(
  "POST",
  `${base}/imports`,
  async (ctx) => {
    const { user, role, collection } = await openCollection(ctx);
    requireWriter(role);
    const format = ctx.query.get("format");
    if (format === null || !FORMATS.includes(format)) fail("invalid_field", { field: "format" });
    const bytes = ctx.bytes;
    const id = randomUUID();
    await db.query("INSERT INTO file_loads (id, collection_id, user_id, file_name, format, state, bytes) VALUES ($1, $2, $3, $4, $5, 'uploading', $6)", [id, collection.id, user.id, uploadName(ctx.req.headers["x-file-name"]), format, bytes.length]);
    try {
      await putObject(`imports/${id}`, bytes);
    } catch (error) {
      await db.query("UPDATE file_loads SET state = 'refused' WHERE id = $1", [id]);
      throw error;
    }
    await db.query("UPDATE file_loads SET state = 'stored' WHERE id = $1", [id]);
    await db.query("UPDATE file_loads SET state = 'parsing' WHERE id = $1", [id]);
    const parsed = format === "csv" ? parseCsvFile(bytes.toString("utf8")) : parseJsonLines(bytes.toString("utf8"));
    const finish = (inserted: number, errors: LineError[]): Promise<unknown> =>
      db.query("UPDATE file_loads SET state = 'finished', inserted = $2, errors = $3 WHERE id = $1", [id, inserted, compact(errors as unknown as JsonValue)]);
    if (parsed.dataLines > config.limits.importMaxLines) {
      await finish(0, []);
      return fail("too_many_lines", { limit: config.limits.importMaxLines });
    }
    const outcome = await transaction(async (client) => {
      await client.query("SELECT 1 FROM collections WHERE id = $1 FOR UPDATE", [collection.id]);
      const errors: LineError[] = [...parsed.headerErrors];
      const accepted: { line: number; doc: JsonObject }[] = [];
      if (errors.length === 0) {
        for (const row of parsed.rows()) {
          if ("error" in row) {
            errors.push({ line: row.line, message: row.error });
            continue;
          }
          try {
            accepted.push({ line: row.line, doc: prepareDocument(row.doc, collection) });
          } catch (error) {
            if (!(error instanceof ApiError)) throw error;
            errors.push({ line: row.line, message: lineMessage(error, collection.validator) });
          }
        }
        const uniques = (await loadIndexes(client, collection.id)).filter((index) => index.unique && index !== ID_INDEX);
        const conflicts = await findConflicts(client, collection.id, accepted.map(({ doc }) => ({ id: doc["_id"] as string, doc })), [...uniques]);
        const stillAccepted = accepted.filter(({ line }, position) => {
          const conflict = conflicts[position];
          if (conflict) errors.push({ line, message: lineMessage(new ApiError("duplicate_key", { index: conflict.index, value: conflict.value }), collection.validator) });
          return conflict === null;
        });
        errors.sort((a, b) => a.line - b.line);
        if (errors.length === 0 && stillAccepted.length > 0) await insertDocuments(client, collection.id, stillAccepted.map(({ doc }) => doc));
        return { errors, inserted: errors.length === 0 ? stillAccepted.length : 0 };
      }
      return { errors, inserted: 0 };
    });
    const errors = outcome.errors.slice(0, ERROR_CAP);
    await finish(outcome.inserted, errors);
    if (errors.length > 0) return fail("import_failed", { import_id: id, errors: errors as unknown as JsonValue });
    return { status: 201, body: { import_id: id, inserted: outcome.inserted } };
  },
  "file",
);

route("GET", `${base}/imports`, async (ctx) => {
  const { collection } = await openCollection(ctx);
  const result = await db.query<LoadRow>(`SELECT ${LOAD_COLUMNS} FROM file_loads WHERE collection_id = $1 ORDER BY position DESC`, [collection.id]);
  return { status: 200, body: { imports: result.rows.map(loadJson) } };
});

route("GET", `${base}/imports/:iid`, async (ctx) => {
  const { collection } = await openCollection(ctx);
  return { status: 200, body: loadJson(await findLoad(collection.id, ctx.params["iid"] as string)) };
});

function attachment(name: string): string {
  const safe = name.replace(/["\\\r\n]/g, "_");
  return /^[\x20-\x7e]*$/.test(safe) ? `attachment; filename="${safe}"` : `attachment; filename="${safe.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

route("GET", `${base}/imports/:iid/original`, async (ctx) => {
  const { collection } = await openCollection(ctx);
  const load = await findLoad(collection.id, ctx.params["iid"] as string);
  if (load.state === "refused" || load.state === "uploading") return fail("not_found");
  const bytes = await getObject(`imports/${load.id}`);
  return { status: 200, raw: bytes, type: "application/octet-stream", headers: { "content-disposition": attachment(load.file_name) } };
});

route("POST", `${base}/exports`, async (ctx) => {
  const { collection } = await openCollection(ctx);
  const body = ctx.object();
  const format = body["format"];
  if (typeof format !== "string" || !FORMATS.includes(format)) fail("invalid_field", { field: "format" });
  const compiled = compileQuery({ filter: body["filter"], sort: body["sort"] });
  const plan = choosePlan(compiled.spec.filter, await loadIndexes(db, collection.id));
  const { docs } = await loadForPlan(collection.id, plan);
  const matched = matchingDocuments(docs, compiled);
  const id = randomUUID();
  const text = format === "csv" ? renderCsv(matched) : renderJsonLines(matched);
  await putObject(`exports/${id}.${format}`, Buffer.from(text, "utf8"));
  await db.query("INSERT INTO downloads (id, collection_id, format) VALUES ($1, $2, $3)", [id, collection.id, format]);
  return { status: 201, body: { export_id: id, download_url: `/api/projects/${ctx.params["pid"]}/exports/${id}` } };
});

route("GET", "/api/projects/:pid/exports/:eid", async (ctx) => {
  const { project } = await projectAccess(await requireUser(ctx), ctx.params["pid"] as string);
  const id = ctx.params["eid"] as string;
  const found = isUuid(id)
    ? (await db.query<{ format: string; name: string }>("SELECT d.format, c.name FROM downloads d JOIN collections c ON c.id = d.collection_id WHERE d.id = $1 AND c.project_id = $2", [id, project.id])).rows[0]
    : undefined;
  if (!found) return fail("not_found");
  const bytes = await getObject(`exports/${id}.${found.format}`);
  const type = found.format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson; charset=utf-8";
  return { status: 200, raw: bytes, type, headers: { "content-disposition": attachment(`${found.name}.${found.format}`) } };
});
