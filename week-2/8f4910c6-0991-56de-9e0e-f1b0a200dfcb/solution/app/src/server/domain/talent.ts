// The roster's talent records: staff reads and edits, portfolio photos, withdraw, restore and erase.

import type { PoolClient } from "pg";
import { exec, lockKey, one, pool, rows, tx, type Db } from "../db.js";
import { memberRoute, json, type MemberCtx } from "../http.js";
import { ApiError, EMAIL_COPY, FieldErrors, conflict, notFound, required, staleVersion } from "../errors.js";
import { asObject, isWholeNumber, newId, str } from "../util.js";
import { deleteObject, deletePrefix, putObject } from "../storage.js";
import { NOT_A_PHOTO, processPhoto } from "../images.js";
import { inchesToCm, parseGirth, parseHeight } from "../../shared/measure.js";
import { isEmail, slugBase } from "../../shared/text.js";
import { isOfficeId, type OfficeId } from "../../shared/zones.js";
import { BOARDS, type Board } from "./fees.js";
import { freeSlug } from "./clients.js";
import { STAFF } from "../auth.js";

const ERASED = "Erased talent";
const PORTFOLIO_LIMIT = 12_000_000;

export interface TalentRow {
  id: string;
  slug: string;
  display_name: string;
  state: "active" | "withdrawn" | "erased";
  office_id: OfficeId;
  board: Board;
  date_of_birth: string | null;
  email: string | null;
  phone: string | null;
  home_address: string | null;
  guardian_name: string | null;
  guardian_email: string | null;
  guardian_phone: string | null;
  height_cm: number | null;
  chest_cm: number | null;
  waist_cm: number | null;
  hips_cm: number | null;
  instagram: number | null;
  tiktok: number | null;
  youtube: number | null;
  office_note: string | null;
  version: number;
  saved_by: string | null;
  saved_at: Date | null;
  portfolio_version: number;
  portfolio_saved_by: string | null;
  portfolio_saved_at: Date | null;
  created_at: Date;
}

export interface PhotoRow {
  id: string;
  talent_id: string;
  position: number;
  width: number;
  height: number;
}

export function isBoard(value: unknown): value is Board {
  return typeof value === "string" && (BOARDS as string[]).includes(value);
}

async function talentById(db: Db, id: string): Promise<TalentRow | null> {
  return one<TalentRow>(db, "SELECT * FROM talent WHERE id = $1", [id]);
}

/** Re-reads a talent this request already holds. */
export async function getTalent(db: Db, id: string): Promise<TalentRow> {
  const row = await talentById(db, id);
  if (!row) throw new Error(`talent ${id} vanished`);
  return row;
}

export async function portfolioOf(db: Db, talentId: string): Promise<PhotoRow[]> {
  return rows<PhotoRow>(db, "SELECT * FROM photos WHERE talent_id = $1 ORDER BY position, id", [talentId]);
}

export function photoBody(photo: PhotoRow) {
  return { photoId: photo.id, url: `/api/photos/${photo.id}`, width: photo.width, height: photo.height };
}

export function measurementsBody(row: TalentRow) {
  return { heightCm: row.height_cm, chestCm: row.chest_cm, waistCm: row.waist_cm, hipsCm: row.hips_cm };
}

export function reachBody(row: TalentRow) {
  const total = row.instagram === null && row.tiktok === null && row.youtube === null
    ? null
    : (row.instagram ?? 0) + (row.tiktok ?? 0) + (row.youtube ?? 0);
  return { instagram: row.instagram, tiktok: row.tiktok, youtube: row.youtube, total };
}

/** The staff `<talent>`; a talent reading their own record gets it without the office note. */
export async function talentBody(db: Db, row: TalentRow, withNote = true): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    state: row.state,
    office: row.office_id,
    board: row.board,
    dateOfBirth: row.date_of_birth,
    email: row.email,
    phone: row.phone,
    homeAddress: row.home_address,
    guardian: row.guardian_name || row.guardian_email
      ? { name: row.guardian_name, email: row.guardian_email, phone: row.guardian_phone }
      : null,
    measurements: measurementsBody(row),
    reach: reachBody(row),
    officeNote: row.office_note,
    portfolio: (await portfolioOf(db, row.id)).map(photoBody),
    version: row.version,
    portfolioVersion: row.portfolio_version,
  };
  if (!withNote) delete body.officeNote;
  return body;
}

