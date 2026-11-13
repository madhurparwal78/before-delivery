import { ApiError, validation } from "../errors.js";
import { VALIDATION_COPY } from "../../shared/copy.js";
import { DEFAULT_SIZE, isBoxInsidePage, roundBox } from "../../shared/geometry.js";
import { LABEL_LIMIT, NAME_LIMIT, REASON_LIMIT, SIGNER_LIMIT, TITLE_LIMIT, codePoints } from "../../shared/limits.js";
import type { Box, FieldKind } from "../../shared/types.js";

export type Body = Record<string, unknown>;
export type Problems = Record<string, string>;

export function asBody(value: unknown): Body {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Body;
}

export function throwIfAny(problems: Problems): void {
  if (Object.keys(problems).length > 0) throw validation(problems);
}

export function titleProblem(value: unknown): string | null {
  return typeof value === "string" && codePoints(value.trim()) >= 1 && codePoints(value.trim()) <= TITLE_LIMIT ? null : VALIDATION_COPY.title;
}

const ZONES = new Set<string>([...Intl.supportedValuesOf("timeZone"), "UTC"]);

export function timeZoneProblem(value: unknown): string | null {
  return typeof value === "string" && ZONES.has(value) ? null : VALIDATION_COPY.timeZone;
}

export function nameProblem(value: unknown): string | null {
  return typeof value === "string" && value.trim().length >= 1 && codePoints(value.trim()) <= NAME_LIMIT ? null : VALIDATION_COPY.name;
}

const EMAIL = /^[^\s@<>(),;:"\\[\]]+@[^\s@<>(),;:"\\[\]]+\.[^\s@<>(),;:"\\[\]]{2,}$/;

export function emailProblem(value: unknown): string | null {
  return typeof value === "string" && value.length <= 254 && EMAIL.test(value.trim()) ? null : VALIDATION_COPY.emailInvalid;
}

export function labelProblem(value: unknown): string | null {
  return typeof value === "string" && codePoints(value.trim()) >= 1 && codePoints(value.trim()) <= LABEL_LIMIT ? null : VALIDATION_COPY.label;
}

export function isFieldKind(value: unknown): value is FieldKind {
  return typeof value === "string" && value in DEFAULT_SIZE;
}

export function recipientLimitProblem(count: number): string | null {
  return count >= SIGNER_LIMIT ? VALIDATION_COPY.recipients : null;
}

export function boxProblem(box: Box, page: unknown, pageCount: number): string | null {
  const pageOk = typeof page === "number" && Number.isInteger(page) && page >= 1 && page <= pageCount;
  return pageOk && isBoxInsidePage(roundBox(box)) ? null : VALIDATION_COPY.geometry;
}

export function numbersOf(body: Body, keys: (keyof Box)[]): Partial<Box> {
  const out: Partial<Box> = {};
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "number") out[key] = value;
  }
  return out;
}

export function reasonProblem(value: unknown, empty: string): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return empty;
  return codePoints(value) > REASON_LIMIT ? VALIDATION_COPY.reasonTooLong : null;
}
