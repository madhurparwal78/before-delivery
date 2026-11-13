import { LIMITS, normalizeText } from "../shared/text";
import type { FieldError } from "../shared/api-types";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export function asObject(value: Json | undefined): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

type LimitName = keyof typeof LIMITS;

type TextCheck = { ok: true; text: string } | { ok: false; error: FieldError };

/** The one server check for limited texts: NFC, trim, then count code points. */
export function checkText(value: Json | undefined, limit: LimitName): TextCheck {
  if (value === undefined || value === null) return { ok: false, error: "required" };
  if (typeof value !== "string" || value.includes("\u0000")) return { ok: false, error: "invalid" };
  const text = normalizeText(value);
  if (text === "") return { ok: false, error: "required" };
  if (Array.from(text).length > LIMITS[limit]) return { ok: false, error: "too_long" };
  return { ok: true, text };
}

export function positiveInteger(value: Json | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Deepest nesting of objects and arrays; the outer value is level 1. */
export function depth(value: Json): number {
  let deepest = 0;
  const stack: Array<[Json, number]> = [[value, 1]];
  while (stack.length > 0) {
    const [node, level] = stack.pop() as [Json, number];
    if (node === null || typeof node !== "object") continue;
    deepest = Math.max(deepest, level);
    for (const child of Array.isArray(node) ? node : Object.values(node)) stack.push([child, level + 1]);
  }
  return deepest;
}

export function sameJson(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameJson(item, b[i] as Json));
  }
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => key in b && sameJson(a[key] as Json, b[key] as Json));
}
