// Dossiers, publishing, preview links and takedown (API: "Dossiers"; Business rules: "Dossier
// lifecycle", "Publishing", "Unpublish and takedown", "Preview links").
import { randomUUID } from "node:crypto";
import { requirePublish } from "../billing.ts";
import { config } from "../config.ts";
import { exclusive, pool, transaction, type Queryable } from "../db.ts";
import { ApiError, DOSSIER_BODY_LIMIT, jsonBody, notFound, route, sendJson, UUID, validationError, type Ctx } from "../http.ts";
import { newToken, tokenHash } from "../passwords.ts";
import { noteCount, publishFooter, renderDossier, type CandidateNote, type RenderedObject } from "../publish.ts";
import { clearPrefix, putObject, StorageUnavailable } from "../s3.ts";
import { requireSession, type Session } from "../session.ts";
import { boundary, candidateProblem } from "../../shared/boundary.ts";
import { transition, type DossierAction, type DossierState } from "../../shared/dossier.ts";
import { formatWhen, isoSeconds } from "../../shared/time.ts";
import type { Dossier, PreviewLink, PreviewLinkState } from "../../shared/types.ts";

export interface DossierRow {
  id: string;
  account_id: string;
  slug: string;
  root_note_id: string;
  state: DossierState;
  radius: number | null;
  public_count: number | null;
  severed_count: number | null;
  published_at: Date | null;
  live_publish_id: string | null;
}

interface LinkRow {
  id: string;
  state: PreviewLinkState;
  created_at: Date;
  expires_at: Date;
}

const DOSSIER_COLUMNS = "id, account_id, slug, root_note_id, state, radius, public_count, severed_count, published_at, live_publish_id";

function linkJson(row: LinkRow): PreviewLink {
  return { id: row.id, state: row.state, created_at: isoSeconds(row.created_at), expires_at: isoSeconds(row.expires_at) };
}

/** An active link that reached expires_at is expired, and its dossier is reported as draft from then on. */
export async function settleExpiredLinks(db: Queryable, dossierId: string | null): Promise<string[]> {
  const { rows } = await db.query<{ id: string; dossier_id: string }>(
    `UPDATE preview_links SET state = 'expired' WHERE state = 'active' AND expires_at <= now() AND ($1::uuid IS NULL OR dossier_id = $1)
     RETURNING id, dossier_id`, [dossierId]);
  const expire: DossierAction = "expire_preview_link";
  for (const row of rows) {
    await db.query("UPDATE dossiers SET state = $2 WHERE id = $1 AND state = 'in_review'", [row.dossier_id, transition("in_review", expire)]);
  }
  return rows.map((r) => r.id);
}

async function dossierJson(row: DossierRow, db: Queryable = pool): Promise<Dossier> {
  const active = await db.query<LinkRow>("SELECT id, state, created_at, expires_at FROM preview_links WHERE dossier_id = $1 AND state = 'active'", [row.id]);
  return {
    id: row.id, slug: row.slug, root_note_id: row.root_note_id, state: row.state, radius: row.radius,
    public_count: row.public_count, severed_count: row.severed_count,
    published_at: row.published_at ? isoSeconds(row.published_at) : null,
    url: `/d/${row.slug}/`, preview_link: active.rows[0] ? linkJson(active.rows[0]) : null,
  };
}

async function ownDossier(session: Session, id: string): Promise<DossierRow> {
  if (!UUID.test(id)) throw notFound();
  await settleExpiredLinks(pool, id);
  const { rows } = await pool.query<DossierRow>(`SELECT ${DOSSIER_COLUMNS} FROM dossiers WHERE id = $1 AND account_id = $2`, [id, session.account.id]);
  if (!rows[0]) throw notFound();
  return rows[0];
}

function invalidTransition(state: DossierState): ApiError {
  return new ApiError(409, "invalid_transition", "The dossier can't make that move from its current state.", { state });
}

function nextState(row: DossierRow, action: DossierAction): DossierState {
  const next = transition(row.state, action);
  if (next === null) throw invalidTransition(row.state);
  return next;
}

