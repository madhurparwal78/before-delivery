// Field checks shared by the handlers; each returns the value or records the published message.
import { validationFailed } from "./errors";

export const NAME_MESSAGE = "Enter a name.";
export const EMAIL_MESSAGE = "Enter an email address like name@example.be.";
export const IBAN_MESSAGE = "Enter a valid IBAN, for example BE68 5390 0754 7034.";
export const PRICE_MESSAGE = "Enter a price from €1.00 to €10,000.00.";
export const INTAKE_MESSAGE = "Choose today or a date up to 730 days back.";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
export const isEmail = (value: unknown): value is string => typeof value === "string" && value.length <= 254 && EMAIL.test(value);
export const isMonth = (value: unknown): value is string => typeof value === "string" && MONTH.test(value);
export const isWholeNumber = (value: unknown): value is number => Number.isSafeInteger(value);

export function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const isText = (value: unknown, longest: number): value is string => typeof value === "string" && value.trim().length >= 1 && value.length <= longest;

export const isPriceCents = (value: unknown): value is number => isWholeNumber(value) && value >= 100 && value <= 1_000_000;

/** Collects field problems and refuses the request once with all of them. */
export class FieldProblems {
  private readonly problems: Record<string, string> = {};

  add(field: string, message: string): void {
    this.problems[field] = message;
  }

  check(): void {
    if (Object.keys(this.problems).length) throw validationFailed(this.problems);
  }
}

export function isRecordList(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every((item) => typeof item === "object" && item !== null && !Array.isArray(item));
}
