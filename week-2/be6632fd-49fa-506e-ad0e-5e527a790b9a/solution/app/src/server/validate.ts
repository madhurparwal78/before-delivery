// Field checks shared by every endpoint; each writes the brief's field message into `fields` at its path.
import { FIELD, outOfRange, tooLong } from "../shared/copy";
import { type Market, isMarket } from "../shared/time";

export type Fields = Record<string, string>;

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

/** User-perceived characters (grapheme clusters). */
export function graphemes(text: string): number {
  let count = 0;
  for (const _ of segmenter.segment(text)) count += 1;
  return count;
}

/** Text as typed, without surrounding spaces; a tab or other leading character is kept for the exports to neutralise. */
function spaced(value: unknown): string {
  return typeof value === "string" ? value.replace(/^ +| +$/g, "") : "";
}

export function requiredText(value: unknown, path: string, max: number, fields: Fields): string {
  const text = spaced(value);
  if (!text.trim()) fields[path] = FIELD.required;
  else if (graphemes(text) > max) fields[path] = tooLong(max);
  return text;
}

export function optionalText(value: unknown, path: string, max: number, fields: Fields): string {
  const text = spaced(value);
  if (graphemes(text) > max) fields[path] = tooLong(max);
  return text;
}

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

export function checkEmail(value: unknown, path: string, fields: Fields): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) fields[path] = FIELD.required;
  else if (!EMAIL.test(text) || text.length > 254) fields[path] = FIELD.email;
  return text;
}

export function checkPassword(value: unknown, path: string, fields: Fields): string {
  const text = typeof value === "string" ? value : "";
  const length = [...text].length;
  if (!length) fields[path] = FIELD.required;
  else if (length < 12 || length > 128) fields[path] = FIELD.password;
  return text;
}

export function wholeNumber(value: unknown, path: string, min: number, max: number, fields: Fields): number {
  if (value === undefined || value === null || value === "") {
    fields[path] = FIELD.required;
    return min;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fields[path] = outOfRange(min, max);
    return min;
  }
  return value;
}

export function checkMarket(value: unknown, path: string, fields: Fields): Market {
  if (value === undefined || value === null || value === "") fields[path] = FIELD.required;
  else if (!isMarket(value)) fields[path] = FIELD.market;
  return isMarket(value) ? value : "copenhagen";
}

export function failed(fields: Fields): boolean {
  return Object.keys(fields).length > 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