/** Moves a dossier along the lifecycle, only from the state it was read in; anything else is invalid_transition. */
async function move(db: Queryable, row: DossierRow, action: DossierAction, set = "", params: unknown[] = []): Promise<DossierRow> {
  const next = nextState(row, action);
  const { rows } = await db.query<DossierRow>(
    `UPDATE dossiers SET state = $2${set} WHERE id = $1 AND state = $3 RETURNING ${DOSSIER_COLUMNS}`, [row.id, next, row.state, ...params]);
  if (!rows[0]) throw invalidTransition((await db.query<{ state: DossierState }>("SELECT state FROM dossiers WHERE id = $1", [row.id])).rows[0].state);
  return rows[0];
}

const SLUG = /^[a-z0-9-]{3,48}$/;

route("POST", "/api/dossiers", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  await requirePublish(session.account);
  const body = jsonBody(ctx);
  const fields: Record<string, string> = {};
  if (typeof body.slug !== "string" || !SLUG.test(body.slug)) fields.slug = "Use 3 to 48 lowercase letters, digits and hyphens.";
  if (typeof body.root_note_id !== "string" || !UUID.test(body.root_note_id)) fields.root_note_id = "Choose the root note.";
  if (Object.keys(fields).length) throw validationError(fields);
  try {
    const { rows } = await pool.query<DossierRow>(
      `INSERT INTO dossiers (id, account_id, slug, root_note_id, state) VALUES ($1, $2, $3, $4, 'draft') RETURNING ${DOSSIER_COLUMNS}`,
      [randomUUID(), session.account.id, body.slug, body.root_note_id]);
    sendJson(ctx.res, 201, { dossier: await dossierJson(rows[0]) });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new ApiError(409, "slug_taken", "That dossier address is taken.");
    throw error;
  }
});

route("GET", "/api/dossiers", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  await settleExpiredLinks(pool, null);
  const { rows } = await pool.query<DossierRow>(`SELECT ${DOSSIER_COLUMNS} FROM dossiers WHERE account_id = $1 ORDER BY created_at, id`, [session.account.id]);
  sendJson(ctx.res, 200, { dossiers: await Promise.all(rows.map((r) => dossierJson(r))) });
});

route("GET", "/api/dossiers/:id", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  sendJson(ctx.res, 200, { dossier: await dossierJson(await ownDossier(session, ctx.params.id)) });
});

const isStringList = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");

function isCandidateNote(value: unknown): value is CandidateNote {
  if (!value || typeof value !== "object") return false;
  const n = value as Record<string, unknown>;
  return typeof n.id === "string" && typeof n.title === "string" && isStringList(n.aliases)
    && typeof n.frontmatter === "object" && n.frontmatter !== null && !Array.isArray(n.frontmatter)
    && typeof n.body === "string" && typeof n.private === "boolean";
}

/** The radius and candidate notes of a manifest preview, publish or preview link request. */
function boundaryRequest(ctx: Ctx, rootId: string): { radius: number; notes: CandidateNote[] } {
  const body = jsonBody(ctx);
  const fields: Record<string, string> = {};
  const radius = body.radius;
  if (!Number.isInteger(radius) || (radius as number) < 0 || (radius as number) > 4) fields.radius = "Choose a hop radius from 0 to 4.";
  const raw: unknown = body.notes;
  const notes: CandidateNote[] = Array.isArray(raw) && raw.every(isCandidateNote) ? raw : [];
  if (notes.length === 0) {
    fields.notes = "Send each note with id, title, aliases, frontmatter, body and private.";
  } else {
    const problem = candidateProblem(notes, rootId);
    if (problem) fields.notes = problem;
  }
  if (Object.keys(fields).length) throw validationError(fields);
  return { radius: radius as number, notes };
}

route("POST", "/api/dossiers/:id/manifest-preview", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  const dossier = await ownDossier(session, ctx.params.id);
  const { radius, notes } = boundaryRequest(ctx, dossier.root_note_id);
  const result = boundary(notes, dossier.root_note_id, radius);
  sendJson(ctx.res, 200, { radius, public_count: result.inside.length, severed_count: result.severed.length, inside: result.inside });
}, DOSSIER_BODY_LIMIT);

