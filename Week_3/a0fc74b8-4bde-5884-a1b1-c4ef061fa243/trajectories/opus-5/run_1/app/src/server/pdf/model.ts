export type PdfValue =
  | { kind: 'null' }
  | { kind: 'bool'; value: boolean }
  | { kind: 'num'; value: number }
  | { kind: 'string'; bytes: Uint8Array }
  | { kind: 'name'; name: string }
  | { kind: 'array'; items: PdfValue[] }
  | { kind: 'dict'; map: Map<string, PdfValue> }
  | { kind: 'stream'; map: Map<string, PdfValue>; raw: Uint8Array }
  | { kind: 'ref'; num: number };

export const pdfNum = (value: number): PdfValue => ({ kind: 'num', value });
export const pdfName = (name: string): PdfValue => ({ kind: 'name', name });
export const pdfArray = (items: PdfValue[]): PdfValue => ({ kind: 'array', items });
export const pdfRef = (num: number): PdfValue => ({ kind: 'ref', num });
export const pdfDict = (entries: Record<string, PdfValue>): PdfValue => ({
  kind: 'dict',
  map: new Map(Object.entries(entries)),
});
export const pdfStream = (entries: Record<string, PdfValue>, raw: Uint8Array): PdfValue => ({
  kind: 'stream',
  map: new Map(Object.entries(entries)),
  raw,
});

export const asNum = (value: PdfValue | undefined): number | null =>
  value && value.kind === 'num' ? value.value : null;

export const asName = (value: PdfValue | undefined): string | null =>
  value && value.kind === 'name' ? value.name : null;

const NAME_ESCAPE = /[^\x21-\x7e]|[()<>[\]{}/%#]/g;

const serializeName = (name: string): string =>
  `/${name.replace(NAME_ESCAPE, (c) => `#${c.charCodeAt(0).toString(16).padStart(2, '0')}`)}`;

const serializeString = (bytes: Uint8Array): Buffer => {
  const out: number[] = [0x28];
  for (const byte of bytes) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out.push(0x5c, byte);
    else if (byte === 0x0d) out.push(0x5c, 0x72);
    else if (byte === 0x0a) out.push(0x5c, 0x6e);
    else out.push(byte);
  }
  out.push(0x29);
  return Buffer.from(out);
};

const serializeNumber = (value: number): string => {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
};

const serializeMap = (map: Map<string, PdfValue>): Buffer => {
  const parts: Buffer[] = [Buffer.from('<<')];
  for (const [key, value] of map) {
    parts.push(Buffer.from(`${serializeName(key)} `), serialize(value), Buffer.from(' '));
  }
  parts.push(Buffer.from('>>'));
  return Buffer.concat(parts);
};

export const serialize = (value: PdfValue): Buffer => {
  switch (value.kind) {
    case 'null':
      return Buffer.from('null');
    case 'bool':
      return Buffer.from(value.value ? 'true' : 'false');
    case 'num':
      return Buffer.from(serializeNumber(value.value));
    case 'string':
      return serializeString(value.bytes);
    case 'name':
      return Buffer.from(serializeName(value.name));
    case 'array':
      return Buffer.concat([
        Buffer.from('['),
        Buffer.concat(value.items.flatMap((item) => [serialize(item), Buffer.from(' ')])),
        Buffer.from(']'),
      ]);
    case 'dict':
      return serializeMap(value.map);
    case 'stream': {
      const map = new Map(value.map);
      map.set('Length', pdfNum(value.raw.byteLength));
      return Buffer.concat([
        serializeMap(map),
        Buffer.from('\nstream\n'),
        Buffer.from(value.raw),
        Buffer.from('\nendstream'),
      ]);
    }
    case 'ref':
      return Buffer.from(`${value.num} 0 R`);
  }
};
