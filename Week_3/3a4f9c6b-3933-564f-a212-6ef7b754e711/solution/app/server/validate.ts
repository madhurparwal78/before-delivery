// Shared request validation (step 8 of the error precedence), with the brief's field messages.
import type { Overrides } from "../shared/api.js";

export const MESSAGES = {
  reason: "Give a reason of 10 to 500 characters.",
  comment: "Keep the comment to 500 characters.",
  parameters: "Use upper-case keys and text values up to 1,000 characters.",
  replicas: "Use whole numbers from 0 to 100.",
  instant: "Use an ISO 8601 instant with an offset.",
} as const;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/i;

/** An ISO 8601 instant that carries an offset, as epoch milliseconds; null when it is not one. */
export function parseInstant(value: unknown): number | null {
  if (typeof value !== "string" || !INSTANT.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function isReason(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 10 && value.length <= 500;
}

const PARAMETER_KEY = /^[A-Z][A-Z0-9_]{0,63}$/;
const REF = /^[^/\s]+\/[^/\s]+\/[^/\s]+$/;

/** Validates a {parameters, replicas} pair; problems go into `fields` under parameters / replicas. */
export function readOverrides(value: unknown, fields: Record<string, string>): Overrides {
  const source = isRecord(value) ? value : {};
  const parameters = source.parameters ?? {};
  const replicas = source.replicas ?? {};
  if (!isRecord(value)
    || !isRecord(parameters)
    || !Object.entries(parameters).every(([k, v]) => PARAMETER_KEY.test(k) && typeof v === "string" && v.length <= 1000)) {
    fields.parameters = MESSAGES.parameters;
  }
  if (!isRecord(replicas)
    || !Object.entries(replicas).every(([k, v]) => REF.test(k) && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100)) {
    fields.replicas = MESSAGES.replicas;
  }
  return { parameters: parameters as Record<string, string>, replicas: replicas as Record<string, number> };
}
