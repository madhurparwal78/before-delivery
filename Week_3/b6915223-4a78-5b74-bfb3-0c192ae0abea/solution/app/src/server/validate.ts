import { invalid, notFound } from "./errors.ts";
import { LAST_GAMEWEEK } from "./seed.ts";

// Request-shape checks shared by the handlers. Each failure is a 422 `validation` with a field message.

export function objectBody(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw invalid({ body: "Send a JSON object." });
  return body as Record<string, unknown>;
}

export function idList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string")) {
    throw invalid({ [field]: `${field} must be a list of player ids.` });
  }
  return value;
}

// A gameweek field: not a whole number is invalid; a number outside 1 to 36 names no gameweek.
export function gameweekField(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw invalid({ gameweek: "gameweek must be a whole number." });
  if (value < 1 || value > LAST_GAMEWEEK) throw notFound(`Gameweek ${value} does not exist.`);
  return value;
}

export function gameweekParam(value: string | undefined): number {
  const number = /^\d{1,3}$/.test(value ?? "") ? Number(value) : 0;
  if (number < 1 || number > LAST_GAMEWEEK) throw notFound(`Gameweek ${value ?? ""} does not exist.`);
  return number;
}

export function trimmedText(value: unknown, field: string, min: number, max: number, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  const length = [...text].length;
  if (length < min || length > max) throw invalid({ [field]: `${label} must be ${min} to ${max} characters.` });
  return text;
}

export function hasDuplicates(ids: readonly string[]): boolean {
  return new Set(ids).size !== ids.length;
}
