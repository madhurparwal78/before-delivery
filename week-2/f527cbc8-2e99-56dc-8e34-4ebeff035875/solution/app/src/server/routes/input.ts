// Reading request bodies field by field; every refusal becomes a 422 through the shared error shape.
import { UNPARSABLE } from "../http.js";

export type Body = Record<string, unknown>;

/** The JSON body as an object; anything else reads as an empty object so each field reports itself missing. */
export function objectBody(body: unknown): Body {
  return body !== UNPARSABLE && body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Body) : {};
}

export const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === "string" && value.trim() === "");

export const isWholeNumber = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

export const inRange = (value: unknown, min: number, max: number): value is number =>
  isWholeNumber(value) && value >= min && value <= max;

export const isEmail = (value: unknown): value is string =>
  typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.length <= 254;

const text = (value: unknown): string => (typeof value === "string" ? value : "");
