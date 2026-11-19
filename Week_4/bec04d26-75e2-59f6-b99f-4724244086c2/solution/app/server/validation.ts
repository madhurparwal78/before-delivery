import { isRealDate } from "../shared/calendar";
import type { FieldErrors } from "../shared/types";
import { invalid } from "./http/errors";
import { isAmount } from "./domain/money";
import { FREQUENCIES, periodMatches } from "./domain/schedule";
import type { Carry, Edition, Frequency } from "../shared/types";

/** Field messages, by API key, exactly as the brief publishes them. */
export const MESSAGES = {
  yourName: "Enter your name.",
  ownerName: "Enter the owner's name.",
  businessName: "Enter a business name.",
  email: "Enter a valid email address.",
  emailTaken: "An account with this email already exists.",
  password: "Use at least 8 characters.",
  signIn: "Email or password is wrong.",
  state: "Choose a state.",
  stateTaken: "This client is already registered in this state.",
  frequency: "Choose a filing frequency.",
  firstPeriod: "Enter a period like 2026-05, 2026-Q2 or 2026 to match the frequency.",
  holidays: "Enter dates as YYYY-MM-DD, one per line.",
  effectiveDate: "Enter a date as YYYY-MM-DD.",
  effectiveDateTaken: "An edition already starts on this date.",
  dueDay: "Enter a due day from 1 to 31.",
  carry: "Choose a carry-forward rule.",
  rate: "Enter a rate with three decimals.",
  extensionDays: "Enter whole days from 0 to 180.",
  amount: "Enter an amount with two decimals.",
  reason: "Give a reason for sending this back.",
  reasonLong: "Keep the reason to 500 characters or fewer.",
  note: "Keep the note to 500 characters or fewer.",
  reminderHour: "Choose a whole hour from 6 to 21.",
  version: "Send the version you last saw.",
  instant: "Send an instant like 2026-06-22T15:00:00.000Z.",
  month: "Send a month like 2026-06.",
  year: "Send a year like 2026.",
  status: "Choose a status.",
  zone: "Enter a time zone such as America/Chicago.",
  editions: "Give at least one edition.",
} as const;

const TEXT_LIMIT = 500;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A unique-key violation raised by a racing write becomes the same 422 as the up-front check. */
export const duplicate = (key: string, message: string) => (error: unknown): never => {
  if ((error as { code?: string }).code === "23505") throw invalid({ [key]: message });
  throw error;
};

export const isVersion = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

export const asObject = (value: unknown): Record<string, unknown> => (isObject(value) ? value : {});

export const trimmed = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Collects field messages in form order; `done()` throws the 422 when any were collected. */
export class Check {
  readonly errors: FieldErrors = {};

  fail(key: string, message: string): void {
    if (!(key in this.errors)) this.errors[key] = message;
  }

  done(): void {
    if (Object.keys(this.errors).length) throw invalid(this.errors);
  }

  displayName(key: string, value: unknown, message: string): string {
    const name = trimmed(value);
    if (!name) this.fail(key, message);
    return name;
  }

  email(key: string, value: unknown): string {
    const email = trimmed(value);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) this.fail(key, MESSAGES.email);
    return email;
  }

  password(key: string, value: unknown): string {
    const password = typeof value === "string" ? value : "";
    if (password.length < 8) this.fail(key, MESSAGES.password);
    return password;
  }

  frequency(key: string, value: unknown): Frequency {
    if (!FREQUENCIES.includes(value as Frequency)) this.fail(key, MESSAGES.frequency);
    return value as Frequency;
  }

  firstPeriod(key: string, frequency: unknown, value: unknown): string {
    const period = typeof value === "string" ? value : "";
    if (!FREQUENCIES.includes(frequency as Frequency) || !periodMatches(frequency as Frequency, period)) {
      this.fail(key, MESSAGES.firstPeriod);
    }
    return period;
  }

  date(key: string, value: unknown, message: string): string {
    const date = typeof value === "string" ? value : "";
    if (!isRealDate(date)) this.fail(key, message);
    return date;
  }

  amount(key: string, value: unknown): string {
    if (!isAmount(value)) this.fail(key, MESSAGES.amount);
    return value as string;
  }

  note(key: string, value: unknown): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || value.length > TEXT_LIMIT) {
      this.fail(key, MESSAGES.note);
      return null;
    }
    return value;
  }

  integer(key: string, value: unknown, low: number, high: number, message: string): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < low || value > high) this.fail(key, message);
    return value as number;
  }

  rate(key: string, value: unknown): string {
    if (typeof value !== "string" || !/^\d{1,3}\.\d{3}$/.test(value)) this.fail(key, MESSAGES.rate);
    return value as string;
  }

  version(value: unknown): number {
    if (!isVersion(value)) this.fail("version", MESSAGES.version);
    return value as number;
  }
}

/** The fields of one rule edition, under an optional key prefix. */
export function editionFrom(check: Check, prefix: string, body: Record<string, unknown>): Edition {
  const effective = check.date(`${prefix}effective_date`, body.effective_date, MESSAGES.effectiveDate);
  const dueDay = check.integer(`${prefix}due_day`, body.due_day, 1, 31, MESSAGES.dueDay);
  if (body.carry !== "next_business" && body.carry !== "fixed") check.fail(`${prefix}carry`, MESSAGES.carry);
  const rate = check.rate(`${prefix}rate`, body.rate);
  const extensionDays = check.integer(`${prefix}extension_days`, body.extension_days, 0, 180, MESSAGES.extensionDays);
  return { effective_date: effective, due_day: dueDay, carry: body.carry as Carry, rate, extension_days: extensionDays };
}
