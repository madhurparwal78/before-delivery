/** Reads a JSON object body while keeping the raw text of each top-level value, so integers are judged as literals. */

export interface ParsedBody {
  readonly value: Record<string, unknown>;
  /** Raw source text of each top-level member's value. */
  readonly raw: ReadonlyMap<string, string>;
}

const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);

/** Splits a well-formed JSON object into the raw text of its top-level member values. */
const topLevelRaw = (text: string): Map<string, string> => {
  const found = new Map<string, string>();
  let i = 0;
  const skip = (): void => {
    while (i < text.length && WHITESPACE.has(text.charAt(i))) i += 1;
  };
  const readString = (): string => {
    const start = i;
    i += 1;
    while (text.charAt(i) !== '"') i += text.charAt(i) === "\\" ? 2 : 1;
    i += 1;
    return text.slice(start, i);
  };
  const skipValue = (): void => {
    const first = text.charAt(i);
    if (first === '"') {
      readString();
    } else if (first === "{" || first === "[") {
      let depth = 0;
      do {
        const c = text.charAt(i);
        if (c === '"') {
          readString();
          continue;
        }
        if (c === "{" || c === "[") depth += 1;
        if (c === "}" || c === "]") depth -= 1;
        i += 1;
      } while (depth > 0);
    } else {
      while (i < text.length && !",}] \t\n\r".includes(text.charAt(i))) i += 1;
    }
  };
  skip();
  i += 1;
  skip();
  while (text.charAt(i) !== "}") {
    const key = JSON.parse(readString()) as string;
    skip();
    i += 1;
    skip();
    const start = i;
    skipValue();
    found.set(key, text.slice(start, i));
    skip();
    if (text.charAt(i) === ",") i += 1;
    skip();
  }
  return found;
};

export const parseJsonObject = (text: string): ParsedBody | null => {
  let value: unknown;
  try {
    value = JSON.parse(text === "" ? "{}" : text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return { value: value as Record<string, unknown>, raw: text === "" ? new Map() : topLevelRaw(text) };
};

/** A JSON integer literal: digits only, no fraction, exponent, sign or quotes, within the safe-integer range. */
export const integerLiteral = (raw: string | undefined): number | null => {
  if (raw === undefined || !/^(0|[1-9][0-9]*)$/.test(raw)) return null;
  return BigInt(raw) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(raw) : null;
};
