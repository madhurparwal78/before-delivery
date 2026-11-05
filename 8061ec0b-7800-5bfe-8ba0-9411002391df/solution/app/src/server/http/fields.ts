// Reading request fields without trusting their types, and server-chosen IDs.

import { randomBytes } from "node:crypto";

export function fieldOf(body: unknown, name: string): unknown {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return undefined;
  return Object.getOwnPropertyDescriptor(body, name)?.value;
}

/** The value when it is a whole number from `min` to `max`, else null. */
export function wholeNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/** The value when it is one of `allowed`, else null. */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return allowed.find((item) => item === value) ?? null;
}

/** A trimmed string of `min` to `max` characters, else null. */
export function trimmedText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return [...text].length >= min && [...text].length <= max ? text : null;
}

/** Server-chosen IDs for payments, reversals, ledger entries, transfers and condition events. */
export function newId(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString("hex").toUpperCase()}`;
}

/** Random, URL-safe, 128-bit-plus identifiers (photo IDs). */
export function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}
