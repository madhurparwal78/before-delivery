/**
 * The desk's domain rules, each decided in exactly one place:
 * reference pattern, claim state machine, aftercare term and ruling, deciding edition,
 * quote figures, dispatch promise, photo type check and idempotency key shape.
 */
import { randomInt } from "node:crypto";
import { addCalendarMonths, addDays, isWeekday, londonLocalInstant, londonStartOfDay } from "./clock";
import { fail } from "./errors";
import { londonDateOf } from "../shared/format";
import { nextState, refusalOf, type ClaimAction } from "../shared/state-machine";
import type { ClaimState } from "../shared/types";

/** Booklet numbers run 1 to 99 and a claim covers 1 to 20 units. */
export const BOOKLET_RANGE = [1, 99] as const;
export const QUANTITY_RANGE = [1, 20] as const;

// ---- references ----------------------------------------------------------------------------

const REFERENCE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const REFERENCE_PATTERN = new RegExp(`^HG-[${REFERENCE_ALPHABET}]{6}$`);

/** The reference in capitals when `text` is well formed (any letter case is accepted), otherwise null. */
export function normaliseReference(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const upper = text.toUpperCase();
  return REFERENCE_PATTERN.test(upper) ? upper : null;
}

export function newReference(): string {
  let tail = "";
  for (let i = 0; i < 6; i++) tail += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return `HG-${tail}`;
}

// ---- state machine -------------------------------------------------------------------------

/** Refuses every move outside the published state machine (409 with the current state); returns the next state. */
export function applyAction(action: ClaimAction, current: ClaimState, paid = false): ClaimState {
  const refusal = refusalOf(action, current, paid);
  if (refusal === "wrong_state") return fail("wrong_state", { state: current });
  if (refusal) return fail(refusal);
  return nextState(action, current);
}

/** The confirmation link's state: used once the claim moved on, otherwise live until its closing instant. */
export function linkState(state: ClaimState, confirmBy: Date, at: Date): "live" | "lapsed" | "used" {
  if (state !== "started") return "used";
  return isBefore(at, confirmBy) ? "live" : "lapsed";
}

// ---- aftercare term, deciding edition and ruling ---------------------------------------------

interface EditionRule {
  code: string;
  starts_on: string;
  standard_months: number;
  club_months: number;
  owner_contribution_percent: number;
}

/** The edition with the latest start on or before the business day of the confirmation instant. */
export function decidingEdition(editions: readonly EditionRule[], confirmedAt: Date): EditionRule {
  const day = londonDateOf(confirmedAt);
  const inForce = editions.filter((edition) => edition.starts_on <= day).sort((a, b) => (a.starts_on < b.starts_on ? 1 : -1));
  const edition = inForce[0];
  if (!edition) throw new Error("no aftercare edition is in force");
  return edition;
}

interface RulingInput {
  purchaseDate: string;
  startedAt: Date;
  confirmedAt: Date;
  clubMember: boolean;
  edition: EditionRule;
  termSecondsOverride: number | null;
}

interface Ruling {
  inside: boolean;
  edition: string;
  coverEndsAt: Date;
  coverEndsOn: string;
  termMonths: number | null;
}

/** The ruling is made once, at identification: inside only while the confirmation instant is before the cover end. */
export function makeRuling(input: RulingInput): Ruling {
  const { edition, confirmedAt } = input;
  if (input.termSecondsOverride !== null) {
    const coverEndsAt = new Date(input.startedAt.getTime() + input.termSecondsOverride * 1000);
    return {
      inside: isBefore(confirmedAt, coverEndsAt),
      edition: edition.code,
      coverEndsAt,
      coverEndsOn: londonDateOf(coverEndsAt),
      termMonths: null,
    };
  }
  const termMonths = input.clubMember ? edition.club_months : edition.standard_months;
  const coverEndsOn = addCalendarMonths(input.purchaseDate, termMonths);
  const coverEndsAt = londonStartOfDay(coverEndsOn);
  return { inside: isBefore(confirmedAt, coverEndsAt), edition: edition.code, coverEndsAt, coverEndsOn, termMonths };
}

/** An instant at or after a closing instant is outside: the one comparison used for every closing time. */
export const isBefore = (instant: Date, closing: Date): boolean => instant.getTime() < closing.getTime();

// ---- quote figures -------------------------------------------------------------------------

/** Part line = unit price × quantity × percent ÷ 100, rounded half-up to the penny. The carriage line is the carrier's charge unchanged and billing sums the total. */
export function partLineMinor(unitPriceMinor: number, quantity: number, percent: number): number {
  return Math.floor((unitPriceMinor * quantity * percent + 50) / 100);
}

// ---- dispatch promise ----------------------------------------------------------------------

interface DispatchPromise {
  kind: "same_day" | "later";
  date: string;
}

interface PromiseInput {
  quotedAt: Date;
  source: "bin" | "supplier";
  cutoffLocal: string;
  holidays: ReadonlySet<string>;
}

const isWorkingDay = (ymd: string, holidays: ReadonlySet<string>): boolean => isWeekday(ymd) && !holidays.has(ymd);

function workingDaysAfter(ymd: string, count: number, holidays: ReadonlySet<string>): string {
  let day = ymd;
  for (let counted = 0; counted < count; ) {
    day = addDays(day, 1);
    if (isWorkingDay(day, holidays)) counted += 1;
  }
  return day;
}

/** Same working day when every unit is from the bin, today is a working day and the cut-off has not passed. */
export function dispatchPromise(input: PromiseInput): DispatchPromise {
  const day = londonDateOf(input.quotedAt);
  const [hour = 0, minute = 0] = input.cutoffLocal.split(":").map(Number);
  const cutoff = londonLocalInstant(day, hour, minute);
  if (input.source === "bin" && isWorkingDay(day, input.holidays) && isBefore(input.quotedAt, cutoff)) {
    return { kind: "same_day", date: day };
  }
  return { kind: "later", date: workingDaysAfter(day, input.source === "bin" ? 1 : 3, input.holidays) };
}

// ---- photos --------------------------------------------------------------------------------

const PHOTO_CAP_BYTES = 8_000_000;

const SIGNATURES: readonly { type: string; matches: (bytes: Buffer) => boolean }[] = [
  { type: "image/jpeg", matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: "image/png",
    matches: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    type: "image/webp",
    matches: (b) => b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  },
];

type PhotoVerdict = { ok: true; contentType: string } | { ok: false; code: "not_a_photo" | "too_large" };

/** A photo is judged only by its leading bytes and its size; a file that is both wrong and large is `not_a_photo`. */
export function judgePhoto(bytes: Buffer): PhotoVerdict {
  const found = SIGNATURES.find((signature) => signature.matches(bytes));
  if (!found) return { ok: false, code: "not_a_photo" };
  if (bytes.length > PHOTO_CAP_BYTES) return { ok: false, code: "too_large" };
  return { ok: true, contentType: found.type };
}

const UK_POSTCODE = /^([A-Z]{1,2})(\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i;

/** The postcode area: the letters before the first digit, in capitals; null when not a UK postcode. */
export function postcodeArea(postcode: string): string | null {
  const match = UK_POSTCODE.exec(postcode.trim());
  return match?.[1] ? match[1].toUpperCase() : null;
}

// ---- idempotency key -----------------------------------------------------------------------

/** 1 to 64 visible ASCII characters; returns the field code that refuses it, or null. */
export function idempotencyKeyProblem(key: string | undefined): "required" | "invalid" | null {
  if (key === undefined || key === "") return "required";
  if (key.length > 64 || !/^[!-~]+$/.test(key)) return "invalid";
  return null;
}

