// Stored solids and thumbnails served from storage, and a revision's build tape from the database.
import type { TapeJson, TapeOperation } from "../shared/api";
import { db } from "./db";
import { notFound, StorageUnavailable } from "./errors";
import type { Ctx } from "./http";
import { get, type Route } from "./route";
import { loadRevision, readablePart } from "./records";
import { jsonReply, type Reply } from "./reply";
import { getObject } from "./storage";
import { reportJson } from "./preflight";

const DIGEST = /^[0-9a-f]{64}$/;
const IMMUTABLE = "public, max-age=31536000, immutable";

function stored(prefix: string, extension: string, contentType: string) {
  return async (ctx: Ctx): Promise<Reply> => {
    const digest = ctx.params.digest;
    if (!DIGEST.test(digest)) throw notFound();
    const bytes = await getObject(`${prefix}/${digest}.${extension}`);
    if (!bytes) throw notFound();
    return { status: 200, headers: { "Content-Type": contentType, "Cache-Control": IMMUTABLE }, body: bytes };
  };
}

/** The bytes of a stored object that must exist; a missing one is storage that has lost what it confirmed. */
export async function requiredObject(key: string): Promise<Buffer> {
  const bytes = await getObject(key);
  if (!bytes) throw new StorageUnavailable(`${key} is missing from storage`);
  return bytes;
}

async function tape(ctx: Ctx): Promise<Reply> {
  const revision = await loadRevision(db, ctx.params.id);
  if (!revision) throw notFound();
  await readablePart(ctx, revision.part_slug);
  const operations = await db.rows<TapeOperation>(
    "SELECT idx AS index, kind, op, line, digest, volume, delta, bbox FROM tape_operations WHERE revision_id = $1 ORDER BY idx",
    [revision.id],
  );
  const report = await db.row<Parameters<typeof reportJson>[0]>(
    "SELECT * FROM preflight_reports WHERE geometry_digest = $1 AND status = 'complete' ORDER BY created_at DESC, id DESC LIMIT 1",
    [revision.geometry_digest],
  );
  const body: TapeJson = {
    revisionId: revision.id,
    partSlug: revision.part_slug,
    n: operations.length - 1,
    operations,
    preflight: report ? reportJson(report) : null,
  };
  return jsonReply(200, body);
}

export const objectRoutes: Route[] = [
  get("/api/solids/:digest", stored("solids", "json", "application/json"), { outage: "download" }),
  get("/api/solids/:digest/thumbnail.svg", stored("thumbnails", "svg", "image/svg+xml"), { outage: "download" }),
  get("/api/revisions/:id/tape", tape),
];
