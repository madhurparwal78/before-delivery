/** Shared field checks for request bodies: amounts, memos, dates. */
import { MAX_AMOUNT_CENTS } from "../../shared/money.js";
import { MEMO_TOO_LONG } from "../../shared/messages.js";
import { MEMO_MAX } from "../../shared/rules.js";
import type { Fields } from "../http/errors.js";
import { codePointLength, hasRefusedCharacter } from "../http/text.js";

/** An amount in a request is a JSON integer from 1 to 9007199254740991. */
export function readAmountCents(value: unknown, fields: Fields, field: string): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= MAX_AMOUNT_CENTS) return value;
  fields.fail(field, "Enter an amount greater than $0.00");
  return null;
}

/** A memo is null or up to 140 code points of plain text. Returns the memo to store. */
export function readMemo(value: unknown, fields: Fields, field = "memo"): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || codePointLength(value) > MEMO_MAX || hasRefusedCharacter(value, "multi-line")) {
    fields.fail(field, MEMO_TOO_LONG);
    return null;
  }
  return value;
}

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value: string): boolean {
  if (!DATE_FORMAT.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
