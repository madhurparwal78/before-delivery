import type { FieldType, Filter } from "./types";

/** Round half away from zero to `d` decimals. */
export function roundHalfAway(v: number, d: number): number {
  if (!Number.isFinite(v)) return v;
  const p = Math.pow(10, d);
  const scaled = v * p;
  // Correct float error only when it is on the order of one ulp of the scaled value.
  const corrected = Math.abs(scaled) < 1e15 ? Number(scaled.toFixed(6)) : scaled;
  const r = corrected < 0 ? -Math.floor(-corrected + 0.5) : Math.floor(corrected + 0.5);
  return r / p;
}

/** Format with exactly `d` decimals, half away from zero (no trailing-zero stripping). */
export function fmtFixedExact(v: number, d: number): string {
  const r = roundHalfAway(v, d);
  let s = r.toFixed(d);
  if (s === "-0" + (d > 0 ? "." + "0".repeat(d) : "")) s = "0" + (d > 0 ? "." + "0".repeat(d) : "");
  return s;
}

export function fmtFixed(v: number, d: number): string {
  const r = roundHalfAway(v, d);
  let s = r.toFixed(d);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  if (s === "-0") s = "0";
  return s;
}

/** Flatten nested objects into dotted paths. Arrays are kept as multi-value fields. */
export function flatten(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (obj: Record<string, unknown>, prefix: string): void => {
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      const path = prefix ? `${prefix}.${key}` : key;
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        walk(v as Record<string, unknown>, path);
      } else {
        out[path] = v;
      }
    }
  };
  walk(value, "");
  return out;
}

export function valuesOf(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return v === undefined || v === null ? [] : [v];
}

/** The type of one JSON value under rule A. */
export function inferType(value: unknown): FieldType | null {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") {
    if (isIsoDate(value)) return "date";
    return "text";
  }
  return null;
}

const ISO_RE =
  /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:?\d{2})$/;

export function isIsoDate(v: string): boolean {
  if (!ISO_RE.test(v)) return false;
  const d = new Date(v);
  return !isNaN(d.getTime());
}

/** Does a value fit a field type (rule A)? */
export function valueFitsType(value: unknown, type: FieldType): boolean {
  if (Array.isArray(value)) {
    if (value.length === 0) return true;
    return value.every((x) => valueFitsType(x, type));
  }
  if (value === null || value === undefined) return true;
  if (type === "number") return typeof value === "number";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "date") return typeof value === "string" && isIsoDate(value);
  if (type === "text") return typeof value === "string";
  if (type === "keyword") return typeof value === "string";
  return false;
}

export function filterMatches(value: unknown, op: string, target: unknown): boolean {
  const vals = valuesOf(value);
  if (op === "exists") return vals.length > 0 && vals.some((v) => v !== null && v !== undefined);
  if (vals.length === 0) return false;
  if (op === "eq") return vals.some((v) => compareJson(v, target) === 0);
  if (op === "ne") return !vals.some((v) => compareJson(v, target) === 0);
  const nums = vals.filter((v): v is number => typeof v === "number");
  const targetNum = typeof target === "number" ? target : Number(target);
  if (nums.length === 0 || typeof targetNum !== "number" || isNaN(targetNum)) return false;
  switch (op) {
    case "gt":
      return nums.some((v) => v > targetNum);
    case "gte":
      return nums.some((v) => v >= targetNum);
    case "lt":
      return nums.some((v) => v < targetNum);
    case "lte":
      return nums.some((v) => v <= targetNum);
  }
  return false;
}

export function compareJson(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}
