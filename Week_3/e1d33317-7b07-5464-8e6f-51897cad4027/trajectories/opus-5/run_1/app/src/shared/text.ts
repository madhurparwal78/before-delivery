const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** User-perceived characters: an emoji, a family emoji or a flag counts as one. */
export function graphemeCount(text: string): number {
  let count = 0;
  for (const _ of segmenter.segment(text)) count += 1;
  return count;
}

export const TEXT_LIMIT = 200;

const ALLOWED = new Set(['i', 'b', 'br']);
const DROP_WITH_CONTENTS = new Set(['script', 'style']);

function escapeText(raw: string): string {
  return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface Tag {
  name: string;
  closing: boolean;
  end: number;
}

function readTag(source: string, at: number): Tag | null {
  const close = source.indexOf('>', at);
  if (close === -1) return null;
  const body = source.slice(at + 1, close);
  const match = /^\s*(\/?)\s*([A-Za-z][A-Za-z0-9]*)/.exec(body);
  if (!match) return null;
  return { name: match[2]!.toLowerCase(), closing: match[1] === '/', end: close + 1 };
}

/**
 * The expression text and lyrics allowlist: only italic, bold and line breaks survive.
 * This is the one place the stored form of a text field is decided.
 */
export function filterText(raw: string): string {
  let out = '';
  const open: string[] = [];
  let index = 0;
  while (index < raw.length) {
    const next = raw.indexOf('<', index);
    if (next === -1) {
      out += escapeText(raw.slice(index));
      break;
    }
    out += escapeText(raw.slice(index, next));
    const tag = readTag(raw, next);
    if (!tag) {
      out += '&lt;';
      index = next + 1;
      continue;
    }
    if (DROP_WITH_CONTENTS.has(tag.name)) {
      const closer = new RegExp(`</\\s*${tag.name}\\s*>`, 'i').exec(raw.slice(tag.end));
      index = closer ? tag.end + closer.index + closer[0].length : raw.length;
      continue;
    }
    if (ALLOWED.has(tag.name)) {
      if (tag.name === 'br') {
        out += '<br>';
      } else if (tag.closing) {
        const position = open.lastIndexOf(tag.name);
        if (position !== -1) {
          open.splice(position, 1);
          out += `</${tag.name}>`;
        }
      } else {
        open.push(tag.name);
        out += `<${tag.name}>`;
      }
    }
    index = tag.end;
  }
  for (const name of open.reverse()) out += `</${name}>`;
  return out;
}

/** The filtered text with its markup taken off, used for the length limit and for speech. */
export function textWithoutTags(filtered: string): string {
  return filtered
    .replace(/<br>/g, '\n')
    .replace(/<\/?[ib]>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
