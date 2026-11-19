import { textOf, unescapeText, utf8Bytes } from "../bytes";
import { OperationError } from "./types";

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
/** A Map keeps keys in the order written, integer-like keys included. */
type JsonObject = Map<string, JsonValue>;

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

const ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

class JsonParser {
  private at = 0;

  constructor(private readonly text: string) {}

  parseDocument(): JsonValue {
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.at < this.text.length) this.fail();
    return value;
  }

  /** Fails at the current position: the first unexpected character, or just past the end. */
  private fail(): never {
    const before = this.text.slice(0, this.at);
    const lineStart = before.lastIndexOf("\n") + 1;
    const line = before.split("\n").length;
    const column = Array.from(before.slice(lineStart)).length + 1;
    throw new OperationError(`Invalid JSON at line ${line} column ${column}`);
  }

  private skipWhitespace(): void {
    for (;;) {
      const c = this.text[this.at];
      if (c !== " " && c !== "\t" && c !== "\n" && c !== "\r") return;
      this.at++;
    }
  }

  private expect(character: string): void {
    if (this.text[this.at] !== character) this.fail();
    this.at++;
  }

  private literal(word: string): void {
    for (const character of word) this.expect(character);
  }

  private parseValue(): JsonValue {
    this.skipWhitespace();
    const c = this.text[this.at];
    if (c === "{") return this.parseObject();
    if (c === "[") return this.parseArray();
    if (c === '"') return this.parseString();
    if (c === "t") {
      this.literal("true");
      return true;
    }
    if (c === "f") {
      this.literal("false");
      return false;
    }
    if (c === "n") {
      this.literal("null");
      return null;
    }
    return this.parseNumber();
  }

  private skipDigits(): void {
    if (!isDigit(this.text.charAt(this.at))) this.fail();
    while (isDigit(this.text.charAt(this.at))) this.at++;
  }

  private parseNumber(): number {
    const start = this.at;
    if (this.text[this.at] === "-") this.at++;
    if (this.text[this.at] === "0") this.at++;
    else this.skipDigits();
    if (this.text[this.at] === ".") {
      this.at++;
      this.skipDigits();
    }
    if (this.text[this.at] === "e" || this.text[this.at] === "E") {
      this.at++;
      if (this.text[this.at] === "+" || this.text[this.at] === "-") this.at++;
      this.skipDigits();
    }
    return Number(this.text.slice(start, this.at));
  }

  private parseString(): string {
    this.at++;
    const parts: string[] = [];
    let start = this.at;
    for (;;) {
      if (this.at >= this.text.length) this.fail();
      const code = this.text.charCodeAt(this.at);
      if (code === 0x22) break;
      if (code < 0x20) this.fail();
      if (code !== 0x5c) {
        this.at++;
        continue;
      }
      parts.push(this.text.slice(start, this.at));
      this.at++;
      parts.push(this.parseEscape());
      start = this.at;
    }
    parts.push(this.text.slice(start, this.at));
    this.at++;
    return parts.join("");
  }

  private parseEscape(): string {
    const c = this.text.charAt(this.at);
    const simple = ESCAPES[c];
    if (simple !== undefined) {
      this.at++;
      return simple;
    }
    if (c !== "u") this.fail();
    this.at++;
    for (let i = 0; i < 4; i++) {
      if (!/^[0-9a-fA-F]$/.test(this.text.charAt(this.at + i))) {
        this.at += i;
        this.fail();
      }
    }
    const unit = parseInt(this.text.slice(this.at, this.at + 4), 16);
    this.at += 4;
    return String.fromCharCode(unit);
  }

  private parseArray(): JsonValue[] {
    this.at++;
    const items: JsonValue[] = [];
    this.skipWhitespace();
    if (this.text[this.at] === "]") {
      this.at++;
      return items;
    }
    for (;;) {
      items.push(this.parseValue());
      this.skipWhitespace();
      if (this.text[this.at] === "]") {
        this.at++;
        return items;
      }
      this.expect(",");
    }
  }

  private parseObject(): JsonObject {
    this.at++;
    const entries: JsonObject = new Map();
    this.skipWhitespace();
    if (this.text[this.at] === "}") {
      this.at++;
      return entries;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.at] !== '"') this.fail();
      const key = this.parseString();
      this.skipWhitespace();
      this.expect(":");
      entries.set(key, this.parseValue());
      this.skipWhitespace();
      if (this.text[this.at] === "}") {
        this.at++;
        return entries;
      }
      this.expect(",");
    }
  }
}

