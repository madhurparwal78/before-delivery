import type { JsonValue } from "./json.js";
import { isObject } from "./json.js";

/** The one number and date display rule (brief: Number and date display). */

const DATE_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

function dateText(value: JsonValue | undefined): string | null {
  if (!isObject(value)) return null;
  const keys = Object.keys(value);
  const text = value["$date"];
  return keys.length === 1 && typeof text === "string" && DATE_TEXT.test(text) ? text : null;
}

function expandExponent(text: string): string {
  const parts = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(text);
  if (!parts) return text;
  const [, sign = "", whole = "", fraction = "", exponent = "0"] = parts;
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  let plain: string;
  if (point <= 0) plain = "0." + "0".repeat(-point) + digits;
  else if (point >= digits.length) plain = digits + "0".repeat(point - digits.length);
  else plain = digits.slice(0, point) + "." + digits.slice(point);
  if (plain.includes(".")) plain = plain.replace(/0+$/, "").replace(/\.$/, "");
  return sign + plain;
}

export function displayNumber(value: number): string {
  if (Number.isInteger(value)) return Math.abs(value) >= 1e21 ? BigInt(value).toString() : String(value);
  return expandExponent(value.toPrecision(6));
}

/** JSON text with every number under the display rule; dates stay `{"$date":...}`. `indent` spaces pretty-prints. */
export function displayJson(value: JsonValue, indent = 0, level = 0): string {
  if (typeof value === "number") return displayNumber(value);
  const date = dateText(value);
  if (date !== null) return `{"$date":${JSON.stringify(date)}}`;
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  const entries = Array.isArray(value)
    ? value.map((inner) => displayJson(inner, indent, level + 1))
    : Object.entries(value).map(([key, inner]) => `${JSON.stringify(key)}:${indent > 0 ? " " : ""}${displayJson(inner, indent, level + 1)}`);
  const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  if (entries.length === 0) return open + close;
  if (indent === 0) return open + entries.join(",") + close;
  const pad = " ".repeat(indent * (level + 1));
  return `${open}\n${entries.map((entry) => pad + entry).join(",\n")}\n${" ".repeat(indent * level)}${close}`;
}

/** A field value as list and table views show it. */
export function displayCell(value: JsonValue | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  const date = dateText(value);
  return date ?? displayJson(value);
}

export function plural(count: number, noun: string): string {
  return `${displayNumber(count)} ${noun}${count === 1 ? "" : "s"}`;
}
