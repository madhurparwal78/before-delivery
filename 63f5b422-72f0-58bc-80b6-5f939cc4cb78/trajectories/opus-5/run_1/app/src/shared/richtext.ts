const ALLOWED = new Set(['p', 'strong', 'em', 'ul', 'ol', 'li', 'a']);
const SAFE_HREF = /^(https?:|mailto:)/i;

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escapes text content; attributes use escapeHtml. */
export function escapeTextContent(text: string): string {
  return escapeText(text);
}

export function escapeHtml(text: string): string {
  return escapeText(text).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function hrefOf(attrs: string): string | undefined {
  const m = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
  if (!m) return undefined;
  const raw = decodeEntities((m[2] ?? m[3] ?? m[4] ?? '').trim());
  return SAFE_HREF.test(raw) ? raw : undefined;
}

/**
 * Keeps only the allowlisted markup. Every other element is dropped while its
 * text is kept, and every other attribute is dropped.
 */
export function filterRichText(input: string): string {
  const open: string[] = [];
  let out = '';
  let i = 0;
  while (i < input.length) {
    const lt = input.indexOf('<', i);
    if (lt === -1) {
      out += escapeText(decodeEntities(input.slice(i)));
      break;
    }
    out += escapeText(decodeEntities(input.slice(i, lt)));
    const gt = input.indexOf('>', lt);
    if (gt === -1) {
      out += escapeText(decodeEntities(input.slice(lt)));
      break;
    }
    const inner = input.slice(lt + 1, gt);
    i = gt + 1;
    if (inner.startsWith('!')) continue;
    const closing = inner.startsWith('/');
    const body = closing ? inner.slice(1) : inner;
    const nameMatch = /^([a-zA-Z][a-zA-Z0-9]*)/.exec(body.trim());
    if (!nameMatch) continue;
    const tag = nameMatch[1]!.toLowerCase();
    if (!ALLOWED.has(tag)) continue;
    if (closing) {
      const at = open.lastIndexOf(tag);
      if (at === -1) continue;
      while (open.length > at) out += `</${open.pop()!}>`;
      continue;
    }
    if (tag === 'a') {
      const href = hrefOf(body.slice(nameMatch[1]!.length));
      if (href === undefined) continue;
      out += `<a href="${escapeHtml(href)}">`;
    } else {
      out += `<${tag}>`;
    }
    open.push(tag);
  }
  while (open.length > 0) out += `</${open.pop()!}>`;
  return out;
}

/** Plain text of a filtered rich-text value, for lengths and names. */
export function richTextToPlain(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ''));
}