async function writeAll(prefix: string, objects: RenderedObject[]): Promise<void> {
  for (let i = 0; i < objects.length; i += 8) {
    await Promise.all(objects.slice(i, i + 8).map((o) => putObject(prefix + o.path, o.body, o.contentType)));
  }
}

/** Best-effort removal; whatever storage refuses now, the sweep removes later. */
async function clearLater(prefix: string, table: "publishes" | "preview_links", id: string): Promise<void> {
  try {
    await clearPrefix(prefix);
    await pool.query(`UPDATE ${table} SET objects_cleared = true WHERE id = $1`, [id]);
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
  }
}

async function ownerZone(accountId: string): Promise<string> {
  return (await pool.query<{ time_zone: string }>("SELECT time_zone FROM accounts WHERE id = $1", [accountId])).rows[0].time_zone;
}

route("POST", "/api/dossiers/:id/publish", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  const first = await ownDossier(session, ctx.params.id);
  await requirePublish(session.account);
  nextState(first, "publish");
  const published = await exclusive(`publish:${first.id}`, async () => {
    const dossier = await ownDossier(session, first.id);
    nextState(dossier, "publish");
    const { radius, notes } = boundaryRequest(ctx, dossier.root_note_id);
    const publishedAt = new Date();
    const rendered = renderDossier({ notes, rootId: dossier.root_note_id, radius, slug: dossier.slug, banner: null,
      footer: (count) => publishFooter(publishedAt, count, session.account.time_zone) });
    const objects = rendered.objects;
    const publishId = randomUUID();
    const prefix = `publish/${dossier.slug}/${publishId}/`;
    await pool.query("INSERT INTO publishes (id, dossier_id, prefix, status, manifest) VALUES ($1, $2, $3, 'writing', $4)",
      [publishId, dossier.id, prefix, { inside: rendered.inside, pages: rendered.pages, keys: objects.map((o) => o.path) }]);
    try {
      await writeAll(prefix, objects);
    } catch (error) {
      await pool.query("UPDATE publishes SET status = 'failed' WHERE id = $1", [publishId]);
      throw error;
    }
    const { previous, revoked, row } = await transaction(async (db) => {
      const before = await db.query<{ id: string; prefix: string }>(
        "SELECT p.id, p.prefix FROM dossiers d JOIN publishes p ON p.id = d.live_publish_id WHERE d.id = $1", [dossier.id]);
      const links = await db.query<{ id: string }>(
        "UPDATE preview_links SET state = 'revoked' WHERE dossier_id = $1 AND state = 'active' RETURNING id", [dossier.id]);
      await db.query("UPDATE publishes SET status = 'retired' WHERE dossier_id = $1 AND status = 'live'", [dossier.id]);
      await db.query("UPDATE publishes SET status = 'live' WHERE id = $1", [publishId]);
      const updated = await move(db, dossier, "publish", ", radius = $4, public_count = $5, severed_count = $6, published_at = $7, live_publish_id = $8",
        [radius, rendered.publicCount, rendered.severedCount, publishedAt, publishId]);
      return { previous: before.rows[0], revoked: links.rows, row: updated };
    });
    if (previous) await clearLater(previous.prefix, "publishes", previous.id);
    for (const link of revoked) await clearLater(`preview/${link.id}/`, "preview_links", link.id);
    return row;
  });
  if (!published) throw new ApiError(409, "publish_in_progress", "Another publish of this dossier is still running.");
  sendJson(ctx.res, 200, { dossier: await dossierJson(published) });
}, DOSSIER_BODY_LIMIT);

/**
 * Unpublish and takedown: clear the live pointer (readers get 404 at once), delete every object
 * under the dossier's publish prefix, confirm it is empty, and only then set the state.
 */
export async function takeDown(dossier: DossierRow, action: "unpublish" | "takedown"): Promise<number> {
  nextState(dossier, action);
  await pool.query("UPDATE dossiers SET live_publish_id = NULL WHERE id = $1", [dossier.id]);
  const removed = await clearPrefix(`publish/${dossier.slug}/`);
  await transaction(async (db) => {
    await move(db, dossier, action);
    await db.query("UPDATE publishes SET objects_cleared = true, status = CASE WHEN status = 'live' THEN 'retired' ELSE status END WHERE dossier_id = $1", [dossier.id]);
  });
  return removed;
}

