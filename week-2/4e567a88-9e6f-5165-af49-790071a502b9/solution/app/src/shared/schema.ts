// A model's published input schema and the one validator both the run form and the API use.

interface StringProperty {
  type: "string";
  title: string;
  description?: string;
  minLength?: number;
  maxLength?: number;
  enum?: string[];
  default?: string;
  contentMediaType?: string;
}

interface IntegerProperty {
  type: "integer";
  title: string;
  description?: string;
  minimum?: number;
  maximum?: number;
  enum?: number[];
  default?: number;
}

export type SchemaProperty = StringProperty | IntegerProperty;

export interface InputSchema {
  type: "object";
  required: string[];
  properties: Record<string, SchemaProperty>;
  additionalProperties: false;
}

type FieldKind = "media" | "select" | "textarea" | "text" | "number";

export function fieldKind(property: SchemaProperty): FieldKind {
  if (property.type === "string" && property.contentMediaType?.startsWith("image/")) return "media";
  if (property.enum) return "select";
  if (property.type === "string") return (property.maxLength ?? 0) > 200 ? "textarea" : "text";
  return "number";
}

/** The words of a run: its prompt, or the script for speech models. */
export function promptOf(input: Readonly<Record<string, string | number>>): string {
  return String(input.prompt ?? input.text ?? "");
}

export const ASSET_REFERENCE = /^asset:(a_\d+)$/;

/** True when the value names an http or https address. */
function isWebAddress(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const count = (n: number): string => n.toLocaleString("en-US");

type Checked = { value: string | number } | { problem: string };

function checkString(property: StringProperty, value: unknown): Checked {
  if (typeof value !== "string") return { problem: "Enter text." };
  const length = [...value].length;
  if (property.enum && !property.enum.includes(value)) return { problem: `Choose one of: ${property.enum.join(", ")}.` };
  if (property.minLength !== undefined && length < property.minLength) {
    return { problem: `Enter at least ${count(property.minLength)} character${property.minLength === 1 ? "" : "s"}.` };
  }
  if (property.maxLength !== undefined && length > property.maxLength) {
    return { problem: `Use at most ${count(property.maxLength)} characters.` };
  }
  if (fieldKind(property) === "media" && !ASSET_REFERENCE.test(value) && !isWebAddress(value)) {
    return { problem: "Enter an image URL or an asset reference asset:<asset id>." };
  }
  return { value };
}

function checkInteger(property: IntegerProperty, value: unknown): Checked {
  if (typeof value !== "number" || !Number.isInteger(value)) return { problem: "Enter a whole number." };
  if (property.enum && !property.enum.includes(value)) return { problem: `Choose one of: ${property.enum.join(", ")}.` };
  const { minimum, maximum } = property;
  if ((minimum !== undefined && value < minimum) || (maximum !== undefined && value > maximum)) {
    return { problem: `Enter a whole number from ${minimum ?? "any"} to ${maximum ?? "any"}.` };
  }
  return { value };
}

interface Validated {
  input: Record<string, string | number>;
  errors: Record<string, string>;
}

/** Validates an input object against the schema; missing optional fields take their default. */
export function validateInput(schema: InputSchema, raw: unknown): Validated {
  const input: Record<string, string | number> = {};
  const errors: Record<string, string> = {};
  const given = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  for (const [name, property] of Object.entries(schema.properties)) {
    const value = given[name];
    if (value === undefined || value === null) {
      if (schema.required.includes(name)) errors[name] = "Required.";
      else if (property.default !== undefined) input[name] = property.default;
      continue;
    }
    const checked = property.type === "string" ? checkString(property, value) : checkInteger(property, value);
    if ("problem" in checked) errors[name] = checked.problem;
    else input[name] = checked.value;
  }
  for (const name of Object.keys(given)) {
    if (!(name in schema.properties)) errors[name] = "This model has no such field.";
  }
  return { input, errors };
}
