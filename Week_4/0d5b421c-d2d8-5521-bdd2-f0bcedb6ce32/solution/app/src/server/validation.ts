// Input validation. A parser returns its value, or null when the input is not acceptable;
// every failing input is then reported under its own key, with the published sentences.
import { targetById, type Target } from "./catalog.js";
import { apiErrors } from "./errors.js";
import { dateWithinHorizon, isSlotTime } from "./domain/slots.js";

export const MESSAGES = {
  date: "Choose a date from today to 30 days ahead.",
  time: "Choose a time from 18:00 to 22:00 on the quarter hour.",
  party: "Choose 1 to 8 guests.",
  table: "Choose a table from the plan.",
  name: "Enter your name.",
  email: "Enter an email address like name@example.com.",
  phone: "Use 32 characters or fewer.",
  deposit: "Tick the box to accept the deposit.",
  latest: "Choose a time no earlier than the earliest.",
  now: "Send an ISO 8601 instant with an offset or Z.",
};

type Check = [value: unknown, message: string];

/** The 422 for the checks whose value is null or false: one key per failing input. */
export function rejectInvalid(checks: Record<string, Check>) {
  const fields: Record<string, string> = {};
  for (const [key, [value, message]] of Object.entries(checks)) {
    if (value === null || value === false) fields[key] = message;
  }
  return apiErrors.validationFailed(fields);
}

export function parseDate(value: unknown, at: Date): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  const onTheCalendar = !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  return onTheCalendar && dateWithinHorizon(value, at) ? value : null;
}

export function parseSlot(value: unknown): string | null {
  return typeof value === "string" && isSlotTime(value) ? value : null;
}

export function parsePartySize(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 8 ? value : null;
}

/** Query strings carry the party as text. */
export function parsePartyQuery(value: string | null): number | null {
  return value !== null && /^\d+$/.test(value) ? parsePartySize(Number(value)) : null;
}

export function parseTarget(value: unknown): Target | null {
  return (typeof value === "string" ? targetById(value) : undefined) ?? null;
}

export function parseName(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length >= 1 && trimmed.length <= 80 ? trimmed : null;
}

export function parseEmail(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

/** The phone is optional; `undefined` means none was given. */
export function parsePhone(value: unknown): string | null | undefined {
  if (value === undefined || value === "") return undefined;
  return typeof value === "string" && value.length <= 32 ? value : null;
}

export function objectBody(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body) ? Object.fromEntries(Object.entries(body)) : {};
}
