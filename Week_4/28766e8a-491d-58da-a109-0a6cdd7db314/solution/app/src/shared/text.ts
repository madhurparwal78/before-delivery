// The text safety rule and the account / diagram field rules (brief: Text safety, API Limits).
// Adapted from kit/modules/header_safe: the brief's rule is stricter (every C0 control and DEL).
import { copy } from "./copy";

const CONTROL = /[\u0000-\u001f\u007f]/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const LIMITS = {
  title: 120,
  name: 80,
  label: 200,
  pageName: 60,
  layerName: 60,
  comment: 2000,
  versionName: 80,
  password: 10,
  pagesPerDiagram: 20,
  layersPerPage: 10,
  shapesPerPage: 500,
  connectorsPerPage: 500,
} as const;

export function hasControl(value: string): boolean {
  return CONTROL.test(value);
}

/** Field error for a diagram title, or null when it is acceptable. */
export function titleError(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return copy.fields.title;
  if (hasControl(value)) return copy.fields.control;
  if (value.length > LIMITS.title) return copy.fields.title;
  return null;
}

/** Field error for a display name, or null when it is acceptable. */
export function nameError(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return copy.fields.name;
  if (hasControl(value)) return copy.fields.control;
  if (value.length > LIMITS.name) return copy.fields.name;
  return null;
}

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function emailError(value: unknown): string | null {
  return typeof value === "string" && EMAIL.test(value.trim()) && !hasControl(value) ? null : copy.fields.email;
}

export function passwordError(value: unknown): string | null {
  return typeof value === "string" && value.length >= LIMITS.password ? null : copy.fields.password;
}
