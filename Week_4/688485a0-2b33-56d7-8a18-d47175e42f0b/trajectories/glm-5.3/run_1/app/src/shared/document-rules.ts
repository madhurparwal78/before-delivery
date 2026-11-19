import { Document, JsonValue, isDateObject, compactJson, docByteSize, docDepth } from "./values.js";
import { Limits } from "./config.js";

/**
 * Document rules (DP-05): _id format, allowed values, field names, the size
 * limit and the depth limit, checked in the published order.
 */

const ID_RE = /^[0-9a-f]{24}$/;

/** First invalid field name in document order: a key starting with `$` (other than a date) or containing `.`. */
function firstBadField(v: JsonValue, prefix: string): string | null {
  if (Array.isArray(v)) {
    for (const el of v) {
      const bad = firstBadField(el, prefix);
      if (bad) return bad;
    }
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  if (isDateObject(v)) return null; // a date is a plain value
  for (const k of Object.keys(v)) {
    const path = prefix ? prefix + "." + k : k;
    if (k.startsWith("$") || k.includes(".")) return path;
    const bad = firstBadField(v[k], path);
    if (bad) return bad;
  }
  return null;
}

export type DocCheck =
  | { ok: true; doc: Document; id: string }
  | { ok: false; message: string; path?: string };

/**
 * Check a document in the published order: _id, field names, size, depth.
 * `givenId` is the id the document must carry when present (PUT route).
 */
export function checkDocument(doc: unknown, limits: Limits, givenId: string | undefined): DocCheck {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return { ok: false, message: "not an object" };
  const obj = doc as Document;
  // _id first
  if (Object.prototype.hasOwnProperty.call(obj, "_id")) {
    const id = obj["_id"];
    if (typeof id !== "string" || !ID_RE.test(id)) return { ok: false, message: "invalid _id" };
    if (givenId !== undefined && id !== givenId) return { ok: false, message: "id mismatch", path: "_id" };
  } else if (givenId !== undefined) {
    return { ok: false, message: "invalid _id" };
  }
  // field names
  const badPath = firstBadField(obj as JsonValue, "");
  if (badPath) return { ok: false, message: "invalid field name at " + badPath, path: badPath };
  // size
  const size = docByteSize(obj);
  if (size > limits.maxDocBytes) return { ok: false, message: `document is larger than ${limits.maxDocBytes} bytes` };
  // depth
  if (docDepth(obj as JsonValue, 1) > limits.maxDepth) return { ok: false, message: `document is nested deeper than ${limits.maxDepth} levels` };
  const id = Object.prototype.hasOwnProperty.call(obj, "_id") ? (obj["_id"] as string) : "";
  return { ok: true, doc: obj, id };
}

/** A fresh 24-hex id. */
export function newId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

export function documentCompactText(doc: Document): string {
  return compactJson(doc);
}