async function uniqueSlug(db: Db, displayName: string): Promise<string> {
  return freeSlug(db, "talent", slugBase(displayName) || "talent");
}

export interface NewTalent {
  displayName: string;
  office: OfficeId;
  board: Board;
  email?: string | null;
  dateOfBirth?: string | null;
  guardianName?: string | null;
  guardianEmail?: string | null;
  heightCm?: number | null;
  chestCm?: number | null;
  waistCm?: number | null;
  hipsCm?: number | null;
  instagram?: number | null;
  tiktok?: number | null;
  youtube?: number | null;
}

/** Inserts an active talent with no photos and returns its id. */
export async function createTalent(client: PoolClient, fields: NewTalent, actorName: string): Promise<string> {
  await lockKey(client, "talent-slugs");
  const id = newId();
  const slug = await uniqueSlug(client, fields.displayName);
  await exec(
    client,
    `INSERT INTO talent (id, slug, display_name, state, office_id, board, email, date_of_birth, guardian_name,
       guardian_email, height_cm, chest_cm, waist_cm, hips_cm, instagram, tiktok, youtube, saved_by, saved_at)
     VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now())`,
    [id, slug, fields.displayName, fields.office, fields.board, fields.email ?? null, fields.dateOfBirth ?? null,
      fields.guardianName ?? null, fields.guardianEmail ?? null, fields.heightCm ?? null, fields.chestCm ?? null,
      fields.waistCm ?? null, fields.hipsCm ?? null, fields.instagram ?? null, fields.tiktok ?? null,
      fields.youtube ?? null, actorName],
  );
  return id;
}

type Girth = "chest" | "waist" | "hips";
const LABELS: Record<"height" | Girth, string> = { height: "Height", chest: "Chest", waist: "Waist", hips: "Hips" };

/** Reads the PATCH measurement form into whole centimetres, adding field errors for unreadable values. */
function readMeasurements(input: unknown, errors: FieldErrors): Partial<Record<"height" | Girth, number | null>> {
  const out: Partial<Record<"height" | Girth, number | null>> = {};
  const measurements = asObject(input);
  for (const key of ["height", "chest", "waist", "hips"] as const) {
    if (!(key in measurements)) continue;
    const entry = asObject(measurements[key]);
    const value = entry.value;
    const unit = entry.unit ?? "cm";
    if (value === null || value === "") {
      out[key] = null;
      continue;
    }
    let cm: number | null = null;
    if (unit === "cm") cm = typeof value === "number" ? Math.round(value) : parseGirth(String(value));
    else if (key === "height" && unit === "ft_in") cm = typeof value === "number" ? inchesToCm(value) : parseHeight(String(value));
    else if (key !== "height" && unit === "in") cm = typeof value === "number" ? inchesToCm(value) : parseGirth(`${String(value)} in`);
    if (cm === null || cm <= 0 || cm > 300) {
      errors.add(key, key === "height" ? "Enter height like 175 or 5 ft 9 in." : `Enter ${LABELS[key].toLowerCase()} like 86 or 34 in.`);
    } else out[key] = cm;
  }
  return out;
}

const REACH_KEYS = ["instagram", "tiktok", "youtube"] as const;
const REACH_LABELS = { instagram: "Instagram followers", tiktok: "TikTok followers", youtube: "YouTube subscribers" };

function readReach(input: unknown, errors: FieldErrors): Partial<Record<(typeof REACH_KEYS)[number], number | null>> {
  const out: Partial<Record<(typeof REACH_KEYS)[number], number | null>> = {};
  const reach = asObject(input);
  for (const key of REACH_KEYS) {
    if (!(key in reach)) continue;
    const value = reach[key];
    if (value === null) out[key] = null;
    else if (isWholeNumber(value) && value >= 0) out[key] = value;
    else errors.add(key, `Enter ${REACH_LABELS[key].toLowerCase()} as a whole number.`);
  }
  return out;
}

