const ALLOWED_ELEMENTS = new Set(['p', 'h2', 'h3', 'strong', 'em', 'ul', 'ol', 'li', 'br', 'a']);
const VOID_ELEMENTS = new Set(['br']);
/** Elements whose text is dropped along with the element. */
const OPAQUE_ELEMENTS = new Set(['script', 'style', 'iframe']);
const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:'];

type Token =
  | { kind: 'text'; value: string }
  | { kind: 'open'; name: string; attributes: Map<string, string>; selfClosing: boolean }
  | { kind: 'close'; name: string };

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isNaN(code) ? whole : safeCodePoint(code, whole);
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isNaN(code) ? whole : safeCodePoint(code, whole);
    }
    const named = ENTITIES[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

function safeCodePoint(code: number, fallback: string): string {
  if (code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return fallback;
  return String.fromCodePoint(code);
}

export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let text = '';
  const flush = (): void => {
    if (text !== '') {
      tokens.push({ kind: 'text', value: text });
      text = '';
    }
  };

  while (index < html.length) {
    const next = html.indexOf('<', index);
    if (next === -1) {
      text += html.slice(index);
      break;
    }
    text += html.slice(index, next);
    const rest = html.slice(next);

    if (rest.startsWith('<!--')) {
      const end = html.indexOf('-->', next + 4);
      index = end === -1 ? html.length : end + 3;
      continue;
    }
    if (rest.startsWith('<!') || rest.startsWith('<?')) {
      const end = html.indexOf('>', next + 2);
      index = end === -1 ? html.length : end + 1;
      continue;
    }
    const closing = /^<\/([a-zA-Z][a-zA-Z0-9]*)\s*>/.exec(rest);
    if (closing) {
      flush();
      tokens.push({ kind: 'close', name: (closing[1] as string).toLowerCase() });
      index = next + closing[0].length;
      continue;
    }
    const opening = /^<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s/>=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]*))?)*)\s*(\/?)>/.exec(
      rest,
    );
    if (opening) {
      flush();
      tokens.push({
        kind: 'open',
        name: (opening[1] as string).toLowerCase(),
        attributes: parseAttributes(opening[2] as string),
        selfClosing: opening[3] === '/',
      });
      index = next + opening[0].length;
      continue;
    }
    text += '<';
    index = next + 1;
  }
  flush();
  return tokens;
}

function parseAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([^\s/>=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]*)))?/g;
  let match = pattern.exec(source);
  while (match !== null) {
    const name = (match[1] as string).toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (!attributes.has(name)) attributes.set(name, decodeEntities(value));
    match = pattern.exec(source);
  }
  return attributes;
}

function allowedHref(value: string): string | null {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed, 'http://hourline.invalid/');
  } catch {
    return null;
  }
  // A relative address resolves against the placeholder base, so compare the written scheme.
  const written = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (written === null) return null;
  const scheme = `${(written[1] as string).toLowerCase()}:`;
  if (!ALLOWED_SCHEMES.includes(scheme)) return null;
  return url.protocol === scheme ? trimmed : null;
}

/**
 * The story allowlist: keeps only the published elements and http, https and mailto links.
 *
 * Elements outside the list lose their tags but keep their text, except script, style and iframe,
 * whose content is dropped too. A link with any other scheme loses the link and keeps its text.
 */
export function sanitiseStory(html: string): string {
  const tokens = tokenize(html);
  const open: string[] = [];
  let output = '';
  let opaqueDepth = 0;
  let opaqueName = '';

  for (const token of tokens) {
    if (opaqueDepth > 0) {
      if (token.kind === 'open' && token.name === opaqueName && !token.selfClosing) opaqueDepth += 1;
      if (token.kind === 'close' && token.name === opaqueName) opaqueDepth -= 1;
      continue;
    }
    if (token.kind === 'text') {
      output += escapeText(decodeEntities(token.value));
      continue;
    }
    if (token.kind === 'open') {
      if (OPAQUE_ELEMENTS.has(token.name)) {
        if (!token.selfClosing) {
          opaqueDepth = 1;
          opaqueName = token.name;
        }
        continue;
      }
      if (!ALLOWED_ELEMENTS.has(token.name)) continue;
      if (VOID_ELEMENTS.has(token.name)) {
        output += `<${token.name}>`;
        continue;
      }
      if (token.name === 'a') {
        const href = allowedHref(token.attributes.get('href') ?? '');
        if (href === null) continue;
        output += `<a href="${escapeAttribute(href)}">`;
        open.push('a');
        continue;
      }
      output += `<${token.name}>`;
      open.push(token.name);
      continue;
    }
    if (VOID_ELEMENTS.has(token.name) || !ALLOWED_ELEMENTS.has(token.name)) continue;
    const at = open.lastIndexOf(token.name);
    if (at === -1) continue;
    while (open.length > at) {
      output += `</${open.pop() as string}>`;
    }
  }
  while (open.length > 0) {
    output += `</${open.pop() as string}>`;
  }
  return output;
}
