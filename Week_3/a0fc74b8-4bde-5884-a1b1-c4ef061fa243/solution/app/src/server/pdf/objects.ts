export interface PdfName {
  kind: "name";
  value: string;
}
export interface PdfRef {
  kind: "ref";
  num: number;
}
export interface PdfString {
  kind: "string";
  bytes: Buffer;
}
export interface PdfDict {
  kind: "dict";
  map: Map<string, PdfValue>;
}
export interface PdfArray {
  kind: "array";
  items: PdfValue[];
}
export interface PdfStream {
  kind: "stream";
  dict: PdfDict;
  raw: Buffer;
}
export type PdfValue = null | boolean | number | PdfName | PdfRef | PdfString | PdfDict | PdfArray | PdfStream;

export const name = (value: string): PdfName => ({ kind: "name", value });
export const ref = (num: number): PdfRef => ({ kind: "ref", num });
export const array = (items: PdfValue[]): PdfArray => ({ kind: "array", items });
export const dict = (entries: Record<string, PdfValue>): PdfDict => ({ kind: "dict", map: new Map(Object.entries(entries)) });

export function isDict(value: PdfValue | undefined): value is PdfDict {
  return typeof value === "object" && value !== null && value.kind === "dict";
}
export function isArray(value: PdfValue | undefined): value is PdfArray {
  return typeof value === "object" && value !== null && value.kind === "array";
}
export function isStream(value: PdfValue | undefined): value is PdfStream {
  return typeof value === "object" && value !== null && value.kind === "stream";
}
export function isName(value: PdfValue | undefined, expected?: string): value is PdfName {
  return typeof value === "object" && value !== null && value.kind === "name" && (expected === undefined || value.value === expected);
}
export function isRef(value: PdfValue | undefined): value is PdfRef {
  return typeof value === "object" && value !== null && value.kind === "ref";
}

export function escapeText(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    if (code < 32 || code > 126) out += "?";
    else if (char === "(" || char === ")" || char === "\\") out += `\\${char}`;
    else out += char;
  }
  return out;
}

function serializeName(value: string): string {
  let out = "/";
  for (const byte of Buffer.from(value, "latin1")) {
    const char = String.fromCharCode(byte);
    out += byte < 33 || byte > 126 || "#()<>[]{}/%".includes(char) ? `#${byte.toString(16).padStart(2, "0")}` : char;
  }
  return out;
}

export function serialize(value: PdfValue, mapRef: (num: number) => number): Buffer {
  if (value === null) return Buffer.from("null");
  if (typeof value === "boolean") return Buffer.from(value ? "true" : "false");
  if (typeof value === "number") return Buffer.from(Number.isInteger(value) ? String(value) : value.toFixed(5).replace(/0+$/, ""));
  switch (value.kind) {
    case "name":
      return Buffer.from(serializeName(value.value), "latin1");
    case "ref":
      return Buffer.from(`${mapRef(value.num)} 0 R`);
    case "string":
      return Buffer.from(`<${value.bytes.toString("hex")}>`);
    case "array":
      return Buffer.concat([Buffer.from("["), ...value.items.flatMap((item, i) => [Buffer.from(i ? " " : ""), serialize(item, mapRef)]), Buffer.from("]")]);
    case "dict": {
      const parts: Buffer[] = [Buffer.from("<<")];
      for (const [key, entry] of value.map) parts.push(Buffer.from(`${serializeName(key)} `, "latin1"), serialize(entry, mapRef), Buffer.from(" "));
      parts.push(Buffer.from(">>"));
      return Buffer.concat(parts);
    }
    case "stream": {
      const map = new Map(value.dict.map);
      map.set("Length", value.raw.length);
      return Buffer.concat([serialize({ kind: "dict", map }, mapRef), Buffer.from("\nstream\n"), value.raw, Buffer.from("\nendstream")]);
    }
  }
}
