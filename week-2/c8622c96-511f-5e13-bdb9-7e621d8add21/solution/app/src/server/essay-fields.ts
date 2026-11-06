// Essay field rules for create and edit, with their published 422 messages.
import { resolveWall, type ResolvedWall } from "../shared/coop-time.js";
import type { Person } from "./auth.js";
import { query } from "./db.js";
import { strictBody, type BodyRules } from "./strict-body.js";

export const TITLE_LENGTH = "Title must be 1 to 120 characters";
const TITLE_CONTROL = "Title can't contain line breaks or control characters";
const CAPTION = "Caption must be at most 2000 characters";
const LIFT = "Enter the lift as a co-op date and time";
const EXCLUSIVE = "Exclusive window must be 1 to 14 days";
const STANDARD = "Standard licence must be 1 to 30 days";
const PRICE = "Price must be $1.00 to $100,000.00";
const CREDITS_COUNT = "Credits must list 1 to 6 contributors";
const CREDIT_ENTRY = "Each credit needs a contributor handle and an integer split_bp from 1 to 10000";
const CREDIT_KEYS = "Credits accept only contributor and split_bp";
const CREDIT_TWICE = "Each contributor may be credited once";
const CREDIT_SELF = "You must credit yourself";
export const FRAME_CAPTION = "Caption must be at most 500 characters";

const RULES: BodyRules = {
  title: { kind: "string", message: TITLE_LENGTH },
  caption: { kind: "string", message: CAPTION },
  lift_local: { kind: "string", message: LIFT },
  exclusive_days: { kind: "integer", message: EXCLUSIVE },
  standard_days: { kind: "integer", message: STANDARD },
  exclusive_price_minor: { kind: "integer", message: PRICE },
  standard_price_minor: { kind: "integer", message: PRICE },
  credits: { kind: "value", message: CREDITS_COUNT },
};

const CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;
const codePoints = (text: string): number => [...text].length;

export interface Credit {
  handle: string;
  split_bp: number;
}

export interface EssayFields {
  title?: string;
  caption?: string;
  lift_local?: string;
  lift?: ResolvedWall;
  exclusive_days?: number;
  standard_days?: number;
  exclusive_price_minor?: number;
  standard_price_minor?: number;
  credits?: Credit[];
}

/** Checks a title as sent; returns the trimmed title or the field message. */
function checkTitle(raw: string): { title: string } | { error: string } {
  if (CONTROL.test(raw)) return { error: TITLE_CONTROL };
  const title = raw.replace(/^ +| +$/g, "");
  const length = codePoints(title);
  return length >= 1 && length <= 120 ? { title } : { error: TITLE_LENGTH };
}

const inRange = (value: number, low: number, high: number): boolean => value >= low && value <= high;

async function checkCredits(value: unknown, person: Person): Promise<Credit[] | string> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) return CREDITS_COUNT;
  const entries = value as unknown[];
  const wellFormed = entries.every((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    const { contributor, split_bp: split } = entry as Record<string, unknown>;
    return typeof contributor === "string" && typeof split === "number" && Number.isInteger(split)
      && inRange(split, 1, 10000);
  });
  if (!wellFormed) return CREDIT_ENTRY;
  if (entries.some((entry) => Object.keys(entry as object).some((k) => k !== "contributor" && k !== "split_bp"))) {
    return CREDIT_KEYS;
  }
  const credits = entries.map((entry) => {
    const { contributor, split_bp: split } = entry as { contributor: string; split_bp: number };
    return { handle: contributor, split_bp: split };
  });
  const known = new Set((await query<{ handle: string }>(
    "SELECT handle FROM people WHERE role = 'contributor' AND handle = ANY($1)", [credits.map((c) => c.handle)],
  )).map((r) => r.handle));
  const unknown = credits.find((c) => !known.has(c.handle));
  if (unknown) return `Unknown contributor ${unknown.handle}`;
  if (new Set(credits.map((c) => c.handle)).size !== credits.length) return CREDIT_TWICE;
  if (!credits.some((c) => c.handle === person.handle)) return CREDIT_SELF;
  const sum = credits.reduce((total, c) => total + c.split_bp, 0);
  if (sum !== 10000) return `Shares must total 10000 basis points (now ${sum})`;
  return credits;
}

/** Validates an essay body: every field on create, any subset on edit. Throws the 422 with every field error. */
export async function readEssayFields(body: unknown, person: Person, partial: boolean): Promise<EssayFields> {
  const { values, errors } = strictBody(body, RULES, partial);
  const fields: EssayFields = {};
  if (typeof values.title === "string") {
    const checked = checkTitle(values.title);
    if ("error" in checked) errors.add("title", checked.error);
    else fields.title = checked.title;
  }
  if (typeof values.caption === "string") {
    if (codePoints(values.caption) <= 2000) fields.caption = values.caption;
    else errors.add("caption", CAPTION);
  }
  if (typeof values.lift_local === "string") {
    const lift = resolveWall(values.lift_local);
    if (lift) {
      fields.lift_local = values.lift_local;
      fields.lift = lift;
    } else errors.add("lift_local", LIFT);
  }
  const ranged: [keyof EssayFields & string, number, number, string][] = [
    ["exclusive_days", 1, 14, EXCLUSIVE], ["standard_days", 1, 30, STANDARD],
    ["exclusive_price_minor", 100, 10_000_000, PRICE], ["standard_price_minor", 100, 10_000_000, PRICE],
  ];
  for (const [key, low, high, message] of ranged) {
    const value = values[key];
    if (typeof value !== "number") continue;
    if (inRange(value, low, high)) (fields as Record<string, unknown>)[key] = value;
    else errors.add(key, message);
  }
  if ("credits" in values) {
    const credits = await checkCredits(values.credits, person);
    if (typeof credits === "string") errors.add("credits", credits);
    else fields.credits = credits;
  }
  errors.fail();
  return fields;
}
