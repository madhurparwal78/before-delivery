import { z } from "zod";
import { ApiError, validationError } from "./errors.js";

/** Parse untrusted input; every problem becomes one 422 with a message per field. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const named = issue.path.filter((segment, index) => typeof segment === "string" && issue.path.slice(0, index).every((s) => typeof s === "string"));
    const field = named.length > 0 ? named.join(".") : "body";
    fields[field] ??= issue.message;
  }
  throw validationError(fields);
}

/** A trimmed, required text field with a length cap. */
export function text(label: string, max: number): z.ZodString {
  return z
    .string({ error: `${label} is required.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be at most ${max} characters.`);
}

export function wholeNumber(label: string, min: number, max: number): z.ZodNumber {
  return z
    .number({ error: `${label} must be a whole number from ${min} to ${max}.` })
    .int(`${label} must be a whole number from ${min} to ${max}.`)
    .min(min, `${label} must be a whole number from ${min} to ${max}.`)
    .max(max, `${label} must be a whole number from ${min} to ${max}.`);
}

export function parseId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1 || id > 2_147_483_647) throw new ApiError("not_found");
  return id;
}
