import type { JsonObject, JsonValue } from "../../shared/json.js";
import { fail } from "../errors.js";
import { objectPathValue } from "./path.js";
import { byCodeUnit, isPlainObject, typeOf, valuesEqual } from "./value.js";

/** Validation rules: required fields and per-path type, minimum, maximum and enum. */

type ValidationRule = "required" | "bsonType" | "minimum" | "maximum" | "enum";

const BSON_TYPES = ["string", "number", "int", "boolean", "null", "object", "array", "date"];
const RULE_KEYS = ["bsonType", "minimum", "maximum", "enum"];

export function parseValidator(value: JsonValue): JsonObject {
  const bad = (): never => fail("invalid_validator");
  if (!isPlainObject(value)) return bad();
  for (const [key, part] of Object.entries(value)) {
    if (key === "required") {
      if (!Array.isArray(part) || !part.every((path) => typeof path === "string" && path !== "")) bad();
    } else if (key === "properties") {
      if (!isPlainObject(part)) return bad();
      for (const rules of Object.values(part)) {
        if (!isPlainObject(rules) || !Object.keys(rules).every((rule) => RULE_KEYS.includes(rule))) return bad();
        if ("bsonType" in rules && !BSON_TYPES.includes(rules["bsonType"] as string)) bad();
        if ("minimum" in rules && typeof rules["minimum"] !== "number") bad();
        if ("maximum" in rules && typeof rules["maximum"] !== "number") bad();
        if ("enum" in rules && !Array.isArray(rules["enum"])) bad();
      }
    } else {
      bad();
    }
  }
  return value;
}

function hasType(value: JsonValue, bsonType: string): boolean {
  if (bsonType === "int") return typeof value === "number" && Number.isInteger(value);
  return typeOf(value) === bsonType;
}

export function checkValidator(validator: JsonObject, document: JsonObject): void {
  const refuse = (path: string, rule: ValidationRule): never => fail("validation_failed", { path, rule });
  for (const path of (validator["required"] as string[] | undefined) ?? []) {
    if (!objectPathValue(document, path).found) refuse(path, "required");
  }
  const properties = (validator["properties"] as Record<string, JsonObject> | undefined) ?? {};
  for (const path of Object.keys(properties).sort(byCodeUnit)) {
    const found = objectPathValue(document, path);
    const rules = properties[path] as JsonObject;
    if (!found.found) continue;
    const { value } = found;
    if ("bsonType" in rules && !hasType(value, rules["bsonType"] as string)) refuse(path, "bsonType");
    if (typeof value === "number") {
      if ("minimum" in rules && value < (rules["minimum"] as number)) refuse(path, "minimum");
      if ("maximum" in rules && value > (rules["maximum"] as number)) refuse(path, "maximum");
    }
    if ("enum" in rules && !(rules["enum"] as JsonValue[]).some((option) => valuesEqual(value, option))) refuse(path, "enum");
  }
}
