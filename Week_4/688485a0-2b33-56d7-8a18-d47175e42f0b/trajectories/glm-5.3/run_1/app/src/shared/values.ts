/**
 * Document values. A value is JSON with dates written as {"$date":"..."}.
 * The single definition of value types, canonical number text and compact JSON.
 */

export type JsonLeaf = string | number | boolean | null;
export type JsonValue = JsonLeaf | JsonObj | JsonValue[];
export interface JsonObj { [key: string]: JsonValue }
export type Document = JsonObj;

export const DATE_KEY = "$date";
export const DATE_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$|^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface DateObj { "$date": string }
export function isDateValue(v: JsonValue): v is JsonObj & { "$date": string } {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return keys.length === 1 && keys[0] === DATE_KEY && typeof v[DATE_KEY] === "string";
}

/** A field is a date when it is exactly {"$date":"YYYY-MM-DDTHH:MM:SSZ"} (optionally with milliseconds). */
export function isDateObject(v: JsonValue): v is JsonObj & { "$date": string } {
  return isDateValue(v) && DATE_RE.test(v[DATE_KEY]);
}

/** The text of a date value (caller checks isDateObject first). */
export function dateText(v: JsonObj): string {
  return v[DATE_KEY] as string;
}

export function dateMs(v: JsonObj & { "$date": string }): number {
  return Date.parse(v[DATE_KEY]);
}

export type TypeName = "string" | "number" | "boolean" | "null" | "object" | "array" | "date";
export function typeName(v: JsonValue): TypeName {
  if (isDateObject(v)) return "date";
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  switch (typeof v) {
    case "string": return "string";
    case "number": return "number";
    case "boolean": return "boolean";
    default: return "object";
  }
}

/** Comparison order: null/missing < numbers < strings < objects < arrays < booleans < dates. */
export const TYPE_ORDER: Record<TypeName, number> = {
  null: 0, number: 1, string: 2, object: 3, array: 4, boolean: 5, date: 6,
};

/** Shortest JSON text that reads back as the same double value (number-text rule). */
export function numberText(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return String(n);
  if (!Number.isFinite(n)) return n > 0 ? "1e999" : "-1e999";
  const start = JSON.stringify(n);
  if (JSON.parse(start) === n) {
    if (!/e/i.test(start)) return start;
    // expand exponent form to the shortest plain form that round-trips
    for (let p = 0; p <= 20; p++) {
      const t = n.toFixed(p);
      if (Number(t) === n) return t;
    }
  }
  return start;
}

/**
 * Compact JSON with numbers under the number-text rule and non-ASCII written raw.
 * Field order is preserved.
 */
export function compactJson(v: JsonValue): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "number": return numberText(v);
    case "string": return JSON.stringify(v);
    case "boolean": return v ? "true" : "false";
    default:
      if (Array.isArray(v)) return "[" + v.map(compactJson).join(",") + "]";
      return "{" + Object.keys(v).map(k => JSON.stringify(k) + ":" + compactJson(v[k])).join(",") + "}";
  }
}

/** Size in UTF-8 bytes of the document's compact JSON. */
export function docByteSize(doc: Document): number {
  const s = compactJson(doc);
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdbff ? (i++, 4) : 3;
  }
  return bytes;
}

/** Document depth: the root is 1, each nested object or array adds 1. Dates are plain values. */
export function docDepth(v: JsonValue, d: number): number {
  if (d > 100) return d;
  if (isDateObject(v) || v === null) return d;
  if (Array.isArray(v)) {
    let m = d;
    for (const el of v) m = Math.max(m, docDepth(el, d + 1));
    return m;
  }
  if (typeof v === "object") {
    let m = d;
    for (const k in v) m = Math.max(m, docDepth(v[k], d + 1));
    return m;
  }
  return d;
}

/** Pretty JSON for the editor: two-space indents, numbers and dates exact. */
export function prettyJson(v: JsonValue, indent = 0): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "number": return numberText(v);
    case "string": return JSON.stringify(v);
    case "boolean": return v ? "true" : "false";
    default:
      if (Array.isArray(v)) {
        if (v.length === 0) return "[]";
        const pad = "  ".repeat(indent + 1);
        return "[\n" + v.map(e => pad + prettyJson(e, indent + 1)).join(",\n") + "\n" + "  ".repeat(indent) + "]";
      }
      const keys = Object.keys(v);
      if (keys.length === 0) return "{}";
      const pad = "  ".repeat(indent + 1);
      return "{\n" + keys.map(k => pad + JSON.stringify(k) + ": " + prettyJson(v[k], indent + 1)).join(",\n") + "\n" + "  ".repeat(indent) + "}";
  }
}