/** Step 4 for talent paths: staff read every talent, a talent member only their own. */
export async function visibleTalent(ctx: MemberCtx): Promise<TalentRow> {
  const row = await talentById(pool, ctx.params.id);
  if (!row || (ctx.isTalent() && ctx.member.talentId !== row.id)) throw notFound();
  return row;
}

memberRoute("GET", "/api/talent", async (ctx) => {
  ctx.allow(...STAFF);
  const office = ctx.query.get("office");
  const state = ctx.query.get("state");
  const found = await rows<TalentRow>(
    pool,
    `SELECT * FROM talent WHERE ($1::text IS NULL OR $1 = '' OR office_id = $1) AND ($2::text IS NULL OR $2 = '' OR state = $2)
      ORDER BY display_name COLLATE "und-x-icu", id`,
    [office, state],
  );
  return json(200, { talent: await Promise.all(found.map((row) => talentBody(pool, row))) });
});

memberRoute("POST", "/api/talent", async (ctx) => {
  ctx.allow("agency_director");
  const body = asObject(await ctx.json());
  const displayName = str(body, "displayName").trim();
  const office = str(body, "office");
  const board = str(body, "board");
  const email = str(body, "email").trim();
  const errors: FieldErrors = new FieldErrors();
  if (!displayName) errors.add("displayName", required("Display name"));
  if (!isOfficeId(office)) errors.add("office", office ? "Choose Toronto or Vancouver." : required("Office"));
  if (!isBoard(board)) errors.add("board", board ? "Choose Women, Men, Creators or New Faces." : required("Board"));
  if (email && !isEmail(email)) errors.add("email", EMAIL_COPY);
  else if (email && await one(pool, "SELECT 1 FROM talent WHERE lower(email) = lower($1) AND state <> 'erased'", [email])) {
    errors.add("email", "Another talent already uses that email.");
  }
  const measurements = readMeasurements(body.measurements, errors);
  const reach = readReach(body.reach, errors);
  if (errors.any() || !isOfficeId(office) || !isBoard(board)) errors.fail();
  return tx(async (client) => {
    const id = await createTalent(client, {
      displayName, office, board, email: email || null, heightCm: measurements.height, chestCm: measurements.chest,
      waistCm: measurements.waist, hipsCm: measurements.hips, ...reach,
    }, ctx.member.name);
    return json(201, await talentBody(client, await getTalent(client, id)));
  });
});

memberRoute("GET", "/api/talent/:id", async (ctx) => {
  const row = await visibleTalent(ctx);
  return json(200, await talentBody(pool, row, !ctx.isTalent()));
});

function erasedConflict(row: TalentRow): void {
  if (row.state === "erased") throw conflict("erased");
}

memberRoute("PATCH", "/api/talent/:id", async (ctx) => {
  const found = await visibleTalent(ctx);
  ctx.allow("booker", "agency_director");
  const body = asObject(await ctx.json());
  return tx(async (client) => {
    await lockKey(client, `talent:${found.id}`);
    const row = await getTalent(client, found.id);
    erasedConflict(row);
    if (body.version !== row.version) throw staleVersion(row.saved_by ?? "Vesper & Rowe Talent", row.saved_at ?? row.created_at);
    const errors: FieldErrors = new FieldErrors();
    const updates: Record<string, unknown> = {};
    if ("displayName" in body) {
      const name = str(body, "displayName").trim();
      if (!name) errors.add("displayName", required("Display name"));
      else updates.display_name = name;
    }
    if ("officeNote" in body) {
      if (body.officeNote !== null && typeof body.officeNote !== "string") errors.add("officeNote", "Enter the office note as text.");
      else updates.office_note = body.officeNote;
    }
    for (const [key, column] of [["email", "email"], ["phone", "phone"], ["homeAddress", "home_address"]] as const) {
      if (key in body) updates[column] = str(body, key).trim() || null;
    }
    if (typeof updates.email === "string" && !isEmail(updates.email)) errors.add("email", EMAIL_COPY);
    const measurements = readMeasurements(body.measurements, errors);
    for (const [key, value] of Object.entries(measurements)) updates[`${key}_cm`] = value;
    for (const [key, value] of Object.entries(readReach(body.reach, errors))) updates[key] = value;
    errors.throwIfAny();
    const columns = Object.keys(updates);
    await exec(
      client,
      `UPDATE talent SET ${columns.map((column, i) => `${column} = $${i + 4}`).join(", ")}${columns.length ? "," : ""}
         version = version + 1, saved_by = $2, saved_at = $3 WHERE id = $1`,
      [row.id, ctx.member.name, new Date(ctx.now), ...columns.map((column) => updates[column])],
    );
    const saved = await getTalent(client, row.id);
    return json(200, await talentBody(client, saved));
  });
});

