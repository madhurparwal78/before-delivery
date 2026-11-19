import { COPY } from './rules.ts';

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

export type Block = { kind: 'paragraph'; inline: Inline[] } | { kind: 'list'; items: Inline[][] };

const LINK = /\[([^\]\n]*)\]\(([^)\n]*)\)/g;
const SAFE_HREF = /^https?:\/\//;

/** The link-scheme sentence when a note holds a link that is not http or https. */
export function noteLinkProblem(text: string): string | null {
  for (const match of text.matchAll(LINK)) {
    if (!SAFE_HREF.test(match[2] ?? '')) return COPY.link_scheme;
  }
  return null;
}

const INLINE = /(`[^`\n]+`)|(\[[^\]\n]*\]\([^)\n]*\))|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/g;

function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of line.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: line.slice(last, at) });
    const [whole, code, link, bold, italic] = match;
    if (code) out.push({ kind: 'code', text: code.slice(1, -1) });
    else if (link) {
      const parts = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(link);
      const href = parts?.[2] ?? '';
      if (SAFE_HREF.test(href)) out.push({ kind: 'link', text: parts?.[1] ?? '', href });
      else out.push({ kind: 'text', text: whole });
    } else if (bold) out.push({ kind: 'bold', text: bold.slice(2, -2) });
    else if (italic) out.push({ kind: 'italic', text: italic.slice(1, -1) });
    last = at + whole.length;
  }
  if (last < line.length) out.push({ kind: 'text', text: line.slice(last) });
  return out;
}

/** Parse the published markdown subset. Everything it does not know stays literal text. */
export function parseNote(text: string): Block[] {
  const blocks: Block[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('- ')) {
      const last = blocks[blocks.length - 1];
      const item = parseInline(line.slice(2));
      if (last?.kind === 'list') last.items.push(item);
      else blocks.push({ kind: 'list', items: [item] });
    } else if (line.length > 0) {
      blocks.push({ kind: 'paragraph', inline: parseInline(line) });
    }
  }
  return blocks;
}

