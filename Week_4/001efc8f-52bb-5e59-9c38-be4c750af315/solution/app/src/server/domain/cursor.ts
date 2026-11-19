import { FIELD, invalid } from "../errors.js";

// Adapted from kit/modules/cursor: an opaque base64url JSON array marking the last item returned.
export function encodeCursor(values: string[]): string {
  return Buffer.from(JSON.stringify(values)).toString("base64url");
}

function decodeCursor(raw: string | null, length: number): string[] | null {
  if (raw === null) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error("alphabet");
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (Array.isArray(parsed) && parsed.length === length && parsed.every((v) => typeof v === "string")) {
      return parsed as string[];
    }
  } catch {
    // fall through to the refusal
  }
  throw invalid({ before: FIELD.before });
}

export type PageParams = { limit: number; before: string | null };

export function pageParams(url: URL): PageParams {
  const raw = url.searchParams.get("limit");
  let limit = 30;
  if (raw !== null) {
    if (!/^\d+$/.test(raw) || Number(raw) < 1) throw invalid({ limit: FIELD.limit });
    limit = Math.min(Number(raw), 100);
  }
  return { limit, before: url.searchParams.get("before") };
}

function isInstant(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

export function instantCursor(raw: string | null, length: number): string[] | null {
  const values = decodeCursor(raw, length);
  if (values && !isInstant(values[0] ?? "")) throw invalid({ before: FIELD.before });
  return values;
}