async function bumpPortfolio(client: PoolClient, talentId: string, actor: string, now: number): Promise<number> {
  const row = await one<{ portfolio_version: number }>(
    client,
    `UPDATE talent SET portfolio_version = portfolio_version + 1, portfolio_saved_by = $2, portfolio_saved_at = $3
      WHERE id = $1 RETURNING portfolio_version`,
    [talentId, actor, new Date(now)],
  );
  return row?.portfolio_version ?? 0;
}

memberRoute("POST", "/api/talent/:id/photos", async (ctx) => {
  const found = await visibleTalent(ctx);
  ctx.allow("booker", "agency_director");
  const file = await ctx.upload(PORTFOLIO_LIMIT);
  erasedConflict(found);
  if (!file || !file.data.length) throw new ApiError(422, "validation", { errors: { file: "Choose a photo to upload." } });
  const photo = await processPhoto(file.data);
  if (!photo) throw new ApiError(422, "validation", { errors: { file: NOT_A_PHOTO } });
  const photoId = newId();
  const key = `portfolio/${found.id}/${photoId}.jpg`;
  await putObject(key, photo.jpeg, "image/jpeg");
  try {
    return await tx(async (client) => {
      await lockKey(client, `portfolio:${found.id}`);
      const position = await one<{ next: number }>(client,
        "SELECT coalesce(max(position), 0) + 1 AS next FROM photos WHERE talent_id = $1", [found.id]);
      await exec(client, "INSERT INTO photos (id, talent_id, position, width, height) VALUES ($1, $2, $3, $4, $5)",
        [photoId, found.id, position?.next ?? 1, photo.width, photo.height]);
      const portfolioVersion = await bumpPortfolio(client, found.id, ctx.member.name, ctx.now);
      return json(201, { photoId, url: `/api/photos/${photoId}`, width: photo.width, height: photo.height, portfolioVersion });
    });
  } catch (error) {
    await deleteObject(key).catch(() => undefined);
    throw error;
  }
});

memberRoute("DELETE", "/api/talent/:id/photos/:photoId", async (ctx) => {
  const found = await visibleTalent(ctx);
  const photo = await one<PhotoRow>(pool, "SELECT * FROM photos WHERE id = $1 AND talent_id = $2", [ctx.params.photoId, found.id]);
  if (!photo) throw notFound();
  ctx.allow("booker", "agency_director");
  return tx(async (client) => {
    await lockKey(client, `portfolio:${found.id}`);
    await exec(client, "DELETE FROM photos WHERE id = $1", [photo.id]);
    await exec(client, `UPDATE photos p SET position = n.position FROM
      (SELECT id, row_number() OVER (ORDER BY position, id) AS position FROM photos WHERE talent_id = $1) n
      WHERE p.id = n.id`, [found.id]);
    await bumpPortfolio(client, found.id, ctx.member.name, ctx.now);
    await deleteObject(`portfolio/${found.id}/${photo.id}.jpg`);
    return json(204);
  });
});

