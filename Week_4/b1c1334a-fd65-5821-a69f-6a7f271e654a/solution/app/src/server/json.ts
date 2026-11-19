// A strict JSON reader that keeps every number as the exact characters it was sent as,
// so a Decimal is never routed through binary floating point.

export class JsonNumber {
  constructor(readonly raw: string) {}
}

export type Json = null | boolean | string | JsonNumber | Json[] | { [key: string]: Json };

export class JsonSyntaxError extends Error {}

export function parseJson(text: string): Json {
  let at = 0;
  const fail = (): never => {
    throw new JsonSyntaxError(`Unexpected input at ${at}`);
  };
  const space = () => {
    while (at < text.length && " \t\r\n".includes(text[at]!)) at++;
  };
  const value = (): Json => {
    space();
    const c = text[at];
    if (c === "{") return object();
    if (c === "[") return array();
    if (c === '"') return string();
    if (c === "-" || (c !== undefined && c >= "0" && c <= "9")) return number();
    if (text.startsWith("true", at)) return (at += 4), true;
    if (text.startsWith("false", at)) return (at += 5), false;
    if (text.startsWith("null", at)) return (at += 4), null;
    return fail();
  };
  const object = (): Json => {
    const out: { [key: string]: Json } = Object.create(null);
    at++;
    space();
    if (text[at] === "}") return at++, out;
    for (;;) {
      space();
      if (text[at] !== '"') fail();
      const key = string();
      space();
      if (text[at] !== ":") fail();
      at++;
      out[key] = value();
      space();
      if (text[at] === ",") {
        at++;
        continue;
      }
      if (text[at] === "}") return at++, out;
      fail();
    }
  };
  const array = (): Json => {
    const out: Json[] = [];
    at++;
    space();
    if (text[at] === "]") return at++, out;
    for (;;) {
      out.push(value());
      space();
      if (text[at] === ",") {
        at++;
        continue;
      }
      if (text[at] === "]") return at++, out;
      fail();
    }
  };
  const string = (): string => {
    at++;
    let out = "";
    for (;;) {
      const c = text[at];
      if (c === undefined) fail();
      if (c === '"') return at++, out;
      if (c! < " ") fail();
      if (c === "\\") {
        const e = text[at + 1];
        const simple: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        if (e !== undefined && e in simple) {
          out += simple[e];
          at += 2;
        } else if (e === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(at + 2, at + 6))) {
          out += String.fromCharCode(parseInt(text.slice(at + 2, at + 6), 16));
          at += 6;
        } else fail();
      } else {
        out += c;
        at++;
      }
    }
  };
  const number = (): JsonNumber => {
    const match = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(text.slice(at));
    if (!match) return fail();
    at += match[0].length;
    return new JsonNumber(match[0]);
  };
  const result = value();
  space();
  if (at !== text.length) fail();
  return result;
}

export function isObject(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof JsonNumber);
}

// A whole number sent as a JSON number or as a string of digits.
export function wholeNumber(value: Json | undefined): number | null {
  const raw = value instanceof JsonNumber ? value.raw : typeof value === "string" ? value : null;
  if (raw === null || !/^-?[0-9]{1,15}$/.test(raw)) return null;
  return Number(raw);
}
