// Contributor endpoints: drafts, versions, submission, withdrawal requests, studio and royalties.
import { randomBytes } from "node:crypto";
import { coopTime, isoInstant } from "../shared/coop-time.js";
import { requireRole, type Person } from "./auth.js";
import { serverNow } from "./clock.js";
import { query, transaction, type Client } from "./db.js";
import {
  creditsOf, essayBodies, essayBody, isCredited, loadEssay, visibleEssay, type EssayRow,
} from "./essay-model.js";
import { readEssayFields, type EssayFields } from "./essay-fields.js";
import { ApiError, forbidden, sendJson, validationFailed } from "./http.js";
import { licenceState, type LicenceRow } from "./licence-state.js";
import { assertTransition } from "./lifecycle.js";
import { on, type Ctx } from "./router.js";
import { emptyBody } from "./strict-body.js";

export function newId(prefix: string): string {
  return `${prefix}${randomBytes(6).toString("hex")}`;
}

function essayId(title: string): string {
  const slug = title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return `${slug || "essay"}-${randomBytes(3).toString("hex")}`;
}

export const etagOf = (version: number): string => `"${version}"`;

/** Loads an essay the caller can see and confirms they are one of its credited contributors. */
export async function creditedEssay(person: Person, id: string, client: Client): Promise<EssayRow> {
  const essay = await visibleEssay(person, id, client, true);
  if (person.role !== "contributor" || !isCredited(person, await creditsOf([essay.id], client))) throw forbidden();
  return essay;
}

/** Bumps the essay version by exactly one and returns the new version. */
export async function bumpVersion(client: Client, id: string, sets = "", params: unknown[] = []): Promise<number> {
  const rows = await query<{ version: number }>(
    `UPDATE essays SET version = version + 1${sets ? `, ${sets}` : ""} WHERE id = $1 RETURNING version`,
    [id, ...params], client);
  return rows[0]?.version ?? 0;
}

async function writeCredits(client: Client, id: string, credits: { handle: string; split_bp: number }[]): Promise<void> {
  await query("DELETE FROM credits WHERE essay_id = $1", [id], client);
  for (const [index, credit] of credits.entries()) {
    await query("INSERT INTO credits (essay_id, position, handle, split_bp) VALUES ($1, $2, $3, $4)",
      [id, index + 1, credit.handle, credit.split_bp], client);
  }
}

on("POST", "/api/essays", "json", async (ctx: Ctx) => {
  requireRole(ctx.person, "contributor");
  const fields = await readEssayFields(ctx.body, ctx.person, false) as Required<EssayFields>;
  const body = await transaction(async (client) => {
    const now = await serverNow(client);
    const id = essayId(fields.title);
    await query(
      `INSERT INTO essays (id, version, title, caption, lift_local, lift_at, lift_resolution, exclusive_days,
         standard_days, exclusive_price_minor, standard_price_minor, state, created_at)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', $11)`,
      [id, fields.title, fields.caption, fields.lift_local, fields.lift.at, fields.lift.resolution,
        fields.exclusive_days, fields.standard_days, fields.exclusive_price_minor, fields.standard_price_minor, now],
      client);
    await writeCredits(client, id, fields.credits);
    const essay = await loadEssay(id, client);
    return essayBody(ctx.person, essay as EssayRow, now, client);
  });
  sendJson(ctx.res, 201, body, { ETag: etagOf(1) });
});

/** `If-Match: "<version>"` as sent, or 428 when it is missing. */
function ifMatch(ctx: Ctx): number | null {
  const header = ctx.req.headers["if-match"];
  if (header === undefined) {
    throw new ApiError(428, "precondition_required", "Send If-Match with the essay version you last read.");
  }
  const m = /^"(\d+)"$/.exec(header.trim());
  return m ? Number(m[1]) : null;
}

on("PATCH", "/api/essays/:id", "json", async (ctx: Ctx) => {
  const body = await transaction(async (client) => {
    const essay = await creditedEssay(ctx.person, ctx.params[0] ?? "", client);
    const expected = ifMatch(ctx);
    if (expected !== essay.version) {
      throw new ApiError(412, "version_conflict", "This essay was changed elsewhere.", { current_version: essay.version });
    }
    assertTransition(essay.state, "edit");
    const fields = await readEssayFields(ctx.body, ctx.person, true);
    const sets: string[] = [];
    const params: unknown[] = [];
    const put = (column: string, value: unknown): void => {
      params.push(value);
      sets.push(`${column} = $${params.length + 1}`);
    };
    if (fields.title !== undefined) put("title", fields.title);
    if (fields.caption !== undefined) put("caption", fields.caption);
    if (fields.lift) {
      put("lift_local", fields.lift_local);
      put("lift_at", fields.lift.at);
      put("lift_resolution", fields.lift.resolution);
    }
    for (const key of ["exclusive_days", "standard_days", "exclusive_price_minor", "standard_price_minor"] as const) {
      if (fields[key] !== undefined) put(key, fields[key]);
    }
    await bumpVersion(client, essay.id, sets.join(", "), params);
    if (fields.credits) await writeCredits(client, essay.id, fields.credits);
    return essayBody(ctx.person, await loadEssay(essay.id, client) as EssayRow, await serverNow(client), client);
  });
  sendJson(ctx.res, 200, body, { ETag: etagOf(body.version as number) });
});

