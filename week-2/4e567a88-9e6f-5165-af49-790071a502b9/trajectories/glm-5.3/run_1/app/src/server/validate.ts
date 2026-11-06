// Input validation against a model's published input schema: one message per offending field.
import type { ModelDef } from "../shared/models.js";

export interface FieldError {
  path: string;
  message: string;
}

const MAX_UPLOAD_BYTES = 10_000_000;

export function validateInput(model: ModelDef, input: unknown): FieldError[] {
  const errors: FieldError[] = [];
  const obj: Record<string, unknown> =
    input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  for (const field of model.fields) {
    const value = obj[field.name];
    const missing = value === undefined || value === null || value === "";
    if (missing) {
      if (field.required) errors.push({ path: `input.${field.name}`, message: "Required." });
      continue;
    }
    switch (field.type) {
      case "string": {
        if (typeof value !== "string") {
          errors.push({ path: `input.${field.name}`, message: "Enter text." });
          break;
        }
        const len = [...value].length;
        if (field.min_length !== undefined && len < field.min_length) {
          errors.push({ path: `input.${field.name}`, message: "Required." });
        } else if (field.max_length !== undefined && len > field.max_length) {
          errors.push({ path: `input.${field.name}`, message: `Use at most ${field.max_length} characters.` });
        }
        break;
      }
      case "enum": {
        const ok = field.enum?.some((e) => String(e) === String(value));
        if (!ok) errors.push({ path: `input.${field.name}`, message: `Choose one of the listed values.` });
        break;
      }
      case "integer": {
        if (typeof value !== "number" || !Number.isInteger(value)) {
          errors.push({ path: `input.${field.name}`, message: "Enter a whole number." });
          break;
        }
        if (field.minimum !== undefined && value < field.minimum) {
          errors.push({ path: `input.${field.name}`, message: `Enter at least ${field.minimum}.` });
        } else if (field.maximum !== undefined && value > field.maximum) {
          errors.push({ path: `input.${field.name}`, message: `Enter at most ${field.maximum}.` });
        }
        break;
      }
      case "media": {
        if (typeof value !== "string" || value === "") {
          errors.push({ path: `input.${field.name}`, message: "Enter an image URL or an asset reference." });
        }
        break;
      }
    }
  }
  return errors;
}

export { MAX_UPLOAD_BYTES };

/** The default input object for a model, used when a field is omitted. */
export function defaultInput(model: ModelDef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of model.fields) {
    out[f.name] = f.default;
  }
  return out;
}

/** Merge user input over defaults, dropping unknown fields. */
export function effectiveInput(model: ModelDef, input: Record<string, unknown>): Record<string, unknown> {
  const out = defaultInput(model);
  for (const f of model.fields) {
    if (input[f.name] !== undefined && input[f.name] !== null) out[f.name] = input[f.name];
    else if (f.default === null && input[f.name] === undefined) out[f.name] = null;
  }
  return out;
}
