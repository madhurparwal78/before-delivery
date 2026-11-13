// House rule H1 on a request body: every number is judged on its source text, before it becomes a number.
// The reader below is a JSON reader that keeps each number's text, so bodies such as {"seq":01} are read, then refused.
import type { Json } from "../shared/canonical";
import { isGrammatical } from "../shared/numbers";
import { labelOf } from "../shared/text";
import { ApiError } from "./errors";

interface Scalar {
  /** The object keys leading to the value; array positions add nothing. */
  path: string[];
  kind: "number" | "string" | "other";
  text: string;
}

export interface ParsedBody {
  value: Json;
  /** Every scalar in request-text order. */
  scalars: Scalar[];
}

/** Keys outside `values` whose value must be a number. */
const NUMERIC_KEYS = new Set(["seq", "ms", "operation", "position", "target", "up", "fov"]);
const NUMBER_TOKEN = /^-?\d[\d.eE+-]*$/;
const WORDS = new Map<string, Json>([["true", true], ["false", false], ["null", null]]);

const invalidJson = () => new ApiError(400, "invalid_json", "The request body is not valid JSON.");

/** Reads a JSON text; throws invalid_json for anything that is not JSON apart from number spelling. */
export function parseBody(text: string): ParsedBody {
  const scalars: Scalar[] = [];
  let i = 0;
  const skipSpace = () => {
    while (i < text.length && " \t\n\r".includes(text.charAt(i))) i += 1;
  };
  const expect = (c: string) => {
    skipSpace();
    if (text.charAt(i) !== c) throw invalidJson();
    i += 1;
  };
  const string = (): string => {
    skipSpace();
    const start = i;
    if (text.charAt(i) !== '"') throw invalidJson();
    i += 1;
    while (i < text.length && text.charAt(i) !== '"') i += text.charAt(i) === "\\" ? 2 : 1;
    i += 1;
    try {
      const decoded = JSON.parse(text.slice(start, i)) as string;
      if (decoded.includes("\u0000")) throw invalidJson();
      return decoded;
    } catch {
      throw invalidJson();
    }
  };
  const list = <T>(open: string, close: string, member: () => T): T[] => {
    expect(open);
    const members: T[] = [];
    skipSpace();
    if (text.charAt(i) === close) {
      i += 1;
      return members;
    }
    for (;;) {
      members.push(member());
      skipSpace();
      const separator = text.charAt(i);
      i += 1;
      if (separator === close) return members;
      if (separator !== ",") throw invalidJson();
    }
  };
  const value = (path: string[]): Json => {
    skipSpace();
    const c = text.charAt(i);
    if (c === "{") {
      return Object.fromEntries(
        list("{", "}", () => {
          const name = string();
          expect(":");
          return [name, value([...path, name])] as const;
        }),
      );
    }
    if (c === "[") return list("[", "]", () => value(path));
    const start = i;
    if (c === '"') {
      const decoded = string();
      scalars.push({ path, kind: "string", text: text.slice(start, i) });
      return decoded;
    }
    while (i < text.length && !",]} \t\n\r".includes(text.charAt(i))) i += 1;
    const token = text.slice(start, i);
    if (NUMBER_TOKEN.test(token)) {
      scalars.push({ path, kind: "number", text: token });
      return Number(token);
    }
    const word = WORDS.get(token);
    if (word === undefined) throw invalidJson();
    scalars.push({ path, kind: "other", text: token });
    return word;
  };
  const parsed = value([]);
  skipSpace();
  if (i < text.length) throw invalidJson();
  return { value: parsed, scalars };
}

/**
 * Throws value_grammar for the first number outside the grammar, or the first string where a number is
 * expected. `numericParameters` names the parameters of `values` that take numbers.
 */
export function checkNumberGrammar(body: ParsedBody, numericParameters: ReadonlySet<string>): void {
  for (const scalar of body.scalars) {
    const field = scalar.path[scalar.path.length - 1];
    if (field === undefined) continue;
    const inValues = scalar.path[0] === "values" && scalar.path.length === 2;
    const expectsNumber = inValues ? numericParameters.has(field) : NUMERIC_KEYS.has(field);
    const refused = scalar.kind === "number" ? !isGrammatical(scalar.text) : scalar.kind === "string" && expectsNumber;
    if (refused) throw new ApiError(422, "value_grammar", `${labelOf(field)} takes a plain decimal such as 12.5.`, { field });
  }
}