function parseJson(input: Uint8Array): JsonValue {
  return new JsonParser(textOf(input)).parseDocument();
}

/** Writes a value exactly as JSON.stringify(value, null, indent) would. */
function serialize(value: JsonValue, indent: string, depth = 0): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const items = Array.isArray(value)
    ? value.map((item) => serialize(item, indent, depth + 1))
    : Array.from(value, ([key, item]) => `${JSON.stringify(key)}:${indent === "" ? "" : " "}${serialize(item, indent, depth + 1)}`);
  const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  if (items.length === 0) return open + close;
  if (indent === "") return open + items.join(",") + close;
  const inner = `\n${indent.repeat(depth + 1)}`;
  return `${open}${inner}${items.join(`,${inner}`)}\n${indent.repeat(depth)}${close}`;
}

const INDENTS: Record<string, string> = { "2": "  ", "4": "    ", Tab: "\t" };

export function jsonBeautify(input: Uint8Array, indent: string): Uint8Array {
  return utf8Bytes(serialize(parseJson(input), INDENTS[indent] ?? "  "));
}

export function jsonMinify(input: Uint8Array): Uint8Array {
  return utf8Bytes(serialize(parseJson(input), ""));
}

/** Splits RFC 4180 text into records; a final line break does not start another record. */
function csvRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let fields: string[] = [];
  let line = 1;
  let at = 0;
  while (at < text.length) {
    let field = "";
    if (text[at] === '"') {
      const openedOn = line;
      at++;
      for (;;) {
        const quote = text.indexOf('"', at);
        if (quote === -1) throw new OperationError(`Unclosed quote at line ${openedOn}`);
        const chunk = text.slice(at, quote);
        line += chunk.split("\n").length - 1;
        field += chunk;
        at = quote + 1;
        if (text[at] !== '"') break;
        field += '"';
        at++;
      }
    }
    let end = at;
    while (end < text.length && text[end] !== "\n" && !(text[end] === "\r" && text[end + 1] === "\n")
      && !(delimiter !== "" && text.startsWith(delimiter, end))) end++;
    field += text.slice(at, end);
    fields.push(field);
    at = end;
    if (at >= text.length) break;
    if (text[at] === "\n" || text.startsWith("\r\n", at)) {
      at += text[at] === "\r" ? 2 : 1;
      line++;
      records.push(fields);
      fields = [];
    } else {
      at += delimiter.length;
      if (at >= text.length) fields.push("");
    }
  }
  if (fields.length > 0) records.push(fields);
  return records;
}

export function csvToJson(input: Uint8Array, delimiter: string, firstRowIsHeader: boolean): Uint8Array {
  const records = csvRecords(textOf(input), unescapeText(delimiter));
  if (records.length === 0) return utf8Bytes("[]");
  const first = records[0] as string[];
  const expected = first.length;
  if (firstRowIsHeader) {
    const seen = new Set<string>();
    first.forEach((name, index) => {
      if (seen.has(name)) throw new OperationError(`Duplicate header '${name}' at column ${index + 1}`);
      seen.add(name);
    });
  }
  records.forEach((fields, index) => {
    if (fields.length !== expected) {
      throw new OperationError(`Row ${index + 1} has ${fields.length} fields; expected ${expected}`);
    }
  });
  const rows: JsonValue[] = firstRowIsHeader
    ? records.slice(1).map((fields) => new Map(first.map((name, column): [string, JsonValue] => [name, fields[column] as string])))
    : records;
  return utf8Bytes(serialize(rows, "  "));
}

function csvField(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function cellText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return serialize(value, "");
}

export function jsonToCsv(input: Uint8Array): Uint8Array {
  const value = parseJson(input);
  if (!Array.isArray(value)) throw new OperationError("JSON to CSV needs an array of objects");
  const objects = value.filter((item): item is JsonObject => item instanceof Map);
  if (objects.length !== value.length) throw new OperationError("JSON to CSV needs an array of objects");
  if (objects.length === 0) return new Uint8Array(0);
  const header = Array.from((objects[0] as JsonObject).keys());
  const rows = [header.map(csvField).join(",")];
  for (const object of objects) rows.push(header.map((key) => csvField(cellText(object.get(key)))).join(","));
  return utf8Bytes(rows.join("\n"));
}