/**
 * The JSON text of the results view and stage previews (DP-15): numbers under
 * the display rule, dates as their {"$date":"..."} form, two-space indents.
 */
export function displayJson(v: JsonValue, indent = 0): string {
  if (isDateObject(v)) {
    return "{" + JSON.stringify("$date") + ": " + JSON.stringify(v["$date"]) + "}";
  }
  if (v === null) return "null";
  switch (typeof v) {
    case "number": return displayNumber(v);
    case "string": return JSON.stringify(v);
    case "boolean": return v ? "true" : "false";
    default: {
      if (Array.isArray(v)) {
        if (v.length === 0) return "[]";
        const pad = "  ".repeat(indent + 1);
        return "[\n" + v.map(e => pad + displayJson(e, indent + 1)).join(",\n") + "\n" + "  ".repeat(indent) + "]";
      }
      const keys = Object.keys(v);
      if (keys.length === 0) return "{}";
      const pad = "  ".repeat(indent + 1);
      return "{\n" + keys.map(k => pad + JSON.stringify(k) + ": " + displayJson(v[k], indent + 1)).join(",\n") + "\n" + "  ".repeat(indent) + "}";
    }
  }
}

/**
 * The number display rule (DP-15): whole numbers without a decimal point,
 * others rounded half away from zero to 6 significant digits, trailing zeros
 * removed, plain decimal notation.
 */
export function displayNumber(n: number): string {
  if (n === 0) return "0";
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const neg = n < 0;
  const abs = Math.abs(n);
  // round to 6 significant digits, half away from zero
  const exp = Math.floor(Math.log10(abs));
  let rounded: number;
  if (exp <= 5) {
    rounded = roundHalfAwayFromZero(abs, 5 - exp);
  } else {
    const q = Math.pow(10, exp - 5);
    rounded = Math.round(abs / q) * q;
  }
  if (rounded === 0) return "0";
  // plain decimal notation, trailing zeros removed
  const rexp = Math.floor(Math.log10(rounded));
  const decimals = Math.max(0, 5 - rexp);
  let t = rounded.toFixed(decimals);
  if (t.includes(".")) t = t.replace(/0+$/, "").replace(/\.$/, "");
  return (neg ? "-" : "") + t;
}

/** Half away from zero to `digits` decimal places. */
export function roundHalfAwayFromZero(x: number, digits: number): number {
  const f = Math.pow(10, digits);
  const scaled = x * f;
  const r = Math.sign(scaled) * Math.round(Math.abs(scaled) * (1 + Number.EPSILON * 4)) / f;
  return Object.is(r, -0) ? 0 : r;
}

/** Display form of any value for list/table cells (DP-15). */
export function displayValue(v: JsonValue): string {
  const t = typeName(v);
  if (t === "date" && isDateObject(v)) return v["$date"];
  if (t === "string" && typeof v === "string") return v;
  if (t === "object" || t === "array") return displayCompact(v);
  if (t === "number" && typeof v === "number") return displayNumber(v);
  return compactJson(v);
}

function displayCompact(v: JsonValue): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "number": return displayNumber(v);
    case "string": return JSON.stringify(v);
    case "boolean": return v ? "true" : "false";
    default:
      if (Array.isArray(v)) return "[" + v.map(displayCompact).join(",") + "]";
      return "{" + Object.keys(v).map(k => JSON.stringify(k) + ":" + displayCompact(v[k])).join(",") + "}";
  }
}

/** The one comparison order (DP-09) for sort, $min/$max and group output order. */
export function compareValues(a: JsonValue, b: JsonValue): number {
  const ta = TYPE_ORDER[typeName(a)];
  const tb = TYPE_ORDER[typeName(b)];
  if (ta !== tb) return ta - tb;
  switch (typeName(a)) {
    case "number": return a === b ? 0 : (a as number) < (b as number) ? -1 : 1;
    case "string": return a === b ? 0 : (a as string) < (b as string) ? -1 : 1;
    case "boolean": return (a ? 1 : 0) - (b ? 1 : 0);
    case "date": return dateMs(a as JsonObj & { "$date": string }) - dateMs(b as JsonObj & { "$date": string });
    case "object": case "array": {
      const sa = compactJson(a), sb = compactJson(b);
      return sa === sb ? 0 : sa < sb ? -1 : 1;
    }
    default: return 0; // null == null
  }
}
