export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseJsonObject(raw: string): JsonObject | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isJsonObject(parsed) ? parsed : null;
}

export function readString(body: JsonObject, field: string): string | undefined {
  const value = body[field];
  return typeof value === 'string' ? value : undefined;
}

export function readInteger(body: JsonObject, field: string): number | undefined {
  const value = body[field];
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

export function readBoolean(body: JsonObject, field: string): boolean | undefined {
  const value = body[field];
  return typeof value === 'boolean' ? value : undefined;
}
