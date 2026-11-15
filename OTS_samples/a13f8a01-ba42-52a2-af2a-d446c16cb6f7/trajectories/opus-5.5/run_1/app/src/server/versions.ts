import type { PoolClient } from "pg";
import { findShelfEntry } from "../shared/shelf";
import { paneNames, type Files, type Version, type VersionEntry } from "../shared/types";
import { loadVisiblePen, requireOwner, requireVerified, type PenRow } from "./access";
import { sha256Hex } from "./auth";
import { config } from "./config";
import { changeStats, diffFiles, emptyFiles } from "./diff";
import { one, pool, rows, transaction, type Queryable } from "./db";
import { ApiError, notFound, StorageUnavailable, validation } from "./errors";
import { announce, publishHead } from "./events";
import { json, readJson, requireUser, type Context, type JsonObject, type Reply } from "./http";
import { withIdempotency } from "./idempotency";
import { getObject, putObject } from "./storage";
import { storedZip } from "./zip";

interface VersionRow {
  pen_id: string;
  number: number;
  created_at: Date;
  sha256: string;
  html: Buffer;
  css: Buffer;
  js: Buffer;
  libraries: string[];
  restored_from: number | null;
  added: number;
  removed: number;
  changed_chars: number;
}

export interface Snapshot {
  files: Files;
  libraries: string[];
}

const paneLabels = { html: "HTML", css: "CSS", js: "JS" } as const;

export function canonicalSha256(snapshot: Snapshot): string {
  const parts: Buffer[] = [];
  for (const pane of paneNames) {
    const bytes = Buffer.from(snapshot.files[pane], "utf8");
    parts.push(Buffer.from(`${pane} ${bytes.length}\n`, "utf8"), bytes, Buffer.from("\n", "utf8"));
  }
  parts.push(Buffer.from(`libraries ${snapshot.libraries.join(",")}\n`, "utf8"));
  return sha256Hex(Buffer.concat(parts));
}

function snapshotKey(penId: string, number: number): string {
  return `pens/${penId}/versions/${number}.json`;
}

function filesOf(row: VersionRow): Files {
  return { html: row.html.toString("utf8"), css: row.css.toString("utf8"), js: row.js.toString("utf8") };
}

export function toVersion(row: VersionRow): Version {
  return {
    pen_id: row.pen_id,
    number: row.number,
    created_at: row.created_at.toISOString(),
    sha256: row.sha256,
    files: filesOf(row),
    libraries: row.libraries,
    restored_from: row.restored_from,
  };
}

function toEntry(row: VersionRow): VersionEntry {
  return {
    number: row.number,
    created_at: row.created_at.toISOString(),
    sha256: row.sha256,
    restored_from: row.restored_from,
    added: row.added,
    removed: row.removed,
    changed_chars: row.changed_chars,
  };
}

export async function findVersion(db: Queryable, penId: string, number: number): Promise<Version | null> {
  const row = await one<VersionRow>(db, "SELECT * FROM versions WHERE pen_id = $1 AND number = $2", [penId, number]);
  return row ? toVersion(row) : null;
}

/** Validates submitted panes and libraries; returns field errors keyed by pane or "libraries". */
export function parseSnapshot(body: JsonObject): Snapshot {
  const files = body.files;
  const fields: Record<string, string> = {};
  if (typeof files !== "object" || files === null || Array.isArray(files)) {
    throw validation({ files: "Send html, css and js as strings." });
  }
  const record = files as Record<string, unknown>;
  const parsed: Files = { ...emptyFiles };
  for (const pane of paneNames) {
    const text = record[pane];
    if (typeof text !== "string") {
      fields[pane] = `Send the ${paneLabels[pane]} pane as a string.`;
      continue;
    }
    if (Buffer.byteLength(text, "utf8") > config.paneLimitBytes) {
      fields[pane] = `The ${paneLabels[pane]} pane is over ${config.paneLimitBytes} bytes, so this version was not saved.`;
    }
    parsed[pane] = text;
  }
  const libraries = body.libraries === undefined ? [] : body.libraries;
  if (!Array.isArray(libraries) || libraries.some((id) => typeof id !== "string" || !findShelfEntry(id)) || new Set(libraries).size !== libraries.length) {
    fields.libraries = "Libraries must be distinct ids from the shelf.";
  }
  if (Object.keys(fields).length > 0) throw validation(fields);
  return { files: parsed, libraries: libraries as string[] };
}

