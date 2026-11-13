import { inflateSync } from "node:zlib";
import {
  type PdfArray,
  type PdfDict,
  type PdfValue,
  isArray,
  isDict,
  isName,
  isRef,
  isStream,
} from "./objects.js";

class PdfParseError extends Error {}

interface XrefEntry {
  type: 1 | 2;
  a: number;
  b: number;
}

const WHITESPACE = new Set([0, 9, 10, 12, 13, 32]);
const DELIMITERS = new Set(["(", ")", "<", ">", "[", "]", "{", "}", "/", "%"]);

class Lexer {
  pos = 0;
  constructor(readonly text: string) {}

  skip(): void {
    for (;;) {
      const code = this.text.charCodeAt(this.pos);
      if (WHITESPACE.has(code)) this.pos += 1;
      else if (code === 37) {
        while (this.pos < this.text.length && this.text[this.pos] !== "\n" && this.text[this.pos] !== "\r") this.pos += 1;
      } else return;
    }
  }

  value(depth = 0): PdfValue {
    if (depth > 64) throw new PdfParseError("nesting too deep");
    this.skip();
    const char = this.text[this.pos];
    if (char === undefined) throw new PdfParseError("unexpected end");
    if (char === "/") return { kind: "name", value: this.nameToken() };
    if (char === "(") return { kind: "string", bytes: this.literalString() };
    if (char === "<") {
      if (this.text[this.pos + 1] === "<") return this.dictionary(depth);
      return this.hexString();
    }
    if (char === "[") {
      this.pos += 1;
      const items: PdfValue[] = [];
      for (;;) {
        this.skip();
        if (this.text[this.pos] === "]") {
          this.pos += 1;
          return { kind: "array", items };
        }
        items.push(this.value(depth + 1));
      }
    }
    const reference = /(\d+)\s+(\d+)\s+R(?![A-Za-z0-9])/y;
    reference.lastIndex = this.pos;
    const refMatch = reference.exec(this.text);
    if (refMatch) {
      this.pos = reference.lastIndex;
      return { kind: "ref", num: Number(refMatch[1]) };
    }
    const number = /[+-]?(?:\d+\.?\d*|\.\d+)/y;
    number.lastIndex = this.pos;
    const numMatch = number.exec(this.text);
    if (numMatch) {
      this.pos = number.lastIndex;
      return Number(numMatch[0]);
    }
    const word = this.keyword();
    if (word === "true") return true;
    if (word === "false") return false;
    if (word === "null") return null;
    throw new PdfParseError(`unexpected token ${word}`);
  }

  keyword(): string {
    const start = this.pos;
    while (this.pos < this.text.length && !WHITESPACE.has(this.text.charCodeAt(this.pos)) && !DELIMITERS.has(this.text[this.pos] ?? "")) this.pos += 1;
    return this.text.slice(start, this.pos);
  }

  nameToken(): string {
    this.pos += 1;
    const start = this.pos;
    while (this.pos < this.text.length && !WHITESPACE.has(this.text.charCodeAt(this.pos)) && !DELIMITERS.has(this.text[this.pos] ?? "")) this.pos += 1;
    return this.text.slice(start, this.pos).replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  }

  literalString(): Buffer {
    this.pos += 1;
    const bytes: number[] = [];
    let depth = 1;
    while (this.pos < this.text.length) {
      const char = this.text[this.pos] ?? "";
      this.pos += 1;
      if (char === "\\") {
        const next = this.text[this.pos] ?? "";
        this.pos += 1;
        const octal = /^[0-7]/.test(next);
        if (octal) {
          let digits = next;
          while (digits.length < 3 && /[0-7]/.test(this.text[this.pos] ?? "")) {
            digits += this.text[this.pos];
            this.pos += 1;
          }
          bytes.push(parseInt(digits, 8) & 255);
        } else if (next === "n") bytes.push(10);
        else if (next === "r") bytes.push(13);
        else if (next === "t") bytes.push(9);
        else if (next === "b") bytes.push(8);
        else if (next === "f") bytes.push(12);
        else if (next === "\r") {
          if (this.text[this.pos] === "\n") this.pos += 1;
        } else if (next !== "\n") bytes.push(next.charCodeAt(0));
      } else if (char === "(") {
        depth += 1;
        bytes.push(40);
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0) return Buffer.from(bytes);
        bytes.push(41);
      } else bytes.push(char.charCodeAt(0));
    }
    throw new PdfParseError("unterminated string");
  }

  hexString(): PdfValue {
    const end = this.text.indexOf(">", this.pos);
    if (end < 0) throw new PdfParseError("unterminated hex string");
    let hex = this.text.slice(this.pos + 1, end).replace(/\s+/g, "");
    if (hex.length % 2) hex += "0";
    this.pos = end + 1;
    return { kind: "string", bytes: Buffer.from(hex, "hex") };
  }

  dictionary(depth: number): PdfDict {
    this.pos += 2;
    const map = new Map<string, PdfValue>();
    for (;;) {
      this.skip();
      if (this.text.startsWith(">>", this.pos)) {
        this.pos += 2;
        return { kind: "dict", map };
      }
      if (this.text[this.pos] !== "/") throw new PdfParseError("dictionary key expected");
      const key = this.nameToken();
      map.set(key, this.value(depth + 1));
    }
  }
}

