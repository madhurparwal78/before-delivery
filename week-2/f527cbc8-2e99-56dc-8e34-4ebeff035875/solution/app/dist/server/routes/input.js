// Reading request bodies field by field; every refusal becomes a 422 through the shared error shape.
import { UNPARSABLE } from "../http.js";
/** The JSON body as an object; anything else reads as an empty object so each field reports itself missing. */
export function objectBody(body) {
    return body !== UNPARSABLE && body !== null && typeof body === "object" && !Array.isArray(body) ? body : {};
}
export const isBlank = (value) => value === undefined || value === null || (typeof value === "string" && value.trim() === "");
export const isWholeNumber = (value) => typeof value === "number" && Number.isInteger(value);
export const inRange = (value, min, max) => isWholeNumber(value) && value >= min && value <= max;
export const isEmail = (value) => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.length <= 254;
const text = (value) => (typeof value === "string" ? value : "");
