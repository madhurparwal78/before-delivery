import { JsonObj, JsonValue, typeName, isDateObject } from "../values.js";
import { fail } from "../errors.js";

/**
 * Validators (DP-41, DP-42): required fields and per-path rules with the
 * published check order.
 */

export interface PropertyRule {
  bsonType?: string;
  minimum?: number;
  maximum?: number;
  enumValues?: JsonValue[];
}
export interface ValidatorSpec {
  required: string[];
  properties: { path: string; rule: PropertyRule }[];
}

const BSON_TYPES = new Set(["string", "number", "int", "boolean", "null", "object", "array", "date"]);

/** Parses a validator, refusing anything else with invalid_validator. */
export function parseValidator(raw: unknown): ValidatorSpec | null {
  if (raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) fail("invalid_validator", 422);
  const obj = raw as JsonObj;
  const spec: ValidatorSpec = { required: [], properties: [] };
  for (const key of Object.keys(obj)) {
    if (key === "required") {
      const v = obj[key];
      if (!Array.isArray(v) || v.some(x => typeof x !== "string")) fail("invalid_validator", 422);
      spec.required = v as string[];
    } else if (key === "properties") {
      const v = obj[key];
      if (typeof v !== "object" || v === null || Array.isArray(v)) fail("invalid_validator", 422);
      const props = v as JsonObj;
      for (const path of Object.keys(props)) {
        const rule = props[path];
        if (typeof rule !== "object" || rule === null || Array.isArray(rule)) fail("invalid_validator", 422);
        const parsed: PropertyRule = {};
        for (const rk of Object.keys(rule as JsonObj)) {
          const rv = (rule as JsonObj)[rk];
          switch (rk) {
            case "bsonType":
              if (typeof rv !== "string" || !BSON_TYPES.has(rv)) fail("invalid_validator", 422);
              parsed.bsonType = rv;
              break;
            case "minimum": case "maximum":
              if (typeof rv !== "number" || Number.isNaN(rv)) fail("invalid_validator", 422);
              parsed[rk] = rv;
              break;
            case "enum":
              if (!Array.isArray(rv)) fail("invalid_validator", 422);
              parsed.enumValues = rv as JsonValue[];
              break;
            default:
              fail("invalid_validator", 422);
          }
        }
        spec.properties.push({ path, rule: parsed });
      }
    } else {
      fail("invalid_validator", 422);
    }
  }
  return spec;
}

/** The one value at a path present in the document, for validation. */
function valueAt(doc: JsonObj, parts: string[]): { present: boolean; value: JsonValue } {
  let cur: JsonValue = doc;
  for (const p of parts) {
    if (typeof cur !== "object" || cur === null || Array.isArray(cur) || isDateObject(cur)) {
      return { present: false, value: null };
    }
    if (!Object.prototype.hasOwnProperty.call(cur, p)) return { present: false, value: null };
    cur = cur[p];
  }
  return { present: true, value: cur };
}

const SCALAR_TYPE_NAMES = new Set(["string", "number", "boolean", "null", "object", "array"]);

function typeMatches(v: JsonValue, bsonType: string): boolean {
  switch (bsonType) {
    case "int": return typeof v === "number" && Number.isInteger(v);
    case "date": return isDateObject(v);
    default: return SCALAR_TYPE_NAMES.has(bsonType) && typeName(v) === bsonType;
  }
}

/**
 * The first failing rule in the published check order: required paths in listed
 * order, then properties by path ascending, and within a property bsonType,
 * minimum, maximum, enum.
 */
export function validateDocument(doc: JsonObj, spec: ValidatorSpec): { path: string; rule: string; expected?: string } | null {
  for (const path of spec.required) {
    const { present } = valueAt(doc, path.split("."));
    if (!present) return { path, rule: "required" };
  }
  const sorted = [...spec.properties].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const { path, rule } of sorted) {
    const { present, value } = valueAt(doc, path.split("."));
    if (!present) continue; // property rules apply only where the path is present
    if (rule.bsonType !== undefined && !typeMatches(value, rule.bsonType)) {
      return { path, rule: "bsonType", expected: rule.bsonType };
    }
    if (rule.minimum !== undefined && typeof value === "number" && value < rule.minimum) {
      return { path, rule: "minimum", expected: numberTextFor(rule.minimum) };
    }
    if (rule.maximum !== undefined && typeof value === "number" && value > rule.maximum) {
      return { path, rule: "maximum", expected: numberTextFor(rule.maximum) };
    }
    if (rule.enumValues !== undefined && !rule.enumValues.some(x => enumEq(x, value))) {
      return { path, rule: "enum", expected: compactList(rule.enumValues) };
    }
  }
  return null;
}

function numberTextFor(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n);
}

function compactList(values: JsonValue[]): string {
  return values.map(v => JSON.stringify(v)).join(",");
}

function enumEq(a: JsonValue, b: JsonValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