route("POST", "/api/dossiers/:id/unpublish", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  const dossier = await ownDossier(session, ctx.params.id);
  await takeDown(dossier, "unpublish");
  sendJson(ctx.res, 200, { dossier: await dossierJson(await ownDossier(session, dossier.id)) });
});

route("POST", "/api/dossiers/:id/reopen", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  const dossier = await ownDossier(session, ctx.params.id);
  sendJson(ctx.res, 200, { dossier: await dossierJson(await move(pool, dossier, "reopen")) });
});

route("POST", "/api/dossiers/:id/preview-links", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  const dossier = await ownDossier(session, ctx.params.id);
  await requirePublish(session.account);
  nextState(dossier, "create_preview_link");
  const { radius, notes } = boundaryRequest(ctx, dossier.root_note_id);
  const linkId = randomUUID();
  const token = newToken();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + config.timers.previewTtl * 1000);
  const zone = await ownerZone(dossier.account_id);
  const rendered = renderDossier({
    notes, rootId: dossier.root_note_id, radius, slug: dossier.slug,
    banner: `Draft preview · expires ${formatWhen(expiresAt.toISOString(), zone)}`,
    footer: (count) => `Draft rendered ${formatWhen(createdAt.toISOString(), zone)} · ${noteCount(count)}`,
  });
  const prefix = `preview/${linkId}/`;
  try {
    await writeAll(prefix, rendered.objects);
  } catch (error) {
    if (error instanceof StorageUnavailable) await clearPrefix(prefix).catch((cleanup: Error) => console.error("preview cleanup deferred:", cleanup.message));
    throw error;
  }
  const replaced = await transaction(async (db) => {
    const old = await db.query<{ id: string }>("UPDATE preview_links SET state = 'replaced' WHERE dossier_id = $1 AND state = 'active' RETURNING id", [dossier.id]);
    await db.query(
      "INSERT INTO preview_links (id, dossier_id, token_hash, state, manifest, created_at, expires_at) VALUES ($1, $2, $3, 'active', $4, $5, $6)",
      [linkId, dossier.id, tokenHash(token), { pages: rendered.pages }, createdAt, expiresAt]);
    await move(db, dossier, "create_preview_link");
    return old.rows;
  });
  for (const link of replaced) await clearLater(`preview/${link.id}/`, "preview_links", link.id);
  sendJson(ctx.res, 201, {
    preview_link: linkJson({ id: linkId, state: "active", created_at: createdAt, expires_at: expiresAt }),
    url: `/p/${token}/`,
  });
}, DOSSIER_BODY_LIMIT);

route("GET", "/api/dossiers/:id/preview-links", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  const dossier = await ownDossier(session, ctx.params.id);
  const { rows } = await pool.query<LinkRow>(
    "SELECT id, state, created_at, expires_at FROM preview_links WHERE dossier_id = $1 ORDER BY created_at DESC, id", [dossier.id]);
  sendJson(ctx.res, 200, { preview_links: rows.map(linkJson) });
});

route("DELETE", "/api/dossiers/:id/preview-links/:link", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  const dossier = await ownDossier(session, ctx.params.id);
  if (!UUID.test(ctx.params.link)) throw notFound();
  const link = await transaction(async (db) => {
    const { rows } = await db.query<LinkRow>("SELECT id, state, created_at, expires_at FROM preview_links WHERE id = $1 AND dossier_id = $2 FOR UPDATE",
      [ctx.params.link, dossier.id]);
    if (!rows[0]) throw notFound();
    if (rows[0].state !== "active") throw new ApiError(409, "preview_link_inactive", "This preview link has already ended.");
    const updated = await db.query<LinkRow>("UPDATE preview_links SET state = 'revoked' WHERE id = $1 RETURNING id, state, created_at, expires_at", [rows[0].id]);
    if (transition(dossier.state, "revoke_preview_link")) await move(db, dossier, "revoke_preview_link");
    return updated.rows[0];
  });
  await clearLater(`preview/${link.id}/`, "preview_links", link.id);
  sendJson(ctx.res, 200, { preview_link: linkJson(link) });
});
