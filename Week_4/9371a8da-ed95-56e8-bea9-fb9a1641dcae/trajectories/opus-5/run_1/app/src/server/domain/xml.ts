export interface XmlAttribute {
  name: string;
  value: string;
}

export interface XmlElement {
  name: string;
  attributes: XmlAttribute[];
  children: XmlElement[];
  text: string;
}

export interface XmlDocument {
  root: XmlElement;
  hasDoctypeOrEntityDeclaration: boolean;
}

const NAME_START = /[A-Za-z_:]/;
const NAME_PART = /[A-Za-z0-9_:.\-]/;

export function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon < 0 ? name : name.slice(colon + 1);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Decodes the character and standard entity references of an attribute value. */
export function decodeReferences(value: string): string {
  if (!value.includes('&')) return value;
  let out = '';
  let index = 0;
  while (index < value.length) {
    const amp = value.indexOf('&', index);
    if (amp < 0) {
      out += value.slice(index);
      break;
    }
    out += value.slice(index, amp);
    const semicolon = value.indexOf(';', amp);
    if (semicolon < 0) {
      out += value.slice(amp);
      break;
    }
    const body = value.slice(amp + 1, semicolon);
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      out += Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : `&${body};`;
    } else if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      out += Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : `&${body};`;
    } else if (NAMED_ENTITIES[body] !== undefined) {
      out += NAMED_ENTITIES[body];
    } else {
      out += `&${body};`;
    }
    index = semicolon + 1;
  }
  return out;
}

class XmlSyntaxError extends Error {}

/** A strict enough XML reader: it accepts only well-formed documents. */
export function parseXml(source: string): XmlDocument | null {
  try {
    return read(source);
  } catch (error) {
    if (error instanceof XmlSyntaxError || error instanceof RangeError) return null;
    throw error;
  }
}

function read(source: string): XmlDocument {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  let index = 0;
  let hasDoctypeOrEntityDeclaration = false;
  let root: XmlElement | null = null;
  const stack: XmlElement[] = [];

  const fail = (): never => {
    throw new XmlSyntaxError('malformed xml');
  };

  const readName = (): string => {
    if (index >= text.length || !NAME_START.test(text.charAt(index))) fail();
    const start = index;
    index += 1;
    while (index < text.length && NAME_PART.test(text.charAt(index))) index += 1;
    return text.slice(start, index);
  };

  const skipSpace = (): void => {
    while (index < text.length && /[\s]/.test(text.charAt(index))) index += 1;
  };

  while (index < text.length) {
    const lt = text.indexOf('<', index);
    if (lt < 0) {
      if (stack.length > 0) fail();
      if (text.slice(index).trim() !== '') fail();
      break;
    }
    const chunk = text.slice(index, lt);
    if (stack.length === 0 && chunk.trim() !== '') fail();
    if (stack.length > 0) stack[stack.length - 1].text += chunk;
    index = lt;

    if (text.startsWith('<!--', index)) {
      const end = text.indexOf('-->', index + 4);
      if (end < 0) fail();
      index = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', index)) {
      const end = text.indexOf(']]>', index + 9);
      if (end < 0) fail();
      if (stack.length === 0) fail();
      stack[stack.length - 1].text += text.slice(index + 9, end);
      index = end + 3;
      continue;
    }
    if (text.startsWith('<!DOCTYPE', index) || text.startsWith('<!ENTITY', index)) {
      hasDoctypeOrEntityDeclaration = true;
      let depth = 0;
      let cursor = index;
      while (cursor < text.length) {
        const ch = text.charAt(cursor);
        if (ch === '[') depth += 1;
        else if (ch === ']') depth -= 1;
        else if (ch === '>' && depth <= 0) break;
        cursor += 1;
      }
      if (cursor >= text.length) fail();
      index = cursor + 1;
      continue;
    }
    if (text.startsWith('<?', index)) {
      const end = text.indexOf('?>', index + 2);
      if (end < 0) fail();
      index = end + 2;
      continue;
    }
    if (text.startsWith('</', index)) {
      index += 2;
      const name = readName();
      skipSpace();
      if (text.charAt(index) !== '>') fail();
      index += 1;
      const open = stack.pop();
      if (open === undefined || open.name !== name) fail();
      continue;
    }

    index += 1;
    const name = readName();
    const element: XmlElement = { name, attributes: [], children: [], text: '' };
    const seen = new Set<string>();
    let selfClosing = false;
    for (;;) {
      const before = index;
      skipSpace();
      if (text.startsWith('/>', index)) {
        index += 2;
        selfClosing = true;
        break;
      }
      if (text.charAt(index) === '>') {
        index += 1;
        break;
      }
      if (index === before) fail();
      const attributeName = readName();
      if (seen.has(attributeName)) fail();
      seen.add(attributeName);
      skipSpace();
      if (text.charAt(index) !== '=') fail();
      index += 1;
      skipSpace();
      const quote = text.charAt(index);
      if (quote !== '"' && quote !== "'") fail();
      const end = text.indexOf(quote, index + 1);
      if (end < 0) fail();
      element.attributes.push({ name: attributeName, value: text.slice(index + 1, end) });
      index = end + 1;
    }

    if (stack.length > 0) {
      stack[stack.length - 1].children.push(element);
    } else if (root === null) {
      root = element;
    } else {
      fail();
    }
    if (!selfClosing) stack.push(element);
  }

  if (stack.length > 0 || root === null) fail();
  return { root: root as XmlElement, hasDoctypeOrEntityDeclaration };
}

export function walk(element: XmlElement, visit: (node: XmlElement) => void): void {
  visit(element);
  for (const child of element.children) walk(child, visit);
}
