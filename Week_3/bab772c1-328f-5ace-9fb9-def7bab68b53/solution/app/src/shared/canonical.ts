/** RFC 8785 (JCS) canonical JSON, used by both audit append and audit verify. */

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

const ESCAPES: ReadonlyMap<string, string> = new Map([
  ['"', '\\"'],
  ["\\", "\\\\"],
  ["\b", "\\b"],
  ["\f", "\\f"],
  ["\n", "\\n"],
  ["\r", "\\r"],
  ["\t", "\\t"],
]);

function canonicalString(value: string): string {
  let out = '"';
  for (const character of value) {
    const escape = ESCAPES.get(character);
    if (escape) {
      out += escape;
      continue;
    }
    const code = character.codePointAt(0) as number;
    out += code < 0x20 ? `\\u${code.toString(16).padStart(4, "0")}` : character;
  }
  return `${out}"`;
}

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("cannot canonicalise a non-finite number");
  }
  return value === 0 ? "0" : JSON.stringify(value);
}

export function canonicalize(value: JsonValue): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return canonicalNumber(value);
  }
  if (typeof value === "string") {
    return canonicalString(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const members = keys.map((key) => `${canonicalString(key)}:${canonicalize(value[key])}`);
  return `{${members.join(",")}}`;
}
