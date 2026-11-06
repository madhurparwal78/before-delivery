import type { Sql } from "../db.js";
import { errors, ApiError } from "../errors.js";
import { resolveLiftLocal, formatCoopTime, isoInstant } from "../../shared/time.js";

// Essay fields, lifecycle and views. Edits to essay fields and frames are
// allowed only in draft; taken_down is final.
export type EssayState = "draft" | "in_review" | "embargoed" | "live" | "withdrawn" | "taken_down";

export interface PersonRow {
  id: number;
  email: string;
  name: string;
  role: string;
  newsroom_id: number | null;
  contributor_handle: string | null;
}

export interface EssayRow {
  id: string;
  version: number;
  title: string;
  caption: string;
  state: EssayState;
  lift_local: string;
  lift_at: Date;
  lift_resolution: string;
  exclusive_days: number;
  standard_days: number;
  exclusive_price_minor: number;
  standard_price_minor: number;
  desk_notes: unknown;
  withdrawal_requested: boolean;
}

export interface CreditRow {
  handle: string;
  name: string;
  position: number;
  split_bp: number;
  person_id: number;
}

export interface FrameRow {
  id: string;
  position: number;
  caption: string;
  filename: string;
  bytes: number;
  type: string;
  width: number;
  height: number;
}

export function creditLine(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `Photographs by ${names[0]}`;
  return `Photographs by ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export async function loadEssay(sql: Sql, id: string): Promise<EssayRow | null> {
  const rows = await sql`SELECT * FROM essays WHERE id = ${id}`;
  return (rows[0] as EssayRow) ?? null;
}

export async function loadCredits(sql: Sql, essayId: string): Promise<CreditRow[]> {
  return (await sql`
    SELECT c.handle, p.name, c.position, c.split_bp, c.person_id
    FROM credits c JOIN people p ON p.id = c.person_id
    WHERE c.essay_id = ${essayId}
    ORDER BY c.position`) as CreditRow[];
}

export async function loadFrames(sql: Sql, essayId: string): Promise<FrameRow[]> {
  return (await sql`
    SELECT id, position, caption, filename, bytes, type, width, height
    FROM frames WHERE essay_id = ${essayId} ORDER BY position`) as FrameRow[];
}

// Every change to the essay increases its version by exactly 1.
export async function bumpVersion(sql: Sql, essayId: string): Promise<number> {
  const rows = await sql`UPDATE essays SET version = version + 1 WHERE id = ${essayId} RETURNING version`;
  return Number(rows[0].version);
}

export const ESSAY_FIELD_MESSAGES = {
  title: "Title must be 1 to 120 characters",
  titleControl: "Title can't contain line breaks or control characters",
  caption: "Caption must be at most 2000 characters",
  lift_local: "Enter the lift as a co-op date and time",
  exclusive_days: "Exclusive window must be 1 to 14 days",
  standard_days: "Standard licence must be 1 to 30 days",
  price: "Price must be $1.00 to $100,000.00",
  creditsShape: "Credits must list 1 to 6 contributors",
  creditsEntry: "Each credit needs a contributor handle and an integer split_bp from 1 to 10000",
  creditsKeys: "Credits accept only contributor and split_bp",
  creditsUnknown: "Unknown contributor",
  creditsUnique: "Each contributor may be credited once",
  creditsSelf: "You must credit yourself",
  creditsTotal: "Shares must total 10000 basis points",
  frameCaption: "Caption must be at most 500 characters",
};

const CONTROL_CHARS = /[\u0000-\u001f\u007f\u0080-\u009f\u2028\u2029]/;

export interface ValidatedEssayFields {
  title?: string;
  caption?: string;
  lift_local?: string;
  exclusive_days?: number;
  standard_days?: number;
  exclusive_price_minor?: number;
  standard_price_minor?: number;
  credits?: { contributor: string; split_bp: number }[];
}

// Validate the essay fields, and turn whatever fails into 422 field errors.
export async function validateEssayFields(
  sql: Sql,
  person: PersonRow,
  body: Record<string, unknown>,
  requireAll: boolean,
): Promise<{ ok: true; fields: ValidatedEssayFields } | { ok: false; error: ApiError }> {
  const fields: ValidatedEssayFields = {};
  const problems: Record<string, string> = {};

  const add = (key: string, msg: string): void => {
    if (!(key in problems)) problems[key] = msg;
  };
  const has = (key: string): boolean => key in body;

  if (requireAll && !has("title")) add("title", ESSAY_FIELD_MESSAGES.title);
  if (has("title")) {
    const value: unknown = body.title;
    if (typeof value !== "string") add("title", ESSAY_FIELD_MESSAGES.title);
    else if (CONTROL_CHARS.test(value)) add("title", ESSAY_FIELD_MESSAGES.titleControl);
    else {
      const trimmed = value.trim();
      if ([...trimmed].length < 1 || [...trimmed].length > 120) add("title", ESSAY_FIELD_MESSAGES.title);
      else fields.title = trimmed;
    }
  }

  if (requireAll && !has("caption")) add("caption", ESSAY_FIELD_MESSAGES.caption);
  if (has("caption")) {
    const value: unknown = body.caption;
    if (typeof value !== "string") add("caption", ESSAY_FIELD_MESSAGES.caption);
    else if ([...value].length > 2000) add("caption", ESSAY_FIELD_MESSAGES.caption);
    else fields.caption = value;
  }

  if (requireAll && !has("lift_local")) add("lift_local", ESSAY_FIELD_MESSAGES.lift_local);
  if (has("lift_local")) {
    const value: unknown = body.lift_local;
    if (typeof value !== "string") add("lift_local", ESSAY_FIELD_MESSAGES.lift_local);
    else if (!resolveLiftLocal(value)) add("lift_local", ESSAY_FIELD_MESSAGES.lift_local);
    else fields.lift_local = value;
  }

  if (requireAll && !has("exclusive_days")) add("exclusive_days", ESSAY_FIELD_MESSAGES.exclusive_days);
  if (has("exclusive_days")) {
    const value: unknown = body.exclusive_days;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 14) add("exclusive_days", ESSAY_FIELD_MESSAGES.exclusive_days);
    else fields.exclusive_days = value;
  }

  if (requireAll && !has("standard_days")) add("standard_days", ESSAY_FIELD_MESSAGES.standard_days);
  if (has("standard_days")) {
    const value: unknown = body.standard_days;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 30) add("standard_days", ESSAY_FIELD_MESSAGES.standard_days);
    else fields.standard_days = value;
  }

  for (const key of ["exclusive_price_minor", "standard_price_minor"] as const) {
    if (requireAll && !has(key)) add(key, ESSAY_FIELD_MESSAGES.price);
    if (has(key)) {
      const value: unknown = body[key];
      if (typeof value !== "number" || !Number.isInteger(value) || value < 100 || value > 10000000) add(key, ESSAY_FIELD_MESSAGES.price);
      else fields[key] = value;
    }
  }

  if (requireAll && !has("credits")) add("credits", ESSAY_FIELD_MESSAGES.creditsShape);
  if (has("credits")) {
    const creditsError = await validateCredits(sql, person, body.credits);
    if (creditsError) add("credits", creditsError);
    else fields.credits = body.credits as { contributor: string; split_bp: number }[];
  }

  if (Object.keys(problems).length > 0) return { ok: false, error: errors.validationFailed(problems) };
  return { ok: true, fields };
}

async function validateCredits(sql: Sql, person: PersonRow, raw: unknown): Promise<string | null> {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 6) return ESSAY_FIELD_MESSAGES.creditsShape;
  const seen = new Set<string>();
  let total = 0;
  let selfCredited = false;
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return ESSAY_FIELD_MESSAGES.creditsEntry;
    const obj = entry as Record<string, unknown>;
    if (typeof obj.contributor !== "string" || typeof obj.split_bp !== "number" || !Number.isInteger(obj.split_bp) || obj.split_bp < 1 || obj.split_bp > 10000) {
      return ESSAY_FIELD_MESSAGES.creditsEntry;
    }
    const keys = Object.keys(obj);
    if (keys.some((k) => k !== "contributor" && k !== "split_bp")) return ESSAY_FIELD_MESSAGES.creditsKeys;
    if (seen.has(obj.contributor)) return ESSAY_FIELD_MESSAGES.creditsUnique;
    seen.add(obj.contributor);
    total += obj.split_bp;
    if (obj.contributor === person.contributor_handle) selfCredited = true;
  }
  const unknownHandles = [...seen];
  if (unknownHandles.length > 0) {
    const known = await sql`SELECT contributor_handle FROM people WHERE contributor_handle IN ${sql(unknownHandles)}`;
    for (const entry of raw as { contributor: string }[]) {
      if (!known.some((k) => k.contributor_handle === entry.contributor)) return `${ESSAY_FIELD_MESSAGES.creditsUnknown} ${entry.contributor}`;
    }
  }
  if (!selfCredited) return ESSAY_FIELD_MESSAGES.creditsSelf;
  if (total !== 10000) return `${ESSAY_FIELD_MESSAGES.creditsTotal} (now ${total})`;
  return null;
}

export interface EssayViewContext {
  role: string;
  personId: number;
  newsroomId: number | null;
}

export interface WindowState {
  state: "open" | "claimed";
  held_by: "you" | "your_newsroom" | "another_newsroom" | null;
  held_until: string | null;
  held_until_display: string | null;
  standard_running_until: string | null;
  standard_running_until_display: string | null;
}

export function emptyWindow(): WindowState {
  return { state: "open", held_by: null, held_until: null, held_until_display: null, standard_running_until: null, standard_running_until_display: null };
}

export function frameUrls(frameId: string, includeStory: boolean): Record<string, string> {
  const urls: Record<string, string> = {
    grid_url: `/media/frames/${frameId}/grid`,
    preview_url: `/media/frames/${frameId}/preview`,
  };
  if (includeStory) urls.story_url = `/media/frames/${frameId}/story`;
  return urls;
}

export function essayStamp(state: EssayState, liftAtMs: number): string {
  if (state === "embargoed") return `EMBARGOED · lifts ${formatCoopTime(liftAtMs)}`;
  return `LIVE · since ${formatCoopTime(liftAtMs)}`;
}

export function displayInstant(date: Date | number): string {
  const ms = typeof date === "number" ? date : date.getTime();
  return formatCoopTime(ms);
}

export function isoDate(date: Date | number): string {
  const ms = typeof date === "number" ? date : date.getTime();
  return isoInstant(ms);
}
