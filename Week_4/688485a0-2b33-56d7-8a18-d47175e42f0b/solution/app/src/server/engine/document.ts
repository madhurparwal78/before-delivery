import { randomBytes } from "node:crypto";
import type { JsonObject, JsonValue } from "../../shared/json.js";
import { fail } from "../errors.js";
import { compact, dateOf, depthOf, isPlainObject } from "./value.js";

/** Document rules: `_id`, field names, size and depth, in that order. */

interface DocumentLimits {
  maxBytes: number;
  maxDepth: number;
}

const ID_FORMAT = /^[0-9a-f]{24}$/;

const newId = (): string => randomBytes(12).toString("hex");

export function isDocumentId(value: unknown): value is string {
  return typeof value === "string" && ID_FORMAT.test(value);
}

function firstBadFieldName(value: JsonValue, path: string[]): string | null {
  if (Array.isArray(value)) {
    for (const [index, element] of value.entries()) {
      const bad = firstBadFieldName(element, [...path, String(index)]);
      if (bad) return bad;
    }
    return null;
  }
  if (typeof value !== "object" || value === null || dateOf(value) !== null) return null;
  for (const [key, inner] of Object.entries(value)) {
    if (key.startsWith("$") || key.includes(".")) return [...path, key].join(".");
    const bad = firstBadFieldName(inner, [...path, key]);
    if (bad) return bad;
  }
  return null;
}

/** The document as stored: `_id` first (assigned when absent), every rule checked in order. */
export function checkDocument(input: JsonObject, limits: DocumentLimits): JsonObject {
  const given = input["_id"];
  if (given !== undefined && !isDocumentId(given)) fail("invalid_id");
  const { _id, ...rest } = input;
  const document: JsonObject = { _id: (_id as string | undefined) ?? newId(), ...rest };
  const badName = firstBadFieldName(rest, []);
  if (badName) fail("invalid_field_name", { path: badName });
  if (Buffer.byteLength(compact(document), "utf8") > limits.maxBytes) fail("document_too_large", { limit: limits.maxBytes });
  if (depthOf(document) > limits.maxDepth) fail("document_too_deep", { limit: limits.maxDepth });
  return document;
}

export function asDocument(value: unknown, field: string): JsonObject {
  return isPlainObject(value as JsonValue) ? (value as JsonObject) : fail("invalid_field", { field });
}
