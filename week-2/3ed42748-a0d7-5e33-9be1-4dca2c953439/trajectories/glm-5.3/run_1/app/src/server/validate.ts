import type { FieldReason } from "./errors.js";

export const MAX_JSON_BYTES = 16384;
export const MAX_PNG_BYTES = 2_000_000;

/** Position published keys. */
const POS_KEYS = ["lat", "lon"] as const;
const PRESENCE_KEYS = ["lat", "lon", "heading_deg"] as const;

/** Depth-limited safe JSON parse; returns the parsed value or a marker for body problems. */
export type ParsedBody = { ok: true; value: unknown } | { ok: false; fields: Record<string, FieldReason> };

export function parseJsonBody(text: string): ParsedBody {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, fields: { body: "invalid" } };
  }
  if (value !== null && typeof value === "object" && depth(value) > 32) {
    return { ok: false, fields: { body: "invalid" } };
  }
  return { ok: true, value };
}

function depth(v: unknown, d = 0): number {
  if (d > 40 || v === null || typeof v !== "object") return d;
  const obj = v as Record<string, unknown>;
  let max = d + 1;
  for (const k of Object.keys(obj)) max = Math.max(max, depth(obj[k], d + 1));
  return max;
}

/**
 * Walks the whole body collecting unknown keys (dotted paths) before any field validation.
 * Published-key schemas describe exactly the keys an endpoint accepts, at every depth.
 */
export function findUnknownKeys(value: unknown, published: Record<string, unknown> | object, prefix = ""): Record<string, FieldReason> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, FieldReason> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (!(key in published)) {
      out[prefix + key] = "unknown_field";
      continue;
    }
    const sub = (published as Record<string, unknown>)[key];
    if (sub !== null && typeof sub === "object" && !Array.isArray(sub)) {
      Object.assign(out, findUnknownKeys((value as Record<string, unknown>)[key], sub, prefix + key + "."));
    }
  }
  return out;
}

export type Position = { lat: number; lon: number };

/**
 * Field validation for a `{"lat","lon"}` or `{"lat","lon","heading_deg"}` position, by dotted path.
 * `required` keys must be present; numbers must be finite and within range.
 */
export function validatePosition(
  body: Record<string, unknown>,
  path: string,
  keys: readonly string[],
  withHeading: boolean,
): { fields: Record<string, FieldReason>; value: Position & { heading_deg?: number } } {
  const fields: Record<string, FieldReason> = {};
  const value: Position & { heading_deg?: number } = { lat: 0, lon: 0 };
  const container = path ? (body[path] as unknown) : body;
  if (path && (container === undefined || container === null)) {
    return { fields: { [path]: "required" }, value };
  }
  if (path && typeof container !== "object") {
    return { fields: { [path]: "invalid" }, value };
  }
  const src = (container ?? {}) as Record<string, unknown>;
  for (const key of keys) {
    const dotted = path ? `${path}.${key}` : key;
    const v = src[key];
    if (v === undefined) {
      fields[dotted] = "required";
    } else if (typeof v !== "number" || !Number.isFinite(v)) {
      fields[dotted] = "invalid";
    } else if (key === "lat" && (v < -90 || v > 90)) {
      fields[dotted] = "out_of_range";
    } else if (key === "lon" && (v < -180 || v > 180)) {
      fields[dotted] = "out_of_range";
    } else if (key === "heading_deg" && (v < 0 || v >= 360)) {
      fields[dotted] = "out_of_range";
    } else {
      if (key === "lat") value.lat = v;
      if (key === "lon") value.lon = v;
      if (key === "heading_deg" && withHeading) value.heading_deg = v;
    }
  }
  return { fields, value };
}

export const positionSchema = Object.fromEntries(POS_KEYS.map((k) => [k, null]));
export const presenceSchema = Object.fromEntries(PRESENCE_KEYS.map((k) => [k, null]));

/** Streams: 8 to 64 chars of A-Z a-z 0-9 _ -. */
export function validStream(s: unknown): boolean {
  return typeof s === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(s);
}

/** Ticket header value: 8 to 64 characters from A–Z, a–z, 0–9, `_` and `-`. */
export function validTicket(s: string | undefined): boolean {
  return typeof s === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(s);
}

export function validateEmailField(v: unknown, field: string, maxLen: number): FieldReason | null {
  if (typeof v !== "string" || !/^[^\s@,;:<>()\[\]"\\]+@[^\s@,;:<>()\[\]"\\]+\.[^\s@,;:<>()\[\]"\\]+$/.test(v)) return "invalid";
  if (v.length > maxLen) return "too_long";
  return null;
}

// ---------------------------------------------------------------------------
// Display names: lone surrogates, folding, trimming, NFC and code-point counting.

function isFoldCodePoint(cp: number): boolean {
  // Cc (0x00-0x1f, 0x7f-0x9f), Zl, Zp, White_Space, and the direction controls.
  if ((cp >= 0x00 && cp <= 0x1f) || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f)) return true;
  if (cp === 0x20 || cp === 0xa0 || cp === 0x1680) return true;
  if (cp >= 0x2000 && cp <= 0x200a) return true;
  if (cp === 0x2028 || cp === 0x2029 || cp === 0x202f || cp === 0x205f || cp === 0x3000) return true;
  if (cp === 0x200e || cp === 0x200f) return true;
  if (cp >= 0x202a && cp <= 0x202e) return true;
  if (cp >= 0x2066 && cp <= 0x2069) return true;
  return false;
}

export function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1);
      if (!(n >= 0xdc00 && n <= 0xdfff)) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** Fold → trim → NFC. The one implementation of display-name shaping. */
export function shapeDisplayName(raw: string): string {
  let out = "";
  let pendingFold = false;
  for (const ch of raw) {
    const cp = ch.codePointAt(0)!;
    if (isFoldCodePoint(cp)) {
      pendingFold = true;
    } else {
      if (pendingFold) {
        out += " ";
        pendingFold = false;
      }
      out += ch;
    }
  }
  let shaped = out.replace(/ +/g, " ").trim();
  shaped = shaped.normalize("NFC");
  return shaped;
}

export function countCodePoints(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export function checkDisplayName(v: unknown): { fields: Record<string, FieldReason>; value: string | null } {
  if (typeof v !== "string" || hasLoneSurrogate(v)) return { fields: { display_name: "invalid" }, value: null };
  const shaped = shapeDisplayName(v);
  if (countCodePoints(shaped) === 0) return { fields: { display_name: "required" }, value: null };
  if (countCodePoints(shaped) > 24) return { fields: { display_name: "too_long" }, value: null };
  return { fields: {}, value: shaped };
}

// ---------------------------------------------------------------------------
// Return paths accepted for postbox keys (exact, character for character).

export function isValidReturnTo(v: unknown): boolean {
  if (typeof v !== "string") return false;
  if (v === "/" || v === "/console" || v === "/console?mission=new") return true;
  const m = /^\/console\?mission=([a-z0-9-]{1,64})$/.exec(v);
  return m !== null;
}
