import { PANES, type Diff, type Files, type Version, type VersionEntry } from "../shared/types.js";
import { canonicalSha256 } from "./canonical.js";
import { config } from "./config.js";
import { pool, type Tx } from "./db.js";
import { changedCharacters, diffFiles } from "./diff.js";
import { ApiError, notFound, StorageUnavailable, validation } from "./errors.js";
import { isShelfId } from "./shelf.js";
import { getObject, putObject } from "./storage.js";

export interface Content {
  files: Files;
  libraries: string[];
}

export const NO_FILES: Files = { html: "", css: "", js: "" };

const snapshotKey = (penId: string, number: number): string => `pens/${penId}/versions/${number}.json`;

interface Snapshot extends Content {
  pen_id: string;
  number: number;
  sha256: string;
}

interface VersionRow {
  number: number;
  created_at: Date;
  sha256: string;
  restored_from: number | null;
  added: number;
  removed: number;
  changed_chars: number;
}

const VERSION_COLUMNS = "number, created_at, sha256, restored_from, added, removed, changed_chars";

function parseSnapshot(bytes: Buffer): Snapshot {
  return JSON.parse(bytes.toString("utf8")) as Snapshot;
}

async function readSnapshot(penId: string, number: number, sha256: string): Promise<Content> {
  const snapshot = parseSnapshot(await getObject(snapshotKey(penId, number)));
  if (snapshot.sha256 !== sha256 || canonicalSha256(snapshot.files, snapshot.libraries) !== sha256) {
    throw new StorageUnavailable(new Error(`snapshot ${penId}/${number} does not match its hash`));
  }
  return { files: snapshot.files, libraries: snapshot.libraries };
}

export function isFiles(value: unknown): value is Files {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    PANES.every((pane) => typeof (value as Record<string, unknown>)[pane] === "string")
  );
}

export function isShelfSelection(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === "string" && isShelfId(id)) && new Set(value).size === value.length;
}

export function integerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** The one place a pane is checked against the size limit, a library against the shelf and the base against a number. */
function validateContent(files: unknown, libraries: unknown, baseKnown: boolean): Content {
  const problems: Record<string, string> = {};
  if (!baseKnown) problems["base_version"] = "Send the head version number the edits started from.";
  if (!isFiles(files)) problems["files"] = "Send html, css and js as text.";
  else {
    for (const pane of PANES) {
      if (Buffer.byteLength(files[pane], "utf8") > config.paneLimitBytes) {
        problems[pane] = `The ${pane.toUpperCase()} pane is over ${config.paneLimitBytes} bytes, so this version was not saved.`;
      }
    }
  }
  if (!isShelfSelection(libraries)) problems["libraries"] = "Pick each library once, from the pinned shelf.";
  if (Object.keys(problems).length > 0 || !isFiles(files) || !isShelfSelection(libraries)) throw validation(problems);
  return { files, libraries };
}

function metadata(row: VersionRow): Pick<Version, "number" | "created_at" | "sha256" | "restored_from"> {
  return { number: row.number, created_at: row.created_at.toISOString(), sha256: row.sha256, restored_from: row.restored_from };
}

function toEntry(row: VersionRow): VersionEntry {
  return { ...metadata(row), added: row.added, removed: row.removed, changed_chars: row.changed_chars };
}

function toVersion(penId: string, row: VersionRow, content: Content): Version {
  return { pen_id: penId, ...metadata(row), files: content.files, libraries: content.libraries };
}

interface SaveRequest {
  penId: string;
  base: unknown;
  content: () => Promise<{ files: unknown; libraries: unknown }>;
  restoredFrom?: number;
  createdAt?: Date;
}

export async function saveVersion(tx: Tx, request: SaveRequest): Promise<Version> {
  const { penId } = request;
  const locked = await tx.query("SELECT id FROM pens WHERE id = $1 FOR UPDATE", [penId]);
  if (locked.rowCount === 0) throw notFound();
  const latest = await tx.query<{ number: number; sha256: string }>(
    "SELECT number, sha256 FROM versions WHERE pen_id = $1 ORDER BY number DESC LIMIT 1",
    [penId],
  );
  const head = latest.rows[0]?.number ?? 0;
  const base = integerOrNull(request.base);
  if (base !== null && base !== head) {
    throw new ApiError("version_conflict", `Version ${head} of this pen was saved somewhere else. Your edits are still here.`, { head });
  }
  const raw = await request.content();
  const content = validateContent(raw.files, raw.libraries, base !== null);
  const number = head + 1;
  const expected = canonicalSha256(content.files, content.libraries);
  const key = snapshotKey(penId, number);
  await putObject(key, JSON.stringify({ pen_id: penId, number, sha256: expected, ...content }), "application/json");
  const confirmed = parseSnapshot(await getObject(key));
  const confirmedSha = canonicalSha256(confirmed.files, confirmed.libraries);
  if (confirmedSha !== expected || confirmed.sha256 !== expected) {
    throw new StorageUnavailable(new Error(`snapshot ${key} was not confirmed`));
  }
  const before = latest.rows[0] ? (await readSnapshot(penId, head, latest.rows[0].sha256)).files : NO_FILES;
  const changes = diffFiles(before, confirmed.files);
  const inserted = await tx.query<VersionRow>(
    `INSERT INTO versions (pen_id, number, created_at, sha256, restored_from, added, removed, changed_chars)
     VALUES ($1, $2, COALESCE($3::timestamptz, clock_timestamp()), $4, $5, $6, $7, $8) RETURNING ${VERSION_COLUMNS}`,
    [penId, number, request.createdAt ?? null, confirmedSha, request.restoredFrom ?? null, changes.added, changes.removed, changedCharacters(changes)],
  );
  await tx.query("UPDATE pens SET updated_at = clock_timestamp() WHERE id = $1", [penId]);
  return toVersion(penId, inserted.rows[0] as VersionRow, confirmed);
}

export async function listVersions(penId: string): Promise<VersionEntry[]> {
  const rows = await pool.query<VersionRow>(`SELECT ${VERSION_COLUMNS} FROM versions WHERE pen_id = $1 ORDER BY number`, [penId]);
  return rows.rows.map(toEntry);
}

export async function readVersion(penId: string, number: number): Promise<Version> {
  const found = await pool.query<VersionRow>(`SELECT ${VERSION_COLUMNS} FROM versions WHERE pen_id = $1 AND number = $2`, [penId, number]);
  const row = found.rows[0];
  if (!row) throw notFound();
  const content = await readSnapshot(penId, number, row.sha256);
  return toVersion(penId, row, content);
}

export function versionNumber(raw: string | null | undefined): number | null {
  return raw !== null && raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : null;
}

export async function readVersionFor(penId: string, wanted: unknown): Promise<Version> {
  const number = integerOrNull(wanted);
  if (number === null) throw validation({ version: "Send the version number to restore." });
  return readVersion(penId, number);
}

export async function diffVersions(penId: string, a: number, b: number): Promise<Diff> {
  const [from, to] = await Promise.all([readVersion(penId, a), readVersion(penId, b)]);
  return { a, b, ...diffFiles(from.files, to.files) };
}

export async function requireVersion(penId: string, number: number): Promise<void> {
  const found = await pool.query("SELECT 1 FROM versions WHERE pen_id = $1 AND number = $2", [penId, number]);
  if (found.rowCount === 0) throw notFound();
}