function predictorDecode(data: Buffer, params: PdfDict | undefined): Buffer {
  const predictor = Number(params?.map.get("Predictor") ?? 1);
  if (predictor < 10) return data;
  const columns = Number(params?.map.get("Columns") ?? 1);
  const colors = Number(params?.map.get("Colors") ?? 1);
  const bits = Number(params?.map.get("BitsPerComponent") ?? 8);
  const bpp = Math.max(1, Math.ceil((colors * bits) / 8));
  const rowBytes = Math.ceil((columns * colors * bits) / 8);
  const rows = Math.floor(data.length / (rowBytes + 1));
  const out = Buffer.alloc(rows * rowBytes);
  for (let row = 0; row < rows; row += 1) {
    const filter = data[row * (rowBytes + 1)] ?? 0;
    for (let i = 0; i < rowBytes; i += 1) {
      const raw = data[row * (rowBytes + 1) + 1 + i] ?? 0;
      const left = i >= bpp ? (out[row * rowBytes + i - bpp] ?? 0) : 0;
      const up = row > 0 ? (out[(row - 1) * rowBytes + i] ?? 0) : 0;
      const upLeft = row > 0 && i >= bpp ? (out[(row - 1) * rowBytes + i - bpp] ?? 0) : 0;
      let value = raw;
      if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + ((left + up) >> 1);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      }
      out[row * rowBytes + i] = value & 255;
    }
  }
  return out;
}

export class PdfFile {
  private readonly text: string;
  private readonly entries = new Map<number, XrefEntry>();
  private readonly cache = new Map<number, PdfValue>();
  private readonly objectStreams = new Map<number, Map<number, PdfValue>>();
  trailer: PdfDict = { kind: "dict", map: new Map() };

  constructor(readonly bytes: Buffer) {
    this.text = bytes.toString("latin1");
    try {
      this.readXrefChain();
      this.root();
    } catch {
      this.entries.clear();
      this.cache.clear();
      this.objectStreams.clear();
      this.rebuild();
    }
  }

  private readXrefChain(): void {
    const tail = this.text.slice(-2048);
    const marker = tail.lastIndexOf("startxref");
    if (marker < 0) throw new PdfParseError("no startxref");
    let offset = Number(/\d+/.exec(tail.slice(marker + 9))?.[0]);
    const seen = new Set<number>();
    let first = true;
    while (Number.isFinite(offset) && !seen.has(offset)) {
      seen.add(offset);
      const section = this.readXrefSection(offset);
      if (first) {
        this.trailer = section;
        first = false;
      }
      const hybrid = section.map.get("XRefStm");
      if (typeof hybrid === "number") this.readXrefSection(hybrid);
      const prev = section.map.get("Prev");
      if (typeof prev !== "number") break;
      offset = prev;
    }
  }