/** Writes the snapshot object, reads it back and confirms its hash. */
export async function storeSnapshot(penId: string, number: number, snapshot: Snapshot): Promise<string> {
  const sha256 = canonicalSha256(snapshot);
  const body = Buffer.from(JSON.stringify({ pen_id: penId, number, sha256, files: snapshot.files, libraries: snapshot.libraries }), "utf8");
  await putObject(snapshotKey(penId, number), body, "application/json");
  const stored = await getObject(snapshotKey(penId, number));
  if (!stored || !stored.equals(body)) throw new StorageUnavailable("snapshot read-back did not match");
  const parsed = JSON.parse(stored.toString("utf8")) as Snapshot;
  if (canonicalSha256(parsed) !== sha256) throw new StorageUnavailable("snapshot hash did not match");
  return sha256;
}

async function headFiles(db: Queryable, pen: { id: string; head: number }): Promise<Files> {
  if (pen.head === 0) return emptyFiles;
  return ((await findVersion(db, pen.id, pen.head)) as Version).files;
}

/**
 * Appends version head+1. The caller holds the pen row lock and has checked base_version,
 * so the number is gapless and the object at its key always matches its row.
 */
export async function appendVersion(
  client: PoolClient,
  pen: { id: string; head: number },
  snapshot: Snapshot,
  restoredFrom: number | null,
  createdAt: Date | null = null,
): Promise<Version> {
  const number = pen.head + 1;
  const stats = changeStats(await headFiles(client, pen), snapshot.files);
  const sha256 = await storeSnapshot(pen.id, number, snapshot);
  const row = await one<VersionRow>(
    client,
    `INSERT INTO versions (pen_id, number, created_at, sha256, html, css, js, libraries, restored_from, added, removed, changed_chars)
     VALUES ($1, $2, coalesce($3::timestamptz, now()), $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [
      pen.id,
      number,
      createdAt?.toISOString() ?? null,
      sha256,
      Buffer.from(snapshot.files.html, "utf8"),
      Buffer.from(snapshot.files.css, "utf8"),
      Buffer.from(snapshot.files.js, "utf8"),
      snapshot.libraries,
      restoredFrom,
      stats.added,
      stats.removed,
      stats.changed_chars,
    ],
  );
  await client.query("UPDATE pens SET head = $2, updated_at = coalesce($3::timestamptz, now()) WHERE id = $1", [pen.id, number, createdAt?.toISOString() ?? null]);
  return toVersion(row as VersionRow);
}

function requireBaseVersion(body: JsonObject, pen: PenRow): void {
  const base = body.base_version;
  if (typeof base !== "number" || !Number.isInteger(base)) throw validation({ base_version: "Send the version your edits are based on." });
  if (base !== pen.head) throw new ApiError("version_conflict", { head: pen.head });
}

function storageFailure(error: unknown, message: string): never {
  if (error instanceof StorageUnavailable) throw new ApiError("storage_unavailable", { message });
  throw error;
}

export async function saveVersion(ctx: Context): Promise<Reply> {
  const user = requireUser(ctx);
  const penId = ctx.params[0] as string;
  return withIdempotency(ctx, user, penId, async () => {
    const version = await transaction(async (client) => {
      const pen = await loadVisiblePen(client, penId, user, true);
      requireOwner(pen, user);
      requireVerified(user);
      const body = readJson(ctx);
      requireBaseVersion(body, pen);
      const snapshot = parseSnapshot(body);
      try {
        return await appendVersion(client, pen, snapshot, null);
      } catch (error) {
        return storageFailure(error, "Storage is unreachable, so this version was not saved.");
      }
    });
    announce(publishHead(penId, version.number));
    return json(201, version);
  });
}

export async function restoreVersion(ctx: Context): Promise<Reply> {
  const user = requireUser(ctx);
  const penId = ctx.params[0] as string;
  return withIdempotency(ctx, user, penId, async () => {
    const version = await transaction(async (client) => {
      const pen = await loadVisiblePen(client, penId, user, true);
      const body = readJson(ctx);
      const wanted = body.version;
      const source = typeof wanted === "number" && Number.isInteger(wanted) ? await findVersion(client, penId, wanted) : null;
      if (typeof wanted === "number" && Number.isInteger(wanted) && !source) throw notFound();
      requireOwner(pen, user);
      requireVerified(user);
      requireBaseVersion(body, pen);
      if (!source) throw validation({ version: "Send the number of the version to restore." });
      try {
        return await appendVersion(client, pen, { files: source.files, libraries: source.libraries }, source.number);
      } catch (error) {
        return storageFailure(error, `Storage is unreachable, so version ${source.number} was not restored.`);
      }
    });
    announce(publishHead(penId, version.number));
    return json(201, version);
  });
}

export async function listVersions(ctx: Context): Promise<Reply> {
  const pen = await loadVisiblePen(pool, ctx.params[0] as string, ctx.user);
  const found = await rows<VersionRow>(pool, "SELECT * FROM versions WHERE pen_id = $1 ORDER BY number", [pen.id]);
  return json(200, { versions: found.map(toEntry) });
}

function versionNumber(raw: string | null | undefined): number | null {
  return raw !== null && raw !== undefined && /^\d{1,9}$/.test(raw) ? Number(raw) : null;
}

export async function getVersion(ctx: Context): Promise<Reply> {
  const pen = await loadVisiblePen(pool, ctx.params[0] as string, ctx.user);
  const number = versionNumber(ctx.params[1]);
  const version = number === null ? null : await findVersion(pool, pen.id, number);
  if (!version) throw notFound();
  return json(200, version);
}

export async function diffVersions(ctx: Context): Promise<Reply> {
  const pen = await loadVisiblePen(pool, ctx.params[0] as string, ctx.user);
  const a = versionNumber(ctx.url.searchParams.get("a"));
  const b = versionNumber(ctx.url.searchParams.get("b"));
  const before = a === null ? null : await findVersion(pool, pen.id, a);
  const after = b === null ? null : await findVersion(pool, pen.id, b);
  if ((a !== null && !before) || (b !== null && !after)) throw notFound();
  if (!before || !after) throw validation({ ...(a === null ? { a: "Send a version number." } : {}), ...(b === null ? { b: "Send a version number." } : {}) });
  return json(200, diffFiles(before.number, after.number, before.files, after.files));
}

export async function exportPen(ctx: Context): Promise<Reply> {
  const pen = await loadVisiblePen(pool, ctx.params[0] as string, ctx.user);
  if (pen.head === 0) throw new ApiError("nothing_to_export");
  const version = (await findVersion(pool, pen.id, pen.head)) as Version;
  let stored: Buffer | null;
  try {
    stored = await getObject(snapshotKey(pen.id, version.number));
  } catch (error) {
    return storageFailure(error, "Storage is unreachable, so the export was not made.");
  }
  const snapshot = stored ? (JSON.parse(stored.toString("utf8")) as Snapshot) : null;
  if (!snapshot || canonicalSha256(snapshot) !== version.sha256) {
    throw new ApiError("storage_unavailable", { message: "Storage did not return this version, so the export was not made." });
  }
  const zip = storedZip(
    [
      { name: "index.html", data: Buffer.from(snapshot.files.html, "utf8") },
      { name: "style.css", data: Buffer.from(snapshot.files.css, "utf8") },
      { name: "script.js", data: Buffer.from(snapshot.files.js, "utf8") },
    ],
    new Date(version.created_at),
  );
  return {
    kind: "raw",
    status: 200,
    body: zip,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${pen.id}-v${version.number}.zip"`,
      "Cache-Control": "no-store",
    },
  };
}
