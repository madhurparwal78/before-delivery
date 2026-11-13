// Validation and parsing helpers shared by the routes.

import type { Request } from "express";
import { createHash } from "node:crypto";
import { validation } from "./errors.js";
import { SECTION_KEYS, SECTION_NAMES, SECTION_ROSTER } from "../shared/domain.js";
import type { SectionKey } from "../shared/domain.js";

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export interface SingleLineResult {
  value: string;
  error?: undefined;
}

export interface SingleLineError {
  value?: undefined;
  error: string;
}

/** The single-line rule, in one place. */
export function singleLine(
  value: unknown,
  label: string
): SingleLineResult | SingleLineError {
  if (typeof value !== "string") return { error: `${label} must be one line of text.` };
  if (CONTROL_CHARS.test(value)) return { error: `${label} must be one line of text.` };
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 120) {
    return { error: `${label} must be 1 to 120 characters.` };
  }
  return { value: trimmed };
}

/** Reads a request timestamp as an instant, per the Timestamps rule. */
export function parseInstant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** The Idempotency-Key rule: 1 to 80 visible ASCII characters. */
export function idempotencyKey(req: Request): string | null {
  const key = req.header("Idempotency-Key");
  if (key === undefined) return null;
  if (!/^[\x20-\x7e]{1,80}$/.test(key)) {
    throw validation({ idempotency_key: "The idempotency key must be 1 to 80 visible characters." });
  }
  return key;
}

export function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function isWholeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** The string-count rule: whole numbers from 0 to the section's roster. */
export function parseStringCount(
  value: unknown,
  errors: Record<string, string>,
  prefix: string
): Record<SectionKey, number> {
  const source = (value !== null && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const out = {} as Record<SectionKey, number>;
  for (const key of SECTION_KEYS) {
    const raw = source[key];
    if (!isWholeNumber(raw) || raw < 0 || raw > SECTION_ROSTER[key]) {
      errors[`${prefix}${key}`] =
        isWholeNumber(raw) && raw > SECTION_ROSTER[key]
          ? `The roster has ${SECTION_ROSTER[key]} players in ${SECTION_NAMES[key]}.`
          : `Enter a whole number from 0 to ${SECTION_ROSTER[key]}.`;
      out[key] = 0;
      continue;
    }
    out[key] = raw;
  }
  return out;
}

export function statusText(status: string): string {
  switch (status) {
    case "draft": return "Draft";
    case "in_preparation": return "In preparation";
    case "published": return "Published";
    case "in_performance": return "In performance";
    case "closed": return "Closed";
    default: return status;
  }
}

export function rentalText(status: string): string {
  switch (status) {
    case "requested": return "Requested";
    case "received": return "Received";
    case "in_use": return "In use";
    case "returned": return "Returned";
    case "checked_in": return "Checked in";
    default: return status;
  }
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
