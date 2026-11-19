// Typed cell values: what each column type accepts, how it is stored and shown.
import { Dec, readDecimalText } from "./decimal.js";
import { type Json, JsonNumber } from "./json.js";
import type { DataType, Stored } from "./model.js";

const ERRORS = ["#DIV/0!", "#TYPE!", "#NAME?", "#REF!", "#CIRC!"] as const;
export type ErrorValue = (typeof ERRORS)[number];

export const TOOLTIPS: Record<ErrorValue, string> = {
  "#DIV/0!": "#DIV/0! Division by zero.",
  "#TYPE!": "#TYPE! A value has the wrong type for this operation.",
  "#NAME?": "#NAME? This formula uses a name that does not exist.",
  "#REF!": "#REF! This formula points at a row that was deleted.",
  "#CIRC!": "#CIRC! This formula depends on itself.",
};

export type Value =
  | { k: "blank" }
  | { k: "dec"; d: Dec }
  | { k: "text"; s: string }
  | { k: "date"; day: number }
  | { k: "bool"; b: boolean }
  | { k: "err"; e: ErrorValue };

export const BLANK: Value = { k: "blank" };
export const err = (e: ErrorValue): Value => ({ k: "err", e });

export const MESSAGES = {
  text: "Enter text.",
  textLong: "Text can be at most 10,000 characters.",
  decimal: "Enter a number with up to 15 digits before the decimal point.",
  date: "Enter a date as YYYY-MM-DD.",
  bool: "Enter true or false.",
  formulaCell: "Formula cells are calculated. Edit the column formula instead.",
  ownRows: "You can only assign rows to yourself.",
  reference: (table: string) => `Choose a row from ${table}.`,
} as const;

// Calendar days counted from 0001-01-01 (proleptic Gregorian), with no time zone.
const MIN_DAY = 0;
const MAX_DAY = daysFromCivil(9999, 12, 31);

function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 306; // day 0 is 0001-01-01
}

function civilFromDays(days: number): [number, number, number] {
  const z = days + 306;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}

function readDate(text: string): number | null {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(text);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (y < 1 || m < 1 || m > 12 || d < 1) return null;
  const day = daysFromCivil(y, m, d);
  const [cy, cm, cd] = civilFromDays(day);
  return cy === y && cm === m && cd === d ? day : null;
}

export function dateInRange(day: number): boolean {
  return day >= MIN_DAY && day <= MAX_DAY;
}

function showDate(day: number): string {
  const [y, m, d] = civilFromDays(day);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function display(value: Value): string {
  switch (value.k) {
    case "blank":
      return "";
    case "dec":
      return value.d.display();
    case "text":
      return value.s;
    case "date":
      return showDate(value.day);
    case "bool":
      return value.b ? "TRUE" : "FALSE";
    case "err":
      return value.e;
  }
}

// Reads a stored data value of a column type back into a formula value.
export function storedValue(type: DataType, stored: Stored): Value {
  if (stored === null || stored === "") return BLANK;
  switch (type) {
    case "text":
      return { k: "text", s: String(stored) };
    case "decimal":
      return { k: "dec", d: Dec.parse(String(stored))! };
    case "date":
      return { k: "date", day: readDate(String(stored))! };
    case "bool":
      return { k: "bool", b: stored === true };
  }
}

type Accepted = { ok: true; stored: Stored } | { ok: false; message: string };

// Validates a written JSON value for a data column type and gives its stored form.
export function acceptValue(type: DataType, value: Json | undefined): Accepted {
  if (value === null || value === undefined || value === "") return { ok: true, stored: null };
  switch (type) {
    case "text":
      if (typeof value !== "string") return { ok: false, message: MESSAGES.text };
      if (Array.from(value).length > 10_000) return { ok: false, message: MESSAGES.textLong };
      return { ok: true, stored: value };
    case "decimal": {
      const text = value instanceof JsonNumber ? value.raw : typeof value === "string" ? value : null;
      const parsed = text === null ? null : readDecimalText(text);
      return parsed ? { ok: true, stored: parsed.display() } : { ok: false, message: MESSAGES.decimal };
    }
    case "date":
      return typeof value === "string" && readDate(value) !== null
        ? { ok: true, stored: value }
        : { ok: false, message: MESSAGES.date };
    case "bool":
      if (typeof value === "boolean") return { ok: true, stored: value };
      if (typeof value === "string" && /^(true|false)$/i.test(value)) return { ok: true, stored: value.toLowerCase() === "true" };
      return { ok: false, message: MESSAGES.bool };
  }
}

// A type change reads each old display, trimmed, by the new type's string rule.
export function convertDisplay(type: DataType, shown: string): Stored {
  const text = shown.trim();
  if (text === "") return null;
  const accepted = acceptValue(type, text);
  return accepted.ok ? accepted.stored : null;
}