memberRoute("PUT", "/api/talent/:id/photos/order", async (ctx) => {
  const found = await visibleTalent(ctx);
  ctx.allow("booker", "agency_director");
  const body = asObject(await ctx.json());
  return tx(async (client) => {
    await lockKey(client, `portfolio:${found.id}`);
    const row = await getTalent(client, found.id);
    erasedConflict(row);
    if (body.portfolioVersion !== row.portfolio_version) {
      throw staleVersion(row.portfolio_saved_by ?? "Vesper & Rowe Talent", row.portfolio_saved_at ?? row.created_at);
    }
    const current = (await portfolioOf(client, row.id)).map((photo) => photo.id);
    const ids = Array.isArray(body.photoIds) ? body.photoIds : [];
    const exact = ids.length === current.length && new Set(ids).size === ids.length
      && ids.every((id) => typeof id === "string" && current.includes(id));
    if (!exact) {
      throw new ApiError(422, "validation", { errors: { photoIds: "List every photo of the portfolio exactly once." } });
    }
    for (const [index, id] of ids.entries()) {
      await exec(client, "UPDATE photos SET position = $2 WHERE id = $1", [id, index + 1]);
    }
    const portfolioVersion = await bumpPortfolio(client, row.id, ctx.member.name, ctx.now);
    return json(200, { portfolioVersion, photoIds: ids });
  });
});

async function changeState(ctx: MemberCtx, change: (client: PoolClient, row: TalentRow) => Promise<void>) {
  const found = await visibleTalent(ctx);
  ctx.allow("agency_director");
  await ctx.json();
  return tx(async (client) => {
    await lockKey(client, `talent:${found.id}`);
    const row = await getTalent(client, found.id);
    erasedConflict(row);
    await change(client, row);
    const saved = await getTalent(client, row.id);
    return json(200, await talentBody(client, saved));
  });
}

async function setState(client: PoolClient, row: TalentRow, state: string, ctx: MemberCtx): Promise<void> {
  await exec(client, "UPDATE talent SET state = $2, version = version + 1, saved_by = $3, saved_at = $4 WHERE id = $1",
    [row.id, state, ctx.member.name, new Date(ctx.now)]);
}

memberRoute("POST", "/api/talent/:id/withdraw", (ctx) => changeState(ctx, async (client, row) => {
  if (row.state === "withdrawn") throw conflict("already_withdrawn");
  await setState(client, row, "withdrawn", ctx);
}));

memberRoute("POST", "/api/talent/:id/restore", (ctx) => changeState(ctx, async (client, row) => {
  if (row.state === "active") throw conflict("not_withdrawn");
  await setState(client, row, "active", ctx);
}));

memberRoute("POST", "/api/talent/:id/erase", (ctx) => changeState(ctx, async (client, row) => {
  await exec(
    client,
    `UPDATE talent SET state = 'erased', display_name = $2, email = NULL, phone = NULL, home_address = NULL,
       date_of_birth = NULL, guardian_name = NULL, guardian_email = NULL, guardian_phone = NULL, height_cm = NULL,
       chest_cm = NULL, waist_cm = NULL, hips_cm = NULL, instagram = NULL, tiktok = NULL, youtube = NULL,
       office_note = NULL, version = version + 1, saved_by = $3, saved_at = $4,
       portfolio_version = portfolio_version + 1, portfolio_saved_by = $3, portfolio_saved_at = $4
     WHERE id = $1`,
    [row.id, ERASED, ctx.member.name, new Date(ctx.now)],
  );
  await exec(client, "UPDATE booking_lines SET label = replace(label, $2, $3) WHERE talent_id = $1",
    [row.id, row.display_name, ERASED]);
  await exec(client, "DELETE FROM photos WHERE talent_id = $1", [row.id]);
  await exec(client, "DELETE FROM members WHERE talent_id = $1", [row.id]);
  await exec(client, "DELETE FROM feed_tokens WHERE talent_id = $1", [row.id]);
  await exec(client, "DELETE FROM package_talent WHERE talent_id = $1", [row.id]);
  await exec(client, "DELETE FROM outbox WHERE sent_at IS NULL AND $1 = ANY(talent_ids)", [row.id]);
  await deletePrefix(`portfolio/${row.id}/`);
}));
