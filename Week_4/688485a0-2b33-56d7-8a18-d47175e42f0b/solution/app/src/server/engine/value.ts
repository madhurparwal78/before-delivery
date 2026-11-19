import type { JsonObject, JsonValue } from "../../shared/json.js";
import { isObject } from "../../shared/json.js";

/** Types, equality and the comparison order: the one place that decides how values relate. */

type ValueType = "null" | "number" | "string" | "object" | "array" | "boolean" | "date";

const DATE_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

export function dateInstant(text: string): number | null {
  if (!DATE_TEXT.test(text)) return null;
  const instant = Date.parse(text);
  if (Number.isNaN(instant)) return null;
  return new Date(instant).toISOString().slice(0, 19) === text.slice(0, 19) ? instant : null;
}

/** The instant of a `{"$date":"..."}` value, or null when the value is not a date. */
export function dateOf(value: JsonValue | undefined): number | null {
  if (!isObject(value)) return null;
  const text = value["$date"];
  return Object.keys(value).length === 1 && typeof text === "string" ? dateInstant(text) : null;
}

export function typeOf(value: JsonValue | undefined): ValueType {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return dateOf(value) !== null ? "date" : "object";
  return typeof value as "number" | "string" | "boolean";
}

const RANK: Record<ValueType, number> = { null: 0, number: 1, string: 2, object: 3, array: 4, boolean: 5, date: 6 };

export function compact(value: JsonValue): string {
  return JSON.stringify(value);
}

export function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Comparison order: null and missing < numbers < strings < objects < arrays < booleans < dates. */
export function compareValues(a: JsonValue | undefined, b: JsonValue | undefined): number {
  const typeA = typeOf(a);
  const typeB = typeOf(b);
  if (typeA !== typeB) return RANK[typeA] - RANK[typeB];
  switch (typeA) {
    case "null":
      return 0;
    case "number":
      return (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
    case "string":
      return byCodeUnit(a as string, b as string);
    case "boolean":
      return Number(a) - Number(b);
    case "date":
      return Math.sign((dateOf(a) ?? 0) - (dateOf(b) ?? 0));
    default:
      return byCodeUnit(compact(a as JsonValue), compact(b as JsonValue));
  }
}

/** Filter equality: numbers by value, dates by instant, objects and arrays by compact text. */
export function valuesEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  const typeA = typeOf(a);
  if (typeA !== typeOf(b)) return false;
  if (typeA === "object" || typeA === "array") return compact(a as JsonValue) === compact(b as JsonValue);
  return compareValues(a, b) === 0;
}

export function sameClass(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  const typeA = typeOf(a);
  return typeA === typeOf(b) && (typeA === "number" || typeA === "string" || typeA === "date");
}

/** Document depth: the document is level 1, each nested object or array adds 1, a date is a plain value. */
export function depthOf(value: JsonValue): number {
  if (typeof value !== "object" || value === null || dateOf(value) !== null) return 0;
  const children = Array.isArray(value) ? value : Object.values(value);
  let deepest = 0;
  for (const child of children) deepest = Math.max(deepest, depthOf(child));
  return 1 + deepest;
}

export function isPlainObject(value: JsonValue | undefined): value is JsonObject {
  return isObject(value) && dateOf(value) === null;
}

export function isWholeNumber(value: JsonValue | undefined, minimum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum;
}

/** The text a value has inside an index key: dates are normalised so equal instants collide. */
export function keyText(value: JsonValue | undefined): string {
  const instant = dateOf(value);
  return instant === null ? compact(value ?? null) : compact({ $date: new Date(instant).toISOString() });
}
