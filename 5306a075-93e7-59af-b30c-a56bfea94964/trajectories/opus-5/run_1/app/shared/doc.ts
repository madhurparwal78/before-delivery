/**
 * The single definition of a note's plain text, its offsets and the render tree
 * that the reading view draws. Server and client both build it from the
 * allowlisted body, so offsets agree on every surface.
 */

export type SimpleNode =
  | { type: 'text'; value: string }
  | { type: 'element'; tag: string; attrs: Record<string, string>; children: SimpleNode[] };

export type DocNode =
  | { kind: 'text'; start: number; text: string }
  | { kind: 'br' }
  | { kind: 'el'; tag: string; href: string | null; children: DocNode[] };

export interface NoteDoc {
  nodes: DocNode[];
  text: string;
}

export const BLOCK_TAGS: ReadonlySet<string> = new Set(['p', 'li', 'blockquote', 'pre']);

interface Emission {
  owner: number;
  text: string;
}

class TextBuilder {
  private readonly emissions: Emission[] = [];

  private lastChar(): string {
    for (let i = this.emissions.length - 1; i >= 0; i -= 1) {
      const { text } = this.emissions[i];
      if (text.length > 0) return text[text.length - 1];
    }
    return '';
  }

  private trimTrailingSpaces(): void {
    while (this.emissions.length > 0) {
      const last = this.emissions[this.emissions.length - 1];
      const trimmed = last.text.replace(/[^\S\n]+$/u, '');
      if (trimmed === last.text) return;
      if (trimmed === '') this.emissions.pop();
      else last.text = trimmed;
    }
  }

  pushInline(owner: number, raw: string): void {
    for (const part of raw.split(/(\s+)/u)) {
      if (part === '') continue;
      if (/^\s+$/u.test(part)) {
        const last = this.lastChar();
        if (last === '' || last === '\n' || last === ' ') continue;
        this.emissions.push({ owner, text: ' ' });
      } else {
        this.emissions.push({ owner, text: part });
      }
    }
  }

  pushPreformatted(owner: number, raw: string): void {
    if (raw !== '') this.emissions.push({ owner, text: raw });
  }

  /** One newline for a boundary between block elements. */
  pushBlockBreak(owner: number): boolean {
    this.trimTrailingSpaces();
    const last = this.lastChar();
    if (last === '' || last === '\n') return false;
    this.emissions.push({ owner, text: '\n' });
    return true;
  }

  /** One newline for an explicit line break. */
  pushLineBreak(owner: number): boolean {
    this.trimTrailingSpaces();
    if (this.lastChar() === '') return false;
    this.emissions.push({ owner, text: '\n' });
    return true;
  }

  endBlock(): void {
    this.trimTrailingSpaces();
  }

  finish(): { text: string; ranges: Map<number, { start: number; text: string }> } {
    this.trimTrailingSpaces();
    const ranges = new Map<number, { start: number; text: string }>();
    let text = '';
    for (const emission of this.emissions) {
      const existing = ranges.get(emission.owner);
      if (existing) existing.text += emission.text;
      else ranges.set(emission.owner, { start: text.length, text: emission.text });
      text += emission.text;
    }
    return { text, ranges };
  }
}

type Draft =
  | { kind: 'slot'; owner: number }
  | { kind: 'break'; owner: number }
  | { kind: 'el'; tag: string; href: string | null; children: Draft[] };

export function buildNoteDoc(input: SimpleNode[]): NoteDoc {
  const builder = new TextBuilder();
  let nextOwner = 0;

  const walkMany = (nodes: SimpleNode[], preformatted: boolean): Draft[] =>
    nodes.map((node) => walk(node, preformatted));

  const walk = (node: SimpleNode, preformatted: boolean): Draft => {
    if (node.type === 'text') {
      const owner = nextOwner++;
      if (preformatted) builder.pushPreformatted(owner, node.value);
      else builder.pushInline(owner, node.value);
      return { kind: 'slot', owner };
    }
    if (node.tag === 'br') {
      const owner = nextOwner++;
      builder.pushLineBreak(owner);
      return { kind: 'break', owner };
    }
    const isBlock = BLOCK_TAGS.has(node.tag);
    let leading: Draft | null = null;
    if (isBlock) {
      const owner = nextOwner++;
      if (builder.pushBlockBreak(owner)) leading = { kind: 'slot', owner };
    }
    const children = walkMany(node.children, preformatted || node.tag === 'pre');
    if (isBlock) builder.endBlock();
    if (leading) children.unshift(leading);
    return { kind: 'el', tag: node.tag, href: node.tag === 'a' ? node.attrs.href ?? null : null, children };
  };

  const drafts = walkMany(input, false);
  const { text, ranges } = builder.finish();

  const materialise = (nodes: Draft[]): DocNode[] => {
    const result: DocNode[] = [];
    for (const node of nodes) {
      if (node.kind === 'el') {
        result.push({ kind: 'el', tag: node.tag, href: node.href, children: materialise(node.children) });
        continue;
      }
      const range = ranges.get(node.owner);
      if (range && range.text !== '') result.push({ kind: 'text', start: range.start, text: range.text });
      if (node.kind === 'break') result.push({ kind: 'br' });
    }
    return result;
  };

  return { nodes: materialise(drafts), text };
}
