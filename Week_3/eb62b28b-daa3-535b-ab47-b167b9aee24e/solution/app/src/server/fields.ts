// Reading fields from a checked JSON body, without casts.

export type JsonBody = Record<string, unknown>;

export function text(body: JsonBody, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

export function nullableText(body: JsonBody, key: string): string | null {
  const value = body[key];
  return typeof value === "string" && value !== "" ? value : null;
}

export function isRecord(value: unknown): value is JsonBody {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function records(value: unknown): JsonBody[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function isOneOf<T extends string>(options: readonly T[], value: unknown): value is T {
  return options.some((option) => option === value);
}
