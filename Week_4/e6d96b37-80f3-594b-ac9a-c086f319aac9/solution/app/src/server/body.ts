// Typed readers over a parsed request body. A reader returns null when the field is absent or of
// the wrong type, so each command decides how its own fields are refused.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

interface FilePart {
  bytes: Buffer;
}

/** A request body: JSON fields, or multipart text fields plus file parts. */
export interface Body {
  fields: JsonObject;
  files: Record<string, FilePart>;
}

export function text(body: Body, name: string): string | null {
  const value = body.fields[name];
  return typeof value === "string" ? value : null;
}

export function integer(body: Body, name: string): number | null {
  const value = body.fields[name];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export function flag(body: Body, name: string): boolean | null {
  const value = body.fields[name];
  return typeof value === "boolean" ? value : null;
}

export function keys(body: Body, name: string): string[] | null {
  const value = body.fields[name];
  return Array.isArray(value) && value.every((v): v is string => typeof v === "string") ? value : null;
}

export function objects(body: Body, name: string): JsonObject[] | null {
  const value = body.fields[name];
  return Array.isArray(value) && value.every((v): v is JsonObject => v !== null && typeof v === "object" && !Array.isArray(v))
    ? value
    : null;
}

export function commandIdOf(body: Body): string | null {
  const id = text(body, "command_id");
  return id !== null && id.length >= 1 && id.length <= 64 ? id : null;
}
