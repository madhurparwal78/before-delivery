/**
 * SVG upload checks, judged on the parsed XML.
 */

interface ParsedElement {
  localName: string;
  attributes: Map<string, string>;
  children: ParsedElement[];
}

class SaxesError extends Error {}

/** Minimal namespace-aware XML parser (subset: elements, attributes, comments, CDATA). */
function parseXml(text: string): { root: ParsedElement | null; refused: string | null } {
  // Reject DOCTYPE and entity declarations before parsing.
  if (/<(!DOCTYPE|!\s*DOCTYPE)/i.test(text)) return { root: null, refused: 'doctype' };
  const entityDecl = /<!ENTITY\s/i.test(text);
  if (entityDecl) return { root: null, refused: 'entity' };

  let i = 0;
  const stack: ParsedElement[] = [];
  let root: ParsedElement | null = null;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt);
      if (end < 0) return { root: null, refused: 'unbalanced' };
      i = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt);
      if (end < 0) return { root: null, refused: 'unbalanced' };
      i = end + 3;
      continue;
    }
    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt);
      if (end < 0) return { root: null, refused: 'unbalanced' };
      i = end + 2;
      continue;
    }
    if (text.startsWith('</', lt)) {
      const end = text.indexOf('>', lt);
      if (end < 0) return { root: null, refused: 'unbalanced' };
      const raw = text.slice(lt + 2, end).trim();
      const top = stack.pop();
      if (!top) return { root: null, refused: 'unbalanced' };
      i = end + 1;
      continue;
    }
    // Start or empty element
    const end = findTagEnd(text, lt);
    if (end < 0) return { root: null, refused: 'unbalanced' };
    const inner = text.slice(lt + 1, end);
    const selfClose = inner.endsWith('/');
    const body = selfClose ? inner.slice(0, -1) : inner;
    const { name, attrs } = parseTagBody(body);
    const el: ParsedElement = { localName: name, attributes: attrs, children: [] };
    if (stack.length === 0) {
      if (root) return { root: null, refused: 'multiple roots' };
      root = el;
    } else {
      stack[stack.length - 1].children.push(el);
    }
    if (!selfClose) stack.push(el);
    i = end + 1;
  }
  if (stack.length > 0) return { root: null, refused: 'unbalanced' };
  return { root, refused: null };
}

function findTagEnd(text: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i;
  }
  return -1;
}

function parseTagBody(body: string): { name: string; attrs: Map<string, string> } {
  const nameMatch = /^[A-Za-z_][\w.:-]*/.exec(body);
  const name = nameMatch ? nameMatch[0] : '';
  const attrs = new Map<string, string>();
  const re = /([A-Za-z_][\w.:-]*)(?::[A-Za-z_][\w.:-]*)?\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const rawName = m[1];
    const prefixMatch = /^([A-Za-z_][\w.-]*):/.exec(body.slice(m.index));
    const prefix = prefixMatch ? prefixMatch[1] : '';
    const fullName = prefix ? `${prefix}:${rawName}` : rawName;
    const value = m[3] !== undefined ? m[3] : m[4] ?? '';
    attrs.set(fullName, value);
  }
  return { name, attrs };
}

function localName(fullName: string): string {
  const i = fullName.indexOf(':');
  return i < 0 ? fullName : fullName.slice(i + 1);
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (all, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = parseInt(body.slice(2), 16);
      return String.fromCodePoint(code);
    }
    if (body.startsWith('#')) {
      return String.fromCodePoint(parseInt(body.slice(1), 10));
    }
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    return named[body] ?? all;
  });
}

function normaliseValue(v: string): string {
  return decodeEntities(v).replace(/[\s\x00-\x1f]+/g, '').toLowerCase();
}

function isOutsideReference(value: string): boolean {
  const v = normaliseValue(value);
  if (v.startsWith('#')) return false;
  return true;
}

/** Returns null when the SVG is allowed, otherwise a refusal reason. */
export function checkSvg(bytes: Uint8Array): string | null {
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const { root, refused } = parseXml(decoded);
  if (refused) return refused;
  if (!root) return 'no root';
  if (localName(root.localName) !== 'svg') return 'root not svg';

  const walk = (el: ParsedElement): string | null => {
    const ln = localName(el.localName);
    if (ln === 'script' || ln === 'foreignObject') return ln;
    for (const [fullName, value] of el.attributes) {
      const an = localName(fullName);
      const isNs = fullName === 'xmlns' || fullName.startsWith('xmlns:');
      if (isNs) continue;
      if (an.startsWith('on')) return `attribute ${an}`;
      const nv = normaliseValue(value);
      if (an === 'href' || an === 'src') {
        if (isOutsideReference(value)) return `outside ${an}`;
      }
      if (nv.startsWith('javascript:')) return 'javascript url';
      if (an === 'style') {
        const urls = /url\(([^)]*)\)/g;
        let m: RegExpExecArray | null;
        while ((m = urls.exec(value))) {
          const inner = m[1].replace(/^['"]|['"]$/g, '');
          if (isOutsideReference(inner)) return 'outside style url';
        }
      }
    }
    for (const child of el.children) {
      const r = walk(child);
      if (r) return r;
    }
    return null;
  };
  return walk(root);
}
