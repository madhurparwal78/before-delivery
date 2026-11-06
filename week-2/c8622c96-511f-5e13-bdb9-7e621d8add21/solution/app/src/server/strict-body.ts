// Strict request bodies: the one place unknown, missing, null and mistyped fields are judged.
import { UNPARSEABLE, validationFailed } from "./http.js";

export const WRONG_TYPE = "This field is missing or has the wrong type";

type Kind = "string" | "integer" | "array" | "value";

interface FieldRule {
  kind: Kind;
  /** The field's own published message when it is missing, null or of the wrong type. */
  message: string;
  optional?: boolean;
}

export type BodyRules = Record<string, FieldRule>;

const matches = (kind: Kind, value: unknown): boolean => {
  switch (kind) {
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "array":
      return Array.isArray(value);
    case "value":
      return true;
  }
};

/** Field errors collected while judging one body; `fail()` throws the 422 when any exist. */
export class FieldErrors {
  readonly fields: Record<string, string> = {};

  add(field: string, message: string): void {
    if (!(field in this.fields)) this.fields[field] = message;
  }

  has(field: string): boolean {
    return field in this.fields;
  }

  fail(): void {
    if (Object.keys(this.fields).length) throw validationFailed(this.fields);
  }
}

/**
 * Checks a JSON body against its endpoint's listed fields. Returns the well-typed values and the errors so
 * far; callers add their own range checks and then call `errors.fail()`. With `partial`, every field is optional.
 */
export function strictBody(body: unknown, rules: BodyRules, partial = false):
  { values: Record<string, unknown>; errors: FieldErrors } {
  if (body === UNPARSEABLE || typeof body !== "object" || body === null || Array.isArray(body)) {
    throw validationFailed({ body: "Send a JSON object" });
  }
  const errors = new FieldErrors();
  const values: Record<string, unknown> = {};
  const given = body as Record<string, unknown>;
  for (const key of Object.keys(given)) {
    if (!(key in rules)) errors.add(key, "Unknown field");
  }
  for (const [key, rule] of Object.entries(rules)) {
    if (!(key in given)) {
      if (!partial && !rule.optional) errors.add(key, rule.message);
      continue;
    }
    const value = given[key];
    if (value === null || !matches(rule.kind, value)) errors.add(key, rule.message);
    else values[key] = value;
  }
  return { values, errors };
}

/** Bodies that list no fields must be exactly `{}`. */
export function emptyBody(body: unknown): void {
  strictBody(body, {}).errors.fail();
}
