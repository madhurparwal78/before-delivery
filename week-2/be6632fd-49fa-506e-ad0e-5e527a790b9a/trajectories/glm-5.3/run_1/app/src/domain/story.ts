// The story allowlist: only the published elements, and http, https and mailto
// links. Decided here alone. This module is Node-only (no DOM dependency).
export function sanitizeStory(html: string): { html: string } {
  return { html: sanitizeHtml(html) };
}

const ALLOWED_TAGS = new Set(['p', 'h2', 'h3', 'strong', 'em', 'ul', 'ol', 'li', 'br', 'a']);
const DROP_CONTENT_TAGS = new Set(['script', 'style', 'iframe']);

// A strict, small HTML tokeniser and serialiser for the story allowlist.
export function sanitizeHtml(input: string): string {
  const out: string[] = [];
  const stack: string[] = [];
  let i = 0;
  let skip: string | null = null;
  while (i < input.length) {
    if (input[i] !== '<') {
      if (skip === null) out.push(escapeText(input[i]));
      i += 1;
      continue;
    }
    const close = input.indexOf('>', i);
    if (close === -1) {
      if (skip === null) out.push(escapeText(input.slice(i)));
      break;
    }
    const raw = input.slice(i + 1, close);
    i = close + 1;

    const tag = tagOf(raw);
    const isClose = raw.startsWith('/');
    const isOpen = /^[a-zA-Z]/.test(raw);
    const isSpecial = raw.startsWith('!') || raw.startsWith('?');

    if (skip !== null) {
      // Inside a dropped-content element: only its matching close ends the skip.
      if (isClose && tag === skip) skip = null;
      else if (isOpen && tag !== '' && DROP_CONTENT_TAGS.has(tag)) skip = tag;
      continue;
    }
    if (isSpecial) continue;
    if (isClose) {
      const idx = stack.lastIndexOf(tag);
      if (idx !== -1) {
        while (stack.length > idx) {
          const t = stack.pop()!;
          if (t !== 'br' && t !== '__stripped__') out.push(`</${t}>`);
        }
      }
      continue;
    }
    if (tag === '') continue;
    if (DROP_CONTENT_TAGS.has(tag)) { skip = tag; continue; }
    if (!ALLOWED_TAGS.has(tag)) continue; // not allowed: drop the tag, keep content
    if (tag === 'br') { out.push('<br>'); continue; }
    if (tag === 'a') {
      const href = hrefOf(raw);
      if (href !== null) {
        out.push(`<a href="${escapeAttr(href)}">`);
        stack.push('a');
      } else {
        stack.push('__stripped__'); // a link with any other scheme loses the link, keeps its text
      }
      continue;
    }
    out.push(`<${tag}>`);
    stack.push(tag);
  }
  for (let k = stack.length - 1; k >= 0; k--) {
    const t = stack[k];
    if (t !== 'br' && t !== '__stripped__') out.push(`</${t}>`);
  }
  return out.join('');
}

function tagOf(raw: string): string {
  const m = /^\/?\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(raw);
  return m ? m[1].toLowerCase() : '';
}

function hrefOf(raw: string): string | null {
  const m = /[\s"']href[\s"']*=\s*("([^"]*)"|'([^']*)'|([^\s"']*))/.exec(raw);
  if (!m) return null;
  const href = (m[2] ?? m[3] ?? m[4] ?? '').trim();
  if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return href;
  return null;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeText(s: string): string {
  return s.replace(/&(?![a-zA-Z]+;|#[0-9]+;|#x[0-9a-fA-F]+;)/g, '&amp;').replace(/</g, '&lt;');
}
