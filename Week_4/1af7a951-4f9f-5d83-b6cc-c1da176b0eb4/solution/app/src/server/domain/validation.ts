import { isCategory, type EntryFields, type Technique } from "../../shared/api.js";
import { isBedtime, isCalendarDate, isTimeZone, TECHNIQUE_NIGHT } from "./time.js";

export type FieldErrors = Record<string, string>;

export const MESSAGES = {
  name: "Tell us your name in 1 to 80 characters.",
  email: "Use an email address like name@example.com.",
  home_tz: "Choose a time zone from the list.",
  bedtime: "Choose a bedtime between 20:00 and 23:59.",
  entryId: "Use the entry id created on this device.",
  title: "Keep the title to 120 characters or fewer.",
  textEmpty: "Write at least one word.",
  textLong: "Keep the dream text to 20,000 characters or fewer.",
  dreamsRecalled: "Use a whole number from 0 to 20.",
  technique: "Choose none, mild or ssild.",
  techniqueMinutes: "Use a whole number of minutes from 0 to 180.",
  techniqueLocked: "Technique practice unlocks on night 8.",
  flag: "Use true or false.",
  duration: "Send the recording length in milliseconds.",
  emptyMemo: "The recording is empty.",
  memoSignature: "The recording doesn't match its audio type.",
  range: "Select between 1 and 200 characters of this entry.",
  category: "Choose inner awareness, action, form or context.",
  cohortName: "Name the cohort in 1 to 80 characters.",
  startsOn: "Use a date like 2026-11-02.",
  price: "Use a price from $1.00 to $1,000.00.",
  seats: "Use 1 to 50 seats.",
  realityCheckId: "Use the check id created on this device.",
} as const;

const NAME_MAX = 80;
const TITLE_MAX = 120;
const TEXT_MAX = 20_000;
const TECHNIQUES: readonly Technique[] = ["none", "mild", "ssild"];

export type JsonObject = Record<string, unknown>;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function characters(value: string): number {
  return [...value].length;
}

function wholeIn(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isTechnique(value: unknown): value is Technique {
  return TECHNIQUES.some((technique) => technique === value);
}

/** A name exactly as entered: 1 to 80 code points, not only spaces, and no control character or line separator. */
function isName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /[^ ]/.test(value) &&
    characters(value) <= NAME_MAX &&
    !/[\p{Cc}\u2028\u2029]/u.test(value)
  );
}

function emailAddress(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function enrollmentErrors(body: JsonObject): FieldErrors {
  const errors: FieldErrors = {};
  if (!isName(body.name)) errors.name = MESSAGES.name;
  if (!emailAddress(body.email)) errors.email = MESSAGES.email;
  if (!isTimeZone(body.home_tz)) errors.home_tz = MESSAGES.home_tz;
  if (!isBedtime(body.bedtime)) errors.bedtime = MESSAGES.bedtime;
  return errors;
}

export function settingsErrors(body: JsonObject): FieldErrors {
  const errors: FieldErrors = {};
  if (body.home_tz !== undefined && !isTimeZone(body.home_tz)) errors.home_tz = MESSAGES.home_tz;
  if (body.bedtime !== undefined && !isBedtime(body.bedtime)) errors.bedtime = MESSAGES.bedtime;
  return errors;
}

/** The seven entry fields when they are all valid for a night number, otherwise every field error at once. */
export function entryFields(body: JsonObject, night: number): { fields: EntryFields } | { errors: FieldErrors } {
  const errors: FieldErrors = {};
  const { title, text, dreams_recalled, lucid, wbtb, technique, technique_minutes } = body;
  if (typeof title !== "string" || characters(title) > TITLE_MAX) errors.title = MESSAGES.title;
  if (typeof text !== "string" || text.trim() === "") errors.text = MESSAGES.textEmpty;
  else if (characters(text) > TEXT_MAX) errors.text = MESSAGES.textLong;
  if (!wholeIn(dreams_recalled, 0, 20)) errors.dreams_recalled = MESSAGES.dreamsRecalled;
  if (typeof lucid !== "boolean") errors.lucid = MESSAGES.flag;
  if (typeof wbtb !== "boolean") errors.wbtb = MESSAGES.flag;
  if (!isTechnique(technique)) errors.technique = MESSAGES.technique;
  if (!wholeIn(technique_minutes, 0, 180)) errors.technique_minutes = MESSAGES.techniqueMinutes;
  const practised = wbtb === true || (isTechnique(technique) && technique !== "none") || wholeIn(technique_minutes, 1, 180);
  if (night < TECHNIQUE_NIGHT && practised && errors.technique === undefined) errors.technique = MESSAGES.techniqueLocked;
  if (
    typeof title !== "string" ||
    typeof text !== "string" ||
    !wholeIn(dreams_recalled, 0, 20) ||
    typeof lucid !== "boolean" ||
    typeof wbtb !== "boolean" ||
    !isTechnique(technique) ||
    !wholeIn(technique_minutes, 0, 180) ||
    Object.keys(errors).length > 0
  ) {
    return { errors };
  }
  return { fields: { title, text, dreams_recalled, lucid, wbtb, technique, technique_minutes } };
}

/** True when a request body carries exactly the stored seven fields (an idempotent replay). */
export function sameEntryFields(body: JsonObject, stored: EntryFields): boolean {
  return (
    body.title === stored.title &&
    body.text === stored.text &&
    body.dreams_recalled === stored.dreams_recalled &&
    body.lucid === stored.lucid &&
    body.wbtb === stored.wbtb &&
    body.technique === stored.technique &&
    body.technique_minutes === stored.technique_minutes
  );
}

/** Cohort names are unique per coach after Unicode lower-casing. */
export const nameKey = (name: string): string => name.toLowerCase();

interface CohortRequest {
  name: string;
  startsOn: string;
  priceCents: number;
  seats: number;
}

export function cohortRequest(body: JsonObject): { cohort: CohortRequest } | { errors: FieldErrors } {
  const { name, starts_on, price_cents, seats } = body;
  const errors: FieldErrors = {};
  const nameOk = isName(name);
  if (!nameOk) errors.name = MESSAGES.cohortName;
  if (!isCalendarDate(starts_on)) errors.starts_on = MESSAGES.startsOn;
  if (!wholeIn(price_cents, 100, 100_000)) errors.price_cents = MESSAGES.price;
  if (!wholeIn(seats, 1, 50)) errors.seats = MESSAGES.seats;
  if (!nameOk || !isCalendarDate(starts_on) || !wholeIn(price_cents, 100, 100_000) || !wholeIn(seats, 1, 50)) {
    return { errors };
  }
  return { cohort: { name, startsOn: starts_on, priceCents: price_cents, seats } };
}

/** The share flag, or its field error. */
export function sharedErrors(shared: unknown): FieldErrors {
  return typeof shared === "boolean" ? {} : { shared: MESSAGES.flag };
}

export function categoryErrors(category: unknown): FieldErrors {
  return isCategory(category) ? {} : { category: MESSAGES.category };
}
