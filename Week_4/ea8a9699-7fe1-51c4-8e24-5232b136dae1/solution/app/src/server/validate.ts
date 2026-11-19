// Field checks with the brief's exact messages (brief: API > Field messages).
import type { FieldErrors } from "./errors.js";
import type { Json, JsonObject } from "./http.js";
import { Q_MAX, Q_MESSAGE, queryLength } from "../shared/search.js";

export const MESSAGES = {
  email: "Enter a valid email address.",
  emailTaken: "That email already has an account.",
  passwordShort: "Use at least 10 characters.",
  passwordEmpty: "Enter your password.",
  handle: "Use 3 to 24 lowercase letters, digits or hyphens.",
  handleTaken: "That handle is taken.",
  handleSelf: "You cannot follow yourself.",
  name: "Enter 1 to 60 characters.",
  title: "Enter a title of 1 to 80 characters.",
  longText: "Use at most 2000 characters.",
  body: "Write a comment of 1 to 2000 characters.",
  q: Q_MESSAGE,
  liftFormat: "Use a date and time like 2027-03-29T09:00.",
  future: "Choose a time in the future.",
  expiryWindow: "Choose an expiry within the next 30 days.",
  frameRate: "Choose 24, 25 or 30 frames per second.",
  durationMs: "Enter a duration from 1 to 3600000 milliseconds.",
  file: "Attach one file.",
  planMissing: "Choose a plan to upgrade to.",
  planUnknown: "Unknown plan.",
  planSmaller: "Choose a larger plan than the current one.",
  idempotencyKey: "Send an Idempotency-Key of 1 to 64 characters.",
  limit: "Use a whole number of 1 or more.",
  cursor: "Invalid cursor.",
  memberId: "Unknown member.",
} as const;

export const liftGapMessage = (timeZone: string): string => `That time does not exist in ${timeZone} on that date.`;
export const positionMessage = (n: number): string => `Choose a position from 1 to ${n}.`;
export const frameMessage = (last: number): string => `Choose a frame from 0 to ${last}.`;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HANDLE = /^[a-z0-9-]{3,24}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const length = (value: string): number => [...value].length;

export function text(body: JsonObject, field: string): string | null {
  const value: Json | undefined = body[field];
  return typeof value === "string" ? value : null;
}

export const normalEmail = (value: string | null): string => (value ?? "").trim().toLowerCase();
export const isEmail = (value: string): boolean => value.length <= 254 && EMAIL.test(value);
export const isHandle = (value: string | null): value is string => value !== null && HANDLE.test(value);
export const isName = (value: string | null): value is string => value !== null && value.trim().length > 0 && length(value) <= 60;
export const isTitle = (value: string | null): value is string => value !== null && value.trim().length > 0 && length(value) <= 80;
export const isLongText = (value: string | null): value is string => value !== null && length(value) <= 2000;
export const isCommentBody = (value: string | null): value is string => value !== null && value.trim().length > 0 && length(value) <= 2000;
export const isQuery = (value: string | null): value is string => value !== null && queryLength(value) >= 1 && queryLength(value) <= Q_MAX;
export const isUuid = (value: string | null | undefined): value is string => typeof value === "string" && UUID.test(value);

/** Collects field errors; `check` records the message when the condition fails. */
export class Fields {
  readonly errors: FieldErrors = {};
  check(ok: boolean, field: string, message: string): this {
    if (!ok && !(field in this.errors)) this.errors[field] = message;
    return this;
  }
  get failed(): boolean {
    return Object.keys(this.errors).length > 0;
  }
}
