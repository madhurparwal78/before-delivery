import { isDate, isZone } from "../shared/time.js";
import { invalid } from "./http.js";

// Field checks for request bodies. Each returns an error sentence or null.

type Check = string | null;

const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

export function text(value: unknown, label: string, max: number): Check {
  if (typeof value !== "string" || value.trim().length === 0) return `Enter ${label}.`;
  if (value.trim().length > max) return `Keep ${label} to ${max} characters or fewer.`;
  return null;
}

export function email(value: unknown): Check {
  return typeof value === "string" && value.length <= 254 && EMAIL.test(value.trim()) ? null : "Enter a valid email address.";
}

export function password(value: unknown): Check {
  return typeof value === "string" && value.length >= 10 ? null : "Use at least 10 characters.";
}

export function zone(value: unknown): Check {
  return typeof value === "string" && isZone(value) ? null : "Choose a time zone from the list.";
}

export function stepped(value: unknown, min: number, max: number, step: number, unit: string): Check {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max && value % step === 0
    ? null
    : `Use ${min} to ${max} ${unit} in steps of ${step}.`;
}

export function estimate(value: unknown): Check {
  return value === null ? null : stepped(value, 5, 600, 5, "minutes");
}

export function date(value: unknown): Check {
  return typeof value === "string" && isDate(value) ? null : "Use a date written as YYYY-MM-DD.";
}

/** Throws one 422 with every failing field. */
export function settle(checks: Record<string, Check>): void {
  const fields = Object.fromEntries(Object.entries(checks).filter((entry): entry is [string, string] => entry[1] !== null));
  if (Object.keys(fields).length) throw invalid(fields);
}
