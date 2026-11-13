import { FIELD_MESSAGES } from "./http.js";

export const EMAIL_MAX = 254;
export const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > EMAIL_MAX) return null;
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) return null;
  const domain = email.slice(at + 1);
  if (!domain.includes(".")) return null;
  if (email.split(" ").length !== 1) return null;
  return email;
}

export function normalizeHandle(raw: string): string | null {
  const handle = raw.trim();
  if (!HANDLE_PATTERN.test(handle)) return null;
  return handle;
}

export function validPassword(raw: string): boolean {
  return typeof raw === "string" && raw.length >= 10 && raw.length <= 128;
}

export type FieldErrors = Record<string, string>;

export function validateSignup(body: { email: string; handle: string; password: string }): FieldErrors | null {
  const errors: FieldErrors = {};
  if (!normalizeEmail(body.email)) errors["email"] = FIELD_MESSAGES.emailInvalid;
  if (!normalizeHandle(body.handle)) errors["handle"] = FIELD_MESSAGES.handleInvalid;
  if (!validPassword(body.password)) errors["password"] = FIELD_MESSAGES.passwordInvalid;
  return Object.keys(errors).length > 0 ? errors : null;
}

export function normalizeMessageBody(raw: string): string | null {
  const body = raw.trim();
  if (body.length < 1 || body.length > 500) return null;
  return body;
}
