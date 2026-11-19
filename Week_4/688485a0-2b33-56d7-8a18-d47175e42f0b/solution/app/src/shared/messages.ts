import { displayNumber } from "./display.js";
import type { JsonObject, JsonValue } from "./json.js";
import { isObject } from "./json.js";

/** The shared set of document messages (Save status and `Line <n>:` in load reports). */

export interface ErrorBody {
  error: string;
  [field: string]: JsonValue | undefined;
}

function validationText(validator: JsonObject | null, path: string, rule: string): string {
  const properties = validator?.["properties"];
  const rules = isObject(properties) ? properties[path] : undefined;
  const operand = (name: string): JsonValue => (isObject(rules) ? (rules[name] ?? null) : null);
  switch (rule) {
    case "required":
      return "required field is missing";
    case "bsonType":
      return `expected ${String(operand("bsonType"))}`;
    case "minimum":
      return `must be at least ${displayNumber(operand("minimum") as number)}`;
    case "maximum":
      return `must be at most ${displayNumber(operand("maximum") as number)}`;
    default:
      return `must be one of ${JSON.stringify(operand("enum"))}`;
  }
}

/** The message for a document refusal, or null when the error is not one of the document messages. */
export function documentMessage(body: ErrorBody, validator: JsonObject | null): string | null {
  switch (body.error) {
    case "invalid_id":
      return "invalid _id";
    case "invalid_field_name":
      return `invalid field name at ${String(body["path"])}`;
    case "document_too_large":
      return `document is larger than ${displayNumber(Number(body["limit"]))} bytes`;
    case "document_too_deep":
      return `document is nested deeper than ${displayNumber(Number(body["limit"]))} levels`;
    case "validation_failed":
      return `Document failed validation at ${String(body["path"])}: ${validationText(validator, String(body["path"]), String(body["rule"]))}`;
    case "duplicate_key":
      return `Duplicate value ${JSON.stringify(body["value"])} for unique index ${String(body["index"])}`;
    default:
      return null;
  }
}
