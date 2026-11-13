import { Buffer } from "node:buffer";
import { matchesNumberGrammar } from "../shared/numbers.js";
import { httpError, type HttpError } from "./http.js";

/**
 * House rule H1: every number in a JSON request body matches the number
 * grammar, checked on its source text before the body is parsed. The first
 * offending number in request-text order decides the answer.
 */
export function checkRawGrammar(raw: Buffer): void {
  const text = raw.toString("utf8");
  let i = 0;
  let key: string | null = null;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"') {
      const end = text.indexOf('"', i + 1);
      if (end === -1) return;
      // Skip escaped quotes.
      let j = end;
      while (text[j - 1] === "\\") j = text.indexOf('"', j + 1);
      if (text[j + 1] === ":") key = text.slice(i + 1, j);
      i = j + 1;
      continue;
    }
    if ((c === "-" && /[0-9]/.test(text[i + 1] ?? "")) || /[0-9]/.test(c)) {
      const m = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i))!;
      if (!matchesNumberGrammar(m[0])) {
        const field = key ?? "value";
        throw httpError(422, "value_grammar", `${labelFromKey(field)} takes a plain decimal such as 12.5.`, { field });
      }
      i += m[0].length;
      continue;
    }
    if (c === "{" || c === "[") key = null;
    i++;
  }
}

/** `<Label>` for a field: the key split before each capital, in sentence case. */
export function labelFromKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  const first = spaced.split(" ")[0] ?? "";
  const rest = spaced.slice(first.length);
  return (first.charAt(0).toUpperCase() + first.slice(1)) + rest;
}

export type GrammarError = HttpError;
