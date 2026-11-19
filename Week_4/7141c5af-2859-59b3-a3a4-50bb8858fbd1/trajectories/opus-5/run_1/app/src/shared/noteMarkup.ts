/**
 * Pin-note markup. Bold, italic and links to http, https and mailto addresses
 * only; anything else, HTML and every other address included, is plain text.
 * The one renderer behind every screen, the client page and the PDF.
 */

export type Span =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'link'; text: string; href: string };

const ALLOWED_SCHEMES = ['http://', 'https://', 'mailto:'];

function isAllowedAddress(address: string): boolean {
  const lower = address.toLowerCase();
  return ALLOWED_SCHEMES.some((s) => lower.startsWith(s)) && !/[\s<>"]/.test(address);
}

/** The note's spans in order. Never throws and never drops a character. */
export function parseNote(note: string): Span[] {
  const spans: Span[] = [];
  let plain = '';
  let i = 0;

  const flush = (): void => {
    if (plain) {
      spans.push({ kind: 'text', text: plain });
      plain = '';
    }
  };

  while (i < note.length) {
    if (note.startsWith('**', i)) {
      const end = note.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        spans.push({ kind: 'bold', text: note.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    } else if (note[i] === '*') {
      const end = note.indexOf('*', i + 1);
      if (end > i + 1 && !note.startsWith('**', end)) {
        flush();
        spans.push({ kind: 'italic', text: note.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    } else if (note[i] === '[') {
      const close = note.indexOf(']', i + 1);
      if (close !== -1 && note[close + 1] === '(') {
        const paren = note.indexOf(')', close + 2);
        if (paren !== -1) {
          const text = note.slice(i + 1, close);
          const href = note.slice(close + 2, paren);
          if (isAllowedAddress(href)) {
            flush();
            spans.push({ kind: 'link', text, href });
            i = paren + 1;
            continue;
          }
        }
      }
    }
    plain += note[i];
    i += 1;
  }
  flush();
  return spans;
}

/**
 * Every attribute in this app is double-quoted, so a straight apostrophe is
 * left as itself and published copy prints character for character.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The note as HTML, with every address escaped and nothing else let through. */
export function noteToHtml(note: string): string {
  return parseNote(note)
    .map((span) => {
      switch (span.kind) {
        case 'bold':
          return `<strong>${escapeHtml(span.text)}</strong>`;
        case 'italic':
          return `<em>${escapeHtml(span.text)}</em>`;
        case 'link':
          return `<a href="${escapeHtml(span.href)}" rel="noreferrer noopener">${escapeHtml(span.text)}</a>`;
        case 'text':
          return escapeHtml(span.text);
      }
    })
    .join('');
}

/** The note with its markup dropped, for a plain-text setting. */
export function noteToText(note: string): string {
  return parseNote(note)
    .map((span) => span.text)
    .join('');
}
