import { SEARCH_MAX_DEPTH } from "./constants";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** The one JSON depth rule: the outer object is level 1, each nested object or array adds a level. */
export function jsonDepth(value: JsonValue): number {
  if (Array.isArray(value)) {
    let max = 1;
    for (const item of value) {
      const d = jsonDepth(item) + 1;
      if (d > max) max = d;
    }
    return max;
  }
  if (typeof value === "object" && value !== null) {
    let max = 1;
    for (const key of Object.keys(value)) {
      const d = jsonDepth((value as Record<string, JsonValue>)[key]!) + 1;
      if (d > max) max = d;
    }
    return max;
  }
  return 1;
}

export function bodyTooDeep(value: JsonValue): boolean {
  return jsonDepth(value) > SEARCH_MAX_DEPTH;
}
