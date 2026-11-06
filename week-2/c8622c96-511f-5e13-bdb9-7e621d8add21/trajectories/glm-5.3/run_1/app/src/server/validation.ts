import { ApiError, errors } from "./errors.js";

// Strict request-body checking: every JSON body must be a JSON object holding
// only the listed fields, of the listed types. A refused body changes nothing.
export type FieldType = "string" | "integer" | "number";

export interface FieldSpec {
  type: FieldType;
  required: boolean;
  message: string;
}

export type BodySpec = Record<string, FieldSpec>;

export function parseStrictBody(raw: unknown, spec: BodySpec): { fields: Record<string, unknown>; invalid?: false } | { invalid: true; fields?: Record<string, string> } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { invalid: true, fields: { body: "Send a JSON object" } };
  }
  const fields: Record<string, unknown> = {};
  const problems: Record<string, string> = {};
  const obj = raw as Record<string, unknown>;
  let hasProblem = false;
  for (const key of Object.keys(obj)) {
    if (!(key in spec)) {
      problems[key] = "Unknown field";
      hasProblem = true;
    }
  }
  for (const [key, fieldSpec] of Object.entries(spec)) {
    const value = obj[key];
    if (value === undefined) {
      if (fieldSpec.required) {
        problems[key] = fieldSpec.message;
        hasProblem = true;
      }
      continue;
    }
    if (value === null) {
      problems[key] = fieldSpec.message;
      hasProblem = true;
      continue;
    }
    const typeOk =
      fieldSpec.type === "string" ? typeof value === "string" :
      fieldSpec.type === "integer" ? (typeof value === "number" && Number.isInteger(value)) :
      typeof value === "number";
    if (!typeOk) {
      problems[key] = fieldSpec.message;
      hasProblem = true;
      continue;
    }
    fields[key] = value;
  }
  if (hasProblem) return { invalid: true, fields: problems };
  return { fields };
}

export function bodyProblem(fields: Record<string, string>): ApiError {
  return errors.validationFailed(fields);
}