  private readXrefSection(offset: number): PdfDict {
    const lexer = new Lexer(this.text);
    lexer.pos = offset;
    lexer.skip();
    if (this.text.startsWith("xref", lexer.pos)) {
      lexer.pos += 4;
      for (;;) {
        lexer.skip();
        if (this.text.startsWith("trailer", lexer.pos)) break;
        const startValue = lexer.value();
        const countValue = lexer.value();
        if (typeof startValue !== "number" || typeof countValue !== "number") throw new PdfParseError("bad xref subsection");
        for (let i = 0; i < countValue; i += 1) {
          lexer.skip();
          const entry = /(\d{10})\s(\d{5})\s([nf])/y;
          entry.lastIndex = lexer.pos;
          const match = entry.exec(this.text);
          if (!match) throw new PdfParseError("bad xref entry");
          lexer.pos = entry.lastIndex;
          const num = startValue + i;
          if (match[3] === "n" && !this.entries.has(num)) this.entries.set(num, { type: 1, a: Number(match[1]), b: 0 });
        }
      }
      lexer.pos += 7;
      const trailer = lexer.value();
      if (!isDict(trailer)) throw new PdfParseError("bad trailer");
      return trailer;
    }
    const stream = this.parseIndirectAt(offset);
    if (!isStream(stream)) throw new PdfParseError("xref stream expected");
    const data = this.decodeStream(stream);
    const widths = stream.dict.map.get("W");
    if (!isArray(widths) || widths.items.length !== 3) throw new PdfParseError("bad W");
    const [w0, w1, w2] = widths.items.map(Number) as [number, number, number];
    const size = Number(stream.dict.map.get("Size") ?? 0);
    const indexValue = stream.dict.map.get("Index");
    const ranges = isArray(indexValue) ? indexValue.items.map(Number) : [0, size];
    let cursor = 0;
    const field = (width: number): number => {
      let value = 0;
      for (let i = 0; i < width; i += 1) value = value * 256 + (data[cursor + i] ?? 0);
      cursor += width;
      return value;
    };
    for (let r = 0; r + 1 < ranges.length; r += 2) {
      const start = ranges[r] ?? 0;
      const count = ranges[r + 1] ?? 0;
      for (let i = 0; i < count; i += 1) {
        const type = w0 === 0 ? 1 : field(w0);
        const a = field(w1);
        const b = field(w2);
        const num = start + i;
        if (this.entries.has(num)) continue;
        if (type === 1) this.entries.set(num, { type: 1, a, b });
        else if (type === 2) this.entries.set(num, { type: 2, a, b });
      }
    }
    return stream.dict;
  }

  private rebuild(): void {
    for (const match of this.text.matchAll(/(\d+)\s+(\d+)\s+obj\b/g)) {
      this.entries.set(Number(match[1]), { type: 1, a: match.index ?? 0, b: 0 });
    }
    let trailer: PdfDict | null = null;
    for (const match of this.text.matchAll(/trailer/g)) {
      try {
        const lexer = new Lexer(this.text);
        lexer.pos = (match.index ?? 0) + 7;
        const candidate = lexer.value();
        if (isDict(candidate) && candidate.map.has("Root")) trailer = candidate;
      } catch {
        continue;
      }
    }
    if (!trailer) {
      for (const num of [...this.entries.keys()]) {
        const object = this.safeGet(num);
        if (isStream(object) && isName(object.dict.map.get("Type"), "XRef") && object.dict.map.has("Root")) trailer = object.dict;
        if (isStream(object) && isName(object.dict.map.get("Type"), "ObjStm")) this.indexObjectStream(num, object);
      }
    }
    if (!trailer) {
      for (const num of this.entries.keys()) {
        const object = this.safeGet(num);
        if (isDict(object) && isName(object.map.get("Type"), "Catalog")) trailer = { kind: "dict", map: new Map([["Root", { kind: "ref", num }]]) };
      }
    }
    if (!trailer) throw new PdfParseError("no document catalog");
    this.trailer = trailer;
    this.root();
  }

  private indexObjectStream(streamNum: number, stream: PdfValue): void {
    if (!isStream(stream)) return;
    const objects = this.readObjectStream(stream);
    let index = 0;
    for (const num of objects.keys()) {
      if (!this.entries.has(num)) this.entries.set(num, { type: 2, a: streamNum, b: index });
      index += 1;
    }
    this.objectStreams.set(streamNum, objects);
  }

  private safeGet(num: number): PdfValue {
    try {
      return this.get(num);
    } catch {
      return null;
    }
  }

  private parseIndirectAt(offset: number): PdfValue {
    const lexer = new Lexer(this.text);
    lexer.pos = offset;
    lexer.skip();
    const header = /(\d+)\s+(\d+)\s+obj/y;
    header.lastIndex = lexer.pos;
    if (!header.exec(this.text)) throw new PdfParseError("object header expected");
    lexer.pos = header.lastIndex;
    const value = lexer.value();
    if (!isDict(value)) return value;
    lexer.skip();
    if (!this.text.startsWith("stream", lexer.pos)) return value;
    let start = lexer.pos + 6;
    if (this.text[start] === "\r") start += 1;
    if (this.text[start] === "\n") start += 1;
    const declared = this.resolve(value.map.get("Length") ?? null);
    let end = typeof declared === "number" ? start + declared : -1;
    if (end < start || !/^\s*endstream/.test(this.text.slice(end, end + 12))) {
      end = this.text.indexOf("endstream", start);
      if (end < 0) throw new PdfParseError("unterminated stream");
      if (this.text[end - 1] === "\n") end -= 1;
      if (this.text[end - 1] === "\r") end -= 1;
    }
    return { kind: "stream", dict: value, raw: this.bytes.subarray(start, end) };
  }