on("GET", "/api/essays/:id", "none", async (ctx: Ctx) => {
  const essay = await visibleEssay(ctx.person, ctx.params[0] ?? "");
  sendJson(ctx.res, 200, await essayBody(ctx.person, essay, await serverNow()), { ETag: etagOf(essay.version) });
});

on("POST", "/api/essays/:id/submit", "json", async (ctx: Ctx) => {
  const body = await transaction(async (client) => {
    const essay = await creditedEssay(ctx.person, ctx.params[0] ?? "", client);
    assertTransition(essay.state, "submit");
    emptyBody(ctx.body);
    const frames = await query("SELECT 1 FROM frames WHERE essay_id = $1 LIMIT 1", [essay.id], client);
    if (!frames.length) throw validationFailed({ frames: "Add at least one frame before submitting" });
    const now = await serverNow(client);
    await bumpVersion(client, essay.id, "state = 'in_review', submitted_at = $2", [now]);
    return essayBody(ctx.person, await loadEssay(essay.id, client) as EssayRow, now, client);
  });
  sendJson(ctx.res, 200, body, { ETag: etagOf(body.version as number) });
});

on("POST", "/api/essays/:id/withdrawal-request", "json", async (ctx: Ctx) => {
  const body = await transaction(async (client) => {
    const essay = await creditedEssay(ctx.person, ctx.params[0] ?? "", client);
    assertTransition(essay.state, "request_withdrawal");
    emptyBody(ctx.body);
    if (!essay.withdrawal_requested) await bumpVersion(client, essay.id, "withdrawal_requested = true");
    return essayBody(ctx.person, await loadEssay(essay.id, client) as EssayRow, await serverNow(client), client);
  });
  sendJson(ctx.res, 200, body, { ETag: etagOf(body.version as number) });
});

on("GET", "/api/studio/essays", "none", async (ctx: Ctx) => {
  requireRole(ctx.person, "contributor");
  const now = await serverNow();
  const essays = await query<EssayRow>(
    `SELECT e.* FROM essays e JOIN credits c ON c.essay_id = e.id WHERE c.handle = $1 ORDER BY e.created_at DESC, e.id`,
    [ctx.person.handle]);
  const bodies = await essayBodies(ctx.person, essays, now);
  const licences = await query<LicenceRow & { newsroom_name: string }>(
    `SELECT l.*, n.name AS newsroom_name FROM licences l JOIN newsrooms n ON n.slug = l.newsroom
     WHERE l.essay_id = ANY($1) AND l.status <> 'removed' ORDER BY l.confirmed_at DESC`, [essays.map((e) => e.id)]);
  for (const body of bodies) {
    body.licences = licences.filter((l) => l.essay_id === body.id).flatMap((l) => {
      const state = licenceState(l, now);
      return state ? [{
        newsroom: { slug: l.newsroom, name: l.newsroom_name }, kind: l.kind, state,
        window_end: isoInstant(l.window_end), window_end_display: coopTime(l.window_end), amount_minor: l.amount_minor,
      }] : [];
    });
  }
  const contributors = await query<{ handle: string; name: string }>(
    "SELECT handle, name FROM people WHERE role = 'contributor' ORDER BY name");
  sendJson(ctx.res, 200, { essays: bodies, contributors });
});

on("GET", "/api/studio/royalties", "none", async (ctx: Ctx) => {
  requireRole(ctx.person, "contributor");
  const lines = await query<{ month: string; licence_id: string; essay_title: string; position: number;
    split_bp: number; amount_minor: number }>(
    `SELECT s.month, line->>'licence_id' AS licence_id, line->>'essay_title' AS essay_title,
       (share->>'position')::int AS position, (share->>'split_bp')::int AS split_bp,
       (share->>'amount_minor')::int AS amount_minor
     FROM statements s, jsonb_array_elements(s.body->'lines') line, jsonb_array_elements(line->'shares') share
     WHERE share->>'handle' = $1
     ORDER BY s.month DESC, line->>'confirmed_at', line->>'licence_id'`, [ctx.person.handle]);
  sendJson(ctx.res, 200, { lines });
});
