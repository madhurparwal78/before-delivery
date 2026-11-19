import { parse } from "node:querystring";
import { errors } from "./errors.js";
import { foldEmail, foldTelephone, foldName, parseDDMMYYYY } from "./domain.js";
import { ukDateString, ukFields, isRepeatedHourDate, ukToInstant } from "./uktime.js";

export interface LocalDate {
  date: string;
  time: string;
  repeatedHour?: "first" | "second";
}

export interface ParsedLocalDate {
  date: string;
  time: string;
  instant: Date;
  repeatedHour?: "first" | "second";
}

export function parseLocalDate(v: unknown, field: string): ParsedLocalDate {
  if (!v || typeof v !== "object") throw errors.invalid({ [field]: "Enter a date as DD/MM/YYYY." });
  const o = v as Record<string, unknown>;
  if (typeof o.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) throw errors.invalid({ [field]: "Enter a date as DD/MM/YYYY." });
  if (typeof o.time !== "string" || !/^\d{2}:\d{2}$/.test(o.time)) throw errors.invalid({ [field]: "Choose an hour and minutes." });
  let repeatedHour: "first" | "second" | undefined;
  if (o.repeatedHour !== undefined && o.repeatedHour !== null) {
    if (o.repeatedHour !== "first" && o.repeatedHour !== "second") throw errors.invalid({ [field]: "Choose which time you mean." });
    repeatedHour = o.repeatedHour as "first" | "second";
  }
  const r = ukToInstant(o.date, o.time, repeatedHour === "second");
  if (!r.exists) throw errors.invalid({ [field]: `${o.time.slice(0, 5)} does not exist on ${o.date}, when the clocks go forward. Choose another time.` }, `${o.time.slice(0, 5)} does not exist on ${o.date}, when the clocks go forward. Choose another time.`);
  if (r.repeated && !repeatedHour) throw errors.invalid({ [field]: `Choose which ${o.time} you mean.` });
  return { date: o.date, time: o.time, instant: r.instant, repeatedHour };
}

export function isRepeatedTimeFor(date: string, time: string): boolean {
  if (!isRepeatedHourDate(date)) return false;
  const r = ukToInstant(date, time);
  return r.repeated;
}

export interface PartyInput {
  people: number;
  large: number;
  medium: number;
  hand: number;
  wheelchairs: number;
}

export function parseParty(v: unknown): PartyInput {
  const o = (v ?? {}) as Record<string, unknown>;
  const num = (x: unknown): number | null => {
    if (x === undefined || x === null || x === "") return null;
    const n = Number(x);
    return Number.isInteger(n) ? n : null;
  };
  const people = num(o.people);
  if (people === null || people < 1 || people > 400) throw errors.invalid({ people: "Enter between 1 and 400 people." });
  const large = num(o.large) ?? 0;
  const medium = num(o.medium) ?? 0;
  const hand = num(o.hand) ?? 0;
  const wheelchairs = num(o.wheelchairs) ?? 0;
  if (large < 0 || large > 40) throw errors.invalid({ large: "Enter between 0 and 40 bags." });
  if (medium < 0 || medium > 40) throw errors.invalid({ medium: "Enter between 0 and 40 bags." });
  if (hand < 0 || hand > 40) throw errors.invalid({ hand: "Enter between 0 and 40 bags." });
  if (wheelchairs < 0 || wheelchairs > 10) throw errors.invalid({ wheelchairs: "Enter between 0 and 10 wheelchair users." });
  return { people, large, medium, hand, wheelchairs };
}

export function validOccasion(v: unknown): boolean {
  return v === "school" || v === "weddings" || v === "company" || v === "festivals";
}

export function validJourneyType(v: unknown): v is "oneWay" | "return" | "sameDayReturn" | "severalStops" {
  return v === "oneWay" || v === "return" || v === "sameDayReturn" || v === "severalStops";
}

export function validEmail(v: unknown): boolean {
  return typeof v === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) && v.length <= 254;
}

export function validTelephone(v: unknown): boolean {
  if (typeof v !== "string" || v.length > 30) return false;
  const digits = v.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 13;
}

export function emailOrError(v: unknown, field = "email"): string {
  if (!validEmail(v)) throw errors.invalid({ [field]: "Enter a real email address." });
  return v as string;
}

export function telephoneOrError(v: unknown, field = "telephone"): string {
  if (!validTelephone(v)) throw errors.invalid({ [field]: "Enter a UK telephone number." });
  return v as string;
}

export function todayUK(): string {
  return ukDateString(new Date());
}

export function nowUKFields(): { hh: number; mm: number } {
  const f = ukFields(new Date());
  return { hh: f.hh, mm: f.mm };
}

/** Server clock cut to the whole minute, per Business rules. */
export function serverNowMinute(): Date {
  const d = new Date();
  return new Date(Math.floor(d.getTime() / 60000) * 60000);
}

export { foldEmail, foldTelephone, foldName, parseDDMMYYYY, parse };
