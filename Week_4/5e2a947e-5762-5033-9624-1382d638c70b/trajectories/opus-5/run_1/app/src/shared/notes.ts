import { copy } from './copy.js';

const LINK_PATTERN = /\[([^\]]*)\]\(([^)]*)\)/g;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isAllowedNoteUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

/** Returns the link-scheme message when a note carries a link outside the published schemes. */
export function noteError(text: string): string | null {
  LINK_PATTERN.lastIndex = 0;
  let match = LINK_PATTERN.exec(text);
  while (match !== null) {
    if (!isAllowedNoteUrl(match[2])) return copy.linkScheme;
    match = LINK_PATTERN.exec(text);
  }
  return null;
}

function renderInline(line: string): string {
  let out = '';
  let i = 0;
  const chars = [...line];
  const find = (token: string, from: number): number => {
    for (let j = from; j <= chars.length - token.length; j += 1) {
      if (chars.slice(j, j + token.length).join('') === token) return j;
    }
    return -1;
  };
  while (i < chars.length) {
    const ch = chars[i];
    if (ch === '`') {
      const end = find('`', i + 1);
      if (end > i) {
        out += `<code>${escapeHtml(chars.slice(i + 1, end).join(''))}</code>`;
        i = end + 1;
        continue;
      }
    }
    if (ch === '*' && chars[i + 1] === '*') {
      const end = find('**', i + 2);
      if (end > i) {
        out += `<strong>${renderInline(chars.slice(i + 2, end).join(''))}</strong>`;
        i = end + 2;
        continue;
      }
    }
    if (ch === '*') {
      const end = find('*', i + 1);
      if (end > i) {
        out += `<em>${renderInline(chars.slice(i + 1, end).join(''))}</em>`;
        i = end + 1;
        continue;
      }
    }
    if (ch === '[') {
      const rest = chars.slice(i).join('');
      const match = /^\[([^\]]*)\]\(([^)]*)\)/.exec(rest);
      if (match && isAllowedNoteUrl(match[2])) {
        out += `<a href="${escapeHtml(match[2])}" target="_blank" rel="noopener noreferrer nofollow">${renderInline(match[1])}</a>`;
        i += match[0].length;
        continue;
      }
    }
    out += escapeHtml(ch);
    i += 1;
  }
  return out;
}

/** Renders the published markdown subset. Everything else shows as literal text. */
export function renderNote(text: string): string {
  const lines = text.split('\n');
  const blocks: string[] = [];
  let bullets: string[] = [];
  const flush = (): void => {
    if (bullets.length > 0) {
      blocks.push(`<ul>${bullets.map((item) => `<li>${item}</li>`).join('')}</ul>`);
      bullets = [];
    }
  };
  for (const line of lines) {
    if (line.startsWith('- ')) {
      bullets.push(renderInline(line.slice(2)));
      continue;
    }
    flush();
    if (line.trim() === '') continue;
    blocks.push(`<p>${renderInline(line)}</p>`);
  }
  flush();
  return blocks.join('');
}
