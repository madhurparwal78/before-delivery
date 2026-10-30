// Follows belong to the person who made them; shortlists belong to a newsroom.
import { coopTime, isoInstant } from "../shared/coop-time.js";
import { newsroomOf, requireRole } from "./auth.js";
import { serverNow } from "./clock.js";
import { one, query } from "./db.js";
import { newId } from "./essays.js";
import { visibleEssay } from "./essay-model.js";
import { ApiError, notFound, sendJson, sendNoContent, validationFailed } from "./http.js";
import { isOnSheet, ON_SHEET } from "./lifecycle.js";
import { on, type Ctx } from "./router.js";
import { strictBody, WRONG_TYPE } from "./strict-body.js";

const TARGET_MESSAGE = "Follow one essay or one contributor";

interface FollowRow {
  id: string;
  essay_id: string | null;
  contributor: string | null;
}

const followBody = (f: FollowRow): FollowRow => ({ id: f.id, essay_id: f.essay_id, contributor: f.contributor });

on("POST", "/api/follows", "json", async (ctx: Ctx) => {
  requireRole(ctx.person, "picture_editor");
  const { values, errors } = strictBody(ctx.body, {
    essay_id: { kind: "string", message: WRONG_TYPE, optional: true },
    contributor: { kind: "string", message: WRONG_TYPE, optional: true },
  });
  errors.fail();
  const given = ctx.body as Record<string, unknown>;
  if (("essay_id" in given) === ("contributor" in given)) throw validationFailed({ target: TARGET_MESSAGE });
  const essayId = typeof values.essay_id === "string" ? values.essay_id : null;
  const handle = typeof values.contributor === "string" ? values.contributor : null;
  if (essayId) await visibleEssay(ctx.person, essayId);
  if (handle && !(await one("SELECT 1 FROM people WHERE handle = $1 AND role = 'contributor'", [handle]))) {
    throw validationFailed({ contributor: `Unknown contributor ${handle}` });
  }
  const created = await query<FollowRow>(
    `INSERT INTO follows (id, person_id, essay_id, contributor, created_at) VALUES ($1, $2, $3, $4, clock_timestamp())
     ON CONFLICT DO NOTHING RETURNING id, essay_id, contributor`, [newId("fol-"), ctx.person.id, essayId, handle]);
  if (created[0]) {
    sendJson(ctx.res, 201, followBody(created[0]));
    return;
  }
  const existing = await one<FollowRow>(
    `SELECT id, essay_id, contributor FROM follows WHERE person_id = $1
     AND essay_id IS NOT DISTINCT FROM $2 AND contributor IS NOT DISTINCT FROM $3`, [ctx.person.id, essayId, handle]);
  if (!existing) throw new ApiError(409, "follow_conflict", "That follow changed while saving; try again.");
  sendJson(ctx.res, 200, followBody(existing));
});

on("GET", "/api/follows", "none", async (ctx: Ctx) => {
  requireRole(ctx.person, "picture_editor");
  const follows = await query<FollowRow & { essay_title: string | null; contributor_name: string | null }>(
    `SELECT f.id, f.essay_id, f.contributor, e.title AS essay_title, p.name AS contributor_name
     FROM follows f LEFT JOIN essays e ON e.id = f.essay_id LEFT JOIN people p ON p.handle = f.contributor
     WHERE f.person_id = $1 AND (e.id IS NULL OR e.state IN ('embargoed', 'live', 'withdrawn'))
     ORDER BY f.created_at DESC, f.id`, [ctx.person.id]);
  sendJson(ctx.res, 200, { follows });
});

on("DELETE", "/api/follows/:id", "none", async (ctx: Ctx) => {
  requireRole(ctx.person, "picture_editor");
  const gone = await query("DELETE FROM follows WHERE id = $1 AND person_id = $2 RETURNING id", [ctx.params[0], ctx.person.id]);
  if (!gone.length) throw notFound();
  sendNoContent(ctx.res);
});

interface ShortlistRow {
  id: string;
  essay_id: string;
  essay_title: string;
  frame_id: string;
  position: number;
  added_by: string;
  added_at: Date;
}

const SHORTLIST_SQL = `SELECT s.id, f.essay_id, e.title AS essay_title, s.frame_id, f.position, p.name AS added_by, s.added_at
  FROM shortlist_items s JOIN frames f ON f.id = s.frame_id JOIN essays e ON e.id = f.essay_id
  JOIN people p ON p.id = s.added_by`;

const itemBody = (row: ShortlistRow): Record<string, unknown> => ({
  ...row, added_at: isoInstant(row.added_at), added_display: coopTime(row.added_at),
});

/** The newsroom's shortlist items; taken-down and withdrawn essays never count. */
export async function shortlistOf(newsroom: string): Promise<ShortlistRow[]> {
  return query<ShortlistRow>(`${SHORTLIST_SQL} WHERE s.newsroom = $1 AND e.state = ANY($2)
    ORDER BY s.added_at DESC, s.id`, [newsroom, ON_SHEET]);
}

on("GET", "/api/shortlist", "none", async (ctx: Ctx) => {
  requireRole(ctx.person, "picture_editor", "licensing_manager");
  const items = await shortlistOf(newsroomOf(ctx.person).slug);
  sendJson(ctx.res, 200, { items: items.map(itemBody), count: items.length });
});

on("POST", "/api/shortlist", "json", async (ctx: Ctx) => {
  requireRole(ctx.person, "picture_editor");
  const { values, errors } = strictBody(ctx.body, { frame_id: { kind: "string", message: WRONG_TYPE } });
  errors.fail();
  const frame = await one<{ id: string; essay_id: string }>("SELECT id, essay_id FROM frames WHERE id = $1", [values.frame_id]);
  if (!frame) throw notFound();
  const essay = await visibleEssay(ctx.person, frame.essay_id);
  if (!isOnSheet(essay.state)) throw new ApiError(409, "not_licensable", "Only embargoed and live essays can be shortlisted.");
  const room = newsroomOf(ctx.person).slug;
  const created = await query<{ id: string }>(
    `INSERT INTO shortlist_items (id, newsroom, frame_id, added_by, added_at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (newsroom, frame_id) DO NOTHING RETURNING id`,
    [newId("sl-"), room, frame.id, ctx.person.id, await serverNow()]);
  const row = await one<ShortlistRow>(`${SHORTLIST_SQL} WHERE s.newsroom = $1 AND s.frame_id = $2`, [room, frame.id]);
  sendJson(ctx.res, created.length ? 201 : 200, itemBody(row as ShortlistRow));
});

on("DELETE", "/api/shortlist/:id", "none", async (ctx: Ctx) => {
  requireRole(ctx.person, "picture_editor");
  const gone = await query("DELETE FROM shortlist_items WHERE id = $1 AND newsroom = $2 RETURNING id",
    [ctx.params[0], newsroomOf(ctx.person).slug]);
  if (!gone.length) throw notFound();
  sendNoContent(ctx.res);
});
