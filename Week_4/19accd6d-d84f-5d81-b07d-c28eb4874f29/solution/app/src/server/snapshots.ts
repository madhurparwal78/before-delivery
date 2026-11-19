import type { Snapshot, SnapshotStatus } from "../shared/api";
import { SNAPSHOT_REVOKED_MESSAGE, snapshotExpiredMessage } from "../shared/snapshot-copy";
import type { Step } from "../shared/operations/types";
import { parseSteps } from "../shared/operations/validate";
import { ttlSeconds } from "../shared/ttl";
import { limits } from "./config";
import { pool, query, queryOne } from "./db";
import type { Db } from "./db";
import { ApiError, notFound, storageUnavailable, validationFailed } from "./errors";
import { Context, defineRoute, reply } from "./http";
import type { Route } from "./http";
import { asRecord } from "../shared/records";
import { versionOf, visibleRecipe } from "./recipes";
import { fileBytes, sha256Of } from "./files";
import { newToken } from "./session";
import { getObject, putObject, StorageUnavailable } from "./storage";

const SNAPSHOT_LIMIT = 3_000_000;
const RETRY_MS = 5000;

interface SnapshotRow {
  token: string;
  owner_id: string;
  recipe_name: string;
  recipe_version: number | null;
  steps: Step[];
  created_at: Date;
  expires_at: Date;
  confirmed_at: Date | null;
  revoked_at: Date | null;
  input_bytes: number;
  output_bytes: number;
  input_sha256: string;
  output_sha256: string;
}

/**
 * The snapshot lifecycle, decided from the server clock on every read: revoked beats everything,
 * then an elapsed lifetime means expired, then storage confirmation separates pending from active.
 */
export function snapshotStatus(row: Pick<SnapshotRow, "revoked_at" | "expires_at" | "confirmed_at">, now: Date): SnapshotStatus {
  if (row.revoked_at) return "revoked";
  if (now >= row.expires_at) return "expired";
  return row.confirmed_at ? "active" : "pending";
}

function toSnapshot(row: SnapshotRow, now: Date): Snapshot {
  const status = snapshotStatus(row, now);
  return {
    token: row.token,
    status,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    recipe: status === "expired" || status === "revoked" ? null : { name: row.recipe_name, version: row.recipe_version, steps: row.steps },
    inputBytes: row.input_bytes,
    outputBytes: row.output_bytes,
    url: `/s/${row.token}`,
  };
}

async function readSnapshot(db: Db, token: string): Promise<Snapshot | null> {
  const row = await queryOne<SnapshotRow>(db, "SELECT * FROM snapshots WHERE token = $1", [token]);
  return row ? toSnapshot(row, new Date()) : null;
}

interface NewSnapshot {
  ownerId: string;
  recipeName: string;
  recipeVersion: number | null;
  steps: Step[];
  input: Buffer;
  output: Buffer;
  ttl: string;
  createdAt: Date;
}

