import { asName, asNum, type PdfValue } from './model.ts';
import { decodeStream, parsePdf } from './parse.ts';

export type Rect = readonly [number, number, number, number];

export interface PdfPage {
  map: Map<string, PdfValue>;
  mediaBox: Rect;
  cropBox: Rect;
  rotate: number;
  resources: PdfValue | null;
  contents: PdfValue | null;
}

const DEFAULT_BOX: Rect = [0, 0, 612, 792];

const INHERITABLE = ['Resources', 'MediaBox', 'CropBox', 'Rotate'] as const;

export class PdfReader {
  private readonly objects: Map<number, PdfValue>;
  private readonly roots: PdfValue[];

  constructor(bytes: Buffer) {
    const parsed = parsePdf(bytes);
    this.objects = parsed.objects;
    this.roots = parsed.trailerRoots;
  }

  resolve(value: PdfValue | null | undefined): PdfValue | undefined {
    let current: PdfValue | null | undefined = value;
    for (let hops = 0; hops < 32; hops += 1) {
      if (current === null || current === undefined) return undefined;
      if (current.kind !== 'ref') return current;
      current = this.objects.get(current.num);
    }
    return undefined;
  }

  object(num: number): PdfValue | undefined {
    return this.objects.get(num);
  }

  streamData(value: PdfValue | null | undefined): Uint8Array | null {
    const resolved = this.resolve(value);
    if (!resolved || resolved.kind !== 'stream') return null;
    return decodeStream(resolved.map, resolved.raw);
  }

  private rect(value: PdfValue | null | undefined, fallback: Rect): Rect {
    const resolved = this.resolve(value);
    if (!resolved || resolved.kind !== 'array' || resolved.items.length < 4) return fallback;
    const numbers = resolved.items.slice(0, 4).map((item) => asNum(this.resolve(item)) ?? 0);
    const [a = 0, b = 0, c = 0, d = 0] = numbers;
    return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
  }

  private catalogPagesNode(): PdfValue | undefined {
    for (const root of [...this.roots].reverse()) {
      const catalog = this.resolve(root);
      if (catalog?.kind === 'dict') {
        const pages = catalog.map.get('Pages');
        if (pages) return pages;
      }
    }
    for (const value of this.objects.values()) {
      if (value.kind === 'dict' && asName(value.map.get('Type')) === 'Catalog') {
        const pages = value.map.get('Pages');
        if (pages) return pages;
      }
    }
    return undefined;
  }

  pages(): PdfPage[] {
    const collected: Array<Map<string, PdfValue>> = [];
    const node = this.catalogPagesNode();
    if (node) this.walk(node, new Map(), collected, new Set());
    if (collected.length === 0) {
      for (const [num, value] of [...this.objects.entries()].sort((a, b) => a[0] - b[0])) {
        void num;
        if (value.kind === 'dict' && asName(value.map.get('Type')) === 'Page') {
          collected.push(value.map);
        }
      }
    }
    return collected.map((map) => {
      const mediaBox = this.rect(map.get('MediaBox'), DEFAULT_BOX);
      return {
        map,
        mediaBox,
        cropBox: this.rect(map.get('CropBox'), mediaBox),
        rotate: asNum(this.resolve(map.get('Rotate'))) ?? 0,
        resources: map.get('Resources') ?? null,
        contents: map.get('Contents') ?? null,
      };
    });
  }

  private walk(
    nodeValue: PdfValue,
    inherited: Map<string, PdfValue>,
    out: Array<Map<string, PdfValue>>,
    seen: Set<number>,
  ): void {
    if (nodeValue.kind === 'ref') {
      if (seen.has(nodeValue.num)) return;
      seen.add(nodeValue.num);
    }
    const node = this.resolve(nodeValue);
    if (!node || node.kind !== 'dict') return;
    const merged = new Map(inherited);
    for (const key of INHERITABLE) {
      const own = node.map.get(key);
      if (own !== undefined) merged.set(key, own);
    }
    const kids = this.resolve(node.map.get('Kids'));
    const type = asName(node.map.get('Type'));
    if (kids?.kind === 'array' && type !== 'Page') {
      for (const kid of kids.items) this.walk(kid, merged, out, seen);
      return;
    }
    if (type === 'Pages') return;
    const page = new Map(node.map);
    for (const [key, value] of merged) {
      if (!page.has(key)) page.set(key, value);
    }
    out.push(page);
  }

  /** Every content stream of a page, decoded and joined. */
  pageContent(page: PdfPage): Uint8Array {
    const contents = this.resolve(page.contents);
    if (!contents) return new Uint8Array();
    if (contents.kind === 'stream') return decodeStream(contents.map, contents.raw);
    if (contents.kind === 'array') {
      const parts: Buffer[] = [];
      for (const item of contents.items) {
        const data = this.streamData(item);
        if (data) parts.push(Buffer.from(data), Buffer.from('\n'));
      }
      return Buffer.concat(parts);
    }
    return new Uint8Array();
  }

  /**
   * Copies an object graph into a sink, rewriting references. Numbers are
   * reserved before their target is copied so that reference cycles resolve.
   */
  copyInto(
    value: PdfValue,
    sink: ObjectSink,
    mapping: Map<number, number>,
    skipKeys: readonly string[] = [],
  ): PdfValue {
    if (value.kind === 'ref') {
      const existing = mapping.get(value.num);
      if (existing !== undefined) return { kind: 'ref', num: existing };
      const target = this.objects.get(value.num);
      if (!target) return { kind: 'null' };
      const reserved = sink.reserve();
      mapping.set(value.num, reserved);
      sink.set(reserved, this.copyInto(target, sink, mapping, skipKeys));
      return { kind: 'ref', num: reserved };
    }
    if (value.kind === 'array') {
      return {
        kind: 'array',
        items: value.items.map((item) => this.copyInto(item, sink, mapping, skipKeys)),
      };
    }
    if (value.kind === 'dict' || value.kind === 'stream') {
      const map = new Map<string, PdfValue>();
      for (const [key, entry] of value.map) {
        if (skipKeys.includes(key)) continue;
        map.set(key, this.copyInto(entry, sink, mapping, skipKeys));
      }
      if (value.kind === 'stream') return { kind: 'stream', map, raw: value.raw };
      return { kind: 'dict', map };
    }
    return value;
  }
}

export interface ObjectSink {
  reserve(): number;
  set(num: number, value: PdfValue): void;
}
