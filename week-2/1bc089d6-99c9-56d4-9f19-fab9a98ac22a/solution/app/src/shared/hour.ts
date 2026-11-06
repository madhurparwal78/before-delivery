import {
  HOUR_MINUTES,
  MAX_RITUAL_MINUTES,
  MIN_RITUAL_MINUTES,
  MINUTE_STEP,
  isRitualId,
  ritualById,
  type RitualId,
} from "./rituals";

/** The plan rules of a Stillhour hour, shared by the planner forms and the server. */

export const NOTE_MAX = 280;
const EMAIL_MAX = 254;
const MAX_RITUALS = 6;
export const DEFAULT_BEDTIME = "23:00";

export interface RitualChoice {
  id: RitualId;
  minutes: number;
}

const rituals = "Choose between one and six rituals, 5 to 30 minutes each, 60 minutes at most in total.";

/** The field messages of the plan rules, word for word. */
export const copy = {
  email: "Enter an email address, like name@example.com.",
  bedtime: "Choose a bedtime on a five-minute step, like 22:30.",
  timeZone: "Choose a time zone from the list.",
  rituals,
  note: "Keep your note to 280 characters.",
  reminders: "Choose on or paused.",
  token: "Paste the full link from your email.",
  now: "Send an ISO 8601 date and time with a time zone.",
  notAccepted: "This field is not accepted.",
};

const BEDTIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/;

function minutesOfDay(hhmm: string) {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatMinutesOfDay(total: number) {
  const wrapped = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/** The hour starts sixty minutes before bedtime on the wall clock, wrapping past midnight. */
export function startsAt(bedtime: string) {
  return formatMinutesOfDay(minutesOfDay(bedtime) - HOUR_MINUTES);
}

export function totalMinutes(choices: readonly RitualChoice[]) {
  return choices.reduce((sum, ritual) => sum + ritual.minutes, 0);
}

/** Whether the chosen rituals fit in the hour: 60 minutes at most, and exactly 60 is allowed. */
export function fitsHour(choices: readonly RitualChoice[]) {
  return totalMinutes(choices) <= HOUR_MINUTES;
}

/** The address as stored: trimmed and lowercased, or null when it breaks the email rule. */
export function normaliseEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= EMAIL_MAX && EMAIL.test(email) ? email : null;
}

/** `HH:MM` on 24-hour time, 00:00 to 23:55, on a five-minute step. */
export function isBedtime(value: unknown): value is string {
  return typeof value === "string" && BEDTIME.test(value) && minutesOfDay(value) % MINUTE_STEP === 0;
}

/** A name from the IANA time-zone database (offsets such as +02:00 are not names). */
export function isTimeZoneName(value: unknown): value is string {
  if (typeof value !== "string" || !ZONE_NAME.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** A ritual's minutes: 5 to 30 in steps of 5. */
export function isRitualMinutes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_RITUAL_MINUTES &&
    value <= MAX_RITUAL_MINUTES &&
    value % MINUTE_STEP === 0
  );
}

/** A valid ritual list (1 to 6 catalogue ids, no repeats, exactly `id` and `minutes`, at most 60 in total), or null. */
export function parseRituals(value: unknown): RitualChoice[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RITUALS) return null;
  const choices: RitualChoice[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
    const { id, minutes, ...rest } = entry as Record<string, unknown>;
    if (Object.keys(rest).length || typeof id !== "string" || !isRitualId(id) || !isRitualMinutes(minutes)) return null;
    if (choices.some((choice) => choice.id === id)) return null;
    choices.push({ id, minutes });
  }
  return fitsHour(choices) ? choices : null;
}

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/** Characters as a reader sees them: an emoji built from several symbols, or an accented letter, counts as one. */
export function noteLength(note: string) {
  return Array.from(graphemes.segment(note)).length;
}

export function isNote(value: unknown): value is string {
  return typeof value === "string" && noteLength(value) <= NOTE_MAX;
}

export function describeRituals(choices: readonly RitualChoice[]) {
  return choices.map(({ id, minutes }) => ({ id, title: ritualById(id).title, minutes }));
}

