// Field validation for assignment requests; every message here is shown under its field.
import { DateTime } from "luxon";
import { AGENCY_ZONE } from "../shared/time.js";
import type { FieldErrors } from "./http.js";

type JsonObject = Record<string, unknown>;

export function asObject(body: unknown): JsonObject | null {
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as JsonObject) : null;
}

export function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function textField(
  errors: FieldErrors,
  body: JsonObject,
  name: string,
  max: number,
  message: string,
  { required }: { required: boolean },
): string {
  const value = body[name] ?? (required ? undefined : "");
  if (typeof value !== "string" || value.length > max || (required && value.trim() === "")) {
    errors[name] = message;
    return "";
  }
  return value.trim();
}

export const MESSAGES = {
  language: "Choose a language.",
  setting: "Choose hospital, clinic or school.",
  startInvalid: "Enter a date (YYYY-MM-DD) and a start time (HH:MM).",
  startSoon: "Start at least 60 minutes from now.",
  startFar: "Start within 365 days from now.",
  startQuarter: "Start on a quarter hour (:00, :15, :30 or :45).",
  startWindow: "Start at 06:00 or later and end by 22:00 on the same day.",
  duration: "Enter 30 to 480 minutes in steps of 15.",
  street: "Enter the street address, up to 200 characters.",
  city: "Enter the city, up to 80 characters.",
  initials: "Enter 2 or 3 capital letters, such as RM.",
  notes: "Keep medical notes to 1,000 characters.",
} as const;

export function validDuration(value: unknown): value is number {
  return isInteger(value) && value >= 30 && value <= 480 && value % 15 === 0;
}

/**
 * Check a requested start (and the duration, when it is valid) against the booking window.
 * Returns the parsed start, or null after recording the error on `start_at`.
 */
export function validStart(errors: FieldErrors, value: unknown, duration: number | null): DateTime | null {
  const start = typeof value === "string" ? DateTime.fromISO(value, { setZone: true }) : null;
  if (!start || !start.isValid || typeof value !== "string" || !/T\d{2}:\d{2}/.test(value)) {
    errors.start_at = MESSAGES.startInvalid;
    return null;
  }
  const local = start.setZone(AGENCY_ZONE);
  const now = DateTime.now();
  let message: string | null = null;
  if (local < now.plus({ minutes: 60 })) message = MESSAGES.startSoon;
  else if (local > now.plus({ days: 365 })) message = MESSAGES.startFar;
  else if (local.minute % 15 !== 0 || local.second !== 0 || local.millisecond !== 0) message = MESSAGES.startQuarter;
  else {
    const startMinute = local.hour * 60 + local.minute;
    const endMinute = startMinute + (duration ?? 0);
    if (startMinute < 6 * 60 || endMinute > 22 * 60 || startMinute >= 22 * 60) message = MESSAGES.startWindow;
  }
  if (message) {
    errors.start_at = message;
    return null;
  }
  return local;
}