/** Records a snapshot as pending, keeping its bytes until storage confirms them. */
export async function createSnapshot(db: Db, snapshot: NewSnapshot): Promise<string> {
  const token = newToken();
  const expiresAt = new Date(snapshot.createdAt.getTime() + (ttlSeconds(snapshot.ttl) as number) * 1000);
  await db.query(
    `INSERT INTO snapshots (token, owner_id, recipe_name, recipe_version, steps, created_at, expires_at, input_bytes, output_bytes,
                            input_sha256, output_sha256, pending_input, pending_output)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      token, snapshot.ownerId, snapshot.recipeName, snapshot.recipeVersion, JSON.stringify(snapshot.steps), snapshot.createdAt,
      expiresAt, snapshot.input.length, snapshot.output.length, sha256Of(snapshot.input), sha256Of(snapshot.output),
      snapshot.input, snapshot.output,
    ],
  );
  return token;
}

/**
 * Writes a pending snapshot's objects, reads them back and compares size and SHA-256 with what was received;
 * only then does the snapshot become active. A storage outage leaves it pending.
 */
export async function confirmSnapshot(token: string): Promise<void> {
  const row = await queryOne<SnapshotRow & { pending_input: Buffer; pending_output: Buffer }>(
    pool, "SELECT * FROM snapshots WHERE token = $1 AND confirmed_at IS NULL AND pending_input IS NOT NULL", [token],
  );
  if (!row) return;
  try {
    for (const [name, bytes, sha256] of [["input", row.pending_input, row.input_sha256], ["output", row.pending_output, row.output_sha256]] as const) {
      const key = `snapshots/${token}/${name}`;
      await putObject(key, bytes);
      const stored = await getObject(key);
      if (stored.length !== bytes.length || sha256Of(stored) !== sha256) throw new StorageUnavailable(`${key} did not read back intact`);
    }
  } catch (error) {
    if (error instanceof StorageUnavailable) return;
    throw error;
  }
  await pool.query("UPDATE snapshots SET confirmed_at = now(), pending_input = NULL, pending_output = NULL WHERE token = $1", [token]);
}

/** Retries every pending snapshot every 5 seconds until storage confirms it. */
export function startSnapshotRetry(): void {
  setInterval(() => {
    query<SnapshotRow>(pool, "SELECT * FROM snapshots WHERE confirmed_at IS NULL AND pending_input IS NOT NULL").then(
      async (rows) => {
        for (const row of rows.filter((candidate) => snapshotStatus(candidate, new Date()) === "pending")) await confirmSnapshot(row.token);
      },
      (error: unknown) => console.error("snapshot retry failed:", error instanceof Error ? error.message : error),
    );
  }, RETRY_MS).unref();
}

interface SnapshotRequest {
  steps: Step[];
  recipe: { id: string; version: number } | null;
  inputBase64: string | null;
  fileId: string | null;
  outputBase64: string;
  ttl: string;
}

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function parseSnapshotRequest(raw: unknown): SnapshotRequest {
  const body = asRecord(raw);
  const fields: Record<string, string> = {};
  const parsed = parseSteps(body.steps);
  if ("problems" in parsed) for (const problem of parsed.problems) fields[problem.path] = problem.message;
  const recipe = asRecord(body.recipe);
  if (body.recipe !== null && body.recipe !== undefined && (typeof recipe.id !== "string" || !Number.isInteger(recipe.version))) {
    fields.recipe = "recipe needs an id and a version, or null.";
  }
  const inputBase64 = typeof body.inputBase64 === "string" ? body.inputBase64 : null;
  const fileId = typeof body.fileId === "string" ? body.fileId : null;
  if ((inputBase64 === null) === (fileId === null)) fields.inputBase64 = "Send either inputBase64 or fileId.";
  else if (inputBase64 !== null && !BASE64_PATTERN.test(inputBase64)) fields.inputBase64 = "inputBase64 must be Base64.";
  if (typeof body.outputBase64 !== "string" || !BASE64_PATTERN.test(body.outputBase64)) fields.outputBase64 = "outputBase64 must be Base64.";
  if (typeof body.ttl !== "string" || !limits.shareTtlChoices.includes(body.ttl)) {
    fields.ttl = `ttl must be one of ${limits.shareTtlChoices.join(", ")}.`;
  }
  if (Object.keys(fields).length) throw validationFailed(fields);
  return {
    steps: "steps" in parsed ? parsed.steps : [],
    recipe: body.recipe ? { id: recipe.id as string, version: recipe.version as number } : null,
    inputBase64,
    fileId,
    outputBase64: body.outputBase64 as string,
    ttl: body.ttl as string,
  };
}

/** A snapshot as stored, before the server clock turns it into a status. */
interface SnapshotRecord {
  row: SnapshotRow;
}

async function snapshotOfPath(ctx: Context): Promise<SnapshotRecord> {
  const row = await queryOne<SnapshotRow>(pool, "SELECT * FROM snapshots WHERE token = $1", [ctx.params.token]);
  if (!row) throw notFound();
  return { row };
}

/** A snapshot's input or output, only while it is active. */
function download(part: "input" | "output"): Route {
  return defineRoute<SnapshotRecord>({
    method: "GET", path: `/api/snapshots/:token/${part}`, access: "public", resolve: snapshotOfPath,
    run: async (_, { row }) => {
      const status = snapshotStatus(row, new Date());
      if (status === "pending") throw new ApiError(409, "snapshot_pending", "This snapshot is waiting for storage to confirm its input.");
      if (status === "expired") throw new ApiError(409, "snapshot_expired", snapshotExpiredMessage(row.expires_at.toISOString()));
      if (status === "revoked") throw new ApiError(409, "snapshot_revoked", SNAPSHOT_REVOKED_MESSAGE);
      try {
        return { status: 200, bytes: await getObject(`snapshots/${row.token}/${part}`), headers: { "content-disposition": `attachment; filename="${part}.bin"` } };
      } catch (error) {
        throw error instanceof StorageUnavailable ? storageUnavailable("Storage is unavailable.") : error;
      }
    },
  });
}

/** The recipe and version a snapshot records, or none for an unsaved recipe. */
interface Reference {
  name: string;
  version: number | null;
}

export const snapshotRoutes: Route[] = [
  defineRoute<undefined, SnapshotRequest, Reference>({
    method: "POST", path: "/api/snapshots", access: "session", body: "json", limit: () => SNAPSHOT_LIMIT,
    check: async (ctx, _, body) => {
      const fileId = asRecord(body).fileId;
      if (typeof fileId === "string" && !(await queryOne(pool, "SELECT 1 FROM files WHERE id = $1 AND owner_id = $2", [fileId, ctx.me().id]))) {
        throw notFound();
      }
      const requested = asRecord(asRecord(body).recipe);
      if (typeof requested.id !== "string" || !Number.isInteger(requested.version)) return { name: "Unsaved recipe", version: null };
      const recipe = await visibleRecipe(pool, ctx.me().id, requested.id);
      const version = recipe ? await versionOf(pool, recipe.id, requested.version as number) : null;
      if (!version) throw notFound();
      return { name: version.name, version: version.n };
    },
    validate: parseSnapshotRequest,
    run: async (ctx, reference, request) => {
      const input = request.fileId ? await fileBytes(request.fileId) : Buffer.from(request.inputBase64 as string, "base64");
      const token = await createSnapshot(pool, {
        ownerId: ctx.me().id, recipeName: reference.name, recipeVersion: reference.version, steps: request.steps, input,
        output: Buffer.from(request.outputBase64, "base64"), ttl: request.ttl, createdAt: new Date(),
      });
      await confirmSnapshot(token);
      return reply(201, { snapshot: await readSnapshot(pool, token) });
    },
  }),
  defineRoute<SnapshotRecord>({
    method: "GET", path: "/api/snapshots/:token", access: "public", resolve: snapshotOfPath,
    run: async (_, { row }) => {
      const now = new Date();
      return reply(200, { snapshot: toSnapshot(row, now), serverTime: now.toISOString() });
    },
  }),
  download("input"),
  download("output"),
  defineRoute<SnapshotRecord>({
    method: "DELETE", path: "/api/snapshots/:token", access: "session",
    resolve: async (ctx) => {
      const found = await snapshotOfPath(ctx);
      if (found.row.owner_id !== ctx.me().id) throw notFound();
      return found;
    },
    run: async (_, { row }) => {
      await pool.query("UPDATE snapshots SET revoked_at = COALESCE(revoked_at, now()) WHERE token = $1", [row.token]);
      return reply(204);
    },
  }),
];