  private readObjectStream(stream: PdfValue): Map<number, PdfValue> {
    if (!isStream(stream)) throw new PdfParseError("object stream expected");
    const data = this.decodeStream(stream);
    const count = Number(this.resolve(stream.dict.map.get("N") ?? null));
    const first = Number(this.resolve(stream.dict.map.get("First") ?? null));
    const text = data.toString("latin1");
    const header = new Lexer(text);
    const pairs: [number, number][] = [];
    for (let i = 0; i < count; i += 1) {
      const num = header.value();
      const offset = header.value();
      if (typeof num !== "number" || typeof offset !== "number") throw new PdfParseError("bad object stream header");
      pairs.push([num, offset]);
    }
    const objects = new Map<number, PdfValue>();
    for (const [num, offset] of pairs) {
      const lexer = new Lexer(text);
      lexer.pos = first + offset;
      objects.set(num, lexer.value());
    }
    return objects;
  }

  get(num: number): PdfValue {
    if (this.cache.has(num)) return this.cache.get(num) ?? null;
    const entry = this.entries.get(num);
    let value: PdfValue = null;
    if (entry?.type === 1) value = this.parseIndirectAt(entry.a);
    else if (entry?.type === 2) {
      let objects = this.objectStreams.get(entry.a);
      if (!objects) {
        objects = this.readObjectStream(this.get(entry.a));
        this.objectStreams.set(entry.a, objects);
      }
      value = objects.get(num) ?? null;
    }
    this.cache.set(num, value);
    return value;
  }

  resolve(value: PdfValue): PdfValue {
    let current = value;
    for (let hops = 0; isRef(current) && hops < 32; hops += 1) current = this.get(current.num);
    return current;
  }

  decodeStream(stream: PdfValue): Buffer {
    if (!isStream(stream)) throw new PdfParseError("stream expected");
    const filterValue = this.resolve(stream.dict.map.get("Filter") ?? null);
    const filters = isArray(filterValue) ? filterValue.items.map((f) => this.resolve(f)) : filterValue === null ? [] : [filterValue];
    const parmsValue = this.resolve(stream.dict.map.get("DecodeParms") ?? null);
    const parms = isArray(parmsValue) ? parmsValue.items.map((p) => this.resolve(p)) : [parmsValue];
    let data = stream.raw;
    filters.forEach((filter, index) => {
      if (!isName(filter)) throw new PdfParseError("bad filter");
      if (filter.value !== "FlateDecode" && filter.value !== "Fl") throw new PdfParseError(`unsupported filter ${filter.value}`);
      const params = parms[index];
      data = predictorDecode(inflateSync(data), isDict(params) ? params : undefined);
    });
    return data;
  }

  root(): PdfDict {
    const root = this.resolve(this.trailer.map.get("Root") ?? null);
    if (!isDict(root)) throw new PdfParseError("no catalog");
    return root;
  }

  objectNumbers(): number[] {
    return [...this.entries.keys()];
  }
}

interface PageNode {
  dict: PdfDict;
  inherited: Map<string, PdfValue>;
}

const INHERITABLE = ["Resources", "MediaBox", "CropBox", "Rotate"];

export function collectPages(file: PdfFile): PageNode[] {
  const pages: PageNode[] = [];
  const visited = new Set<PdfDict>();
  const walk = (node: PdfValue, inherited: Map<string, PdfValue>): void => {
    const dictNode = file.resolve(node);
    if (!isDict(dictNode) || visited.has(dictNode) || pages.length > 100000) return;
    visited.add(dictNode);
    const next = new Map(inherited);
    for (const key of INHERITABLE) {
      const value = dictNode.map.get(key);
      if (value !== undefined) next.set(key, value);
    }
    const kids = file.resolve(dictNode.map.get("Kids") ?? null);
    if (isArray(kids)) {
      for (const kid of (kids as PdfArray).items) walk(kid, next);
    } else pages.push({ dict: dictNode, inherited: next });
  };
  walk(file.root().map.get("Pages") ?? null, new Map());
  return pages;
}
