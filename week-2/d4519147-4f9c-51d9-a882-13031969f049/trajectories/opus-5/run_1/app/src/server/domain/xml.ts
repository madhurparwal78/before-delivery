/**
 * A bounded XML reader. It expands no entity, fetches nothing, and refuses a
 * document that exceeds the published depth, element, attribute or text-length
 * limits before anything else looks at the document.
 */

export const PARSE_LIMITS = {
  depth: 64,
  elements: 20000,
  attributesPerElement: 64,
  textLength: 10000,
} as const;

export class XmlParseLimitError extends Error {}
export class XmlNotWellFormedError extends Error {}

export interface XmlAttribute {
  name: string;
  prefix: string;
  localName: string;
  value: string;
}

export interface XmlElement {
  name: string;
  prefix: string;
  localName: string;
  namespace: string;
  attributes: XmlAttribute[];
  children: XmlElement[];
  text: string;
}

export interface XmlDocument {
  root: XmlElement;
  hasDoctype: boolean;
  extraProcessingInstructions: number;
}

export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const NAMED_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

/** Decodes the five predefined entities and numeric character references only. */
export function decodeCharacterReferences(raw: string): string {
  return raw.replace(/&(#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? safeFromCodePoint(code, match) : match;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? safeFromCodePoint(code, match) : match;
    }
    const named = NAMED_ENTITIES[body];
    return named ?? match;
  });
}

function safeFromCodePoint(code: number, fallback: string): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}

function splitName(name: string): { prefix: string; localName: string } {
  const colon = name.indexOf(':');
  if (colon === -1) return { prefix: '', localName: name };
  return { prefix: name.slice(0, colon), localName: name.slice(colon + 1) };
}

function decodeUtf8(bytes: Buffer): string {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    return decoder.decode(bytes);
  } catch {
    throw new XmlNotWellFormedError('not utf-8');
  }
}

const NAME_CHAR = /[A-Za-z0-9_.:\-\u00c0-\uffff]/;

export function parseXml(bytes: Buffer): XmlDocument {
  let source = decodeUtf8(bytes);
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);

  let index = 0;
  let elementCount = 0;
  let hasDoctype = false;
  let extraProcessingInstructions = 0;
  let sawDeclaration = false;
  let sawFirstToken = false;
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;

  const skipWhitespace = (): void => {
    while (index < source.length && /\s/.test(source[index] ?? '')) index += 1;
  };

  const readName = (): string => {
    const start = index;
    while (index < source.length && NAME_CHAR.test(source[index] ?? '')) index += 1;
    if (index === start) throw new XmlNotWellFormedError('expected a name');
    return source.slice(start, index);
  };

  const resolveNamespace = (element: XmlElement, parents: XmlElement[]): string => {
    const chain = [...parents, element];
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const candidate = chain[i];
      if (!candidate) continue;
      for (const attribute of candidate.attributes) {
        if (element.prefix === '' && attribute.name === 'xmlns') return attribute.value;
        if (element.prefix !== '' && attribute.prefix === 'xmlns' && attribute.localName === element.prefix) {
          return attribute.value;
        }
      }
    }
    return '';
  };

  const appendText = (text: string): void => {
    if (text.length > PARSE_LIMITS.textLength) throw new XmlParseLimitError('text too long');
    const parent = stack[stack.length - 1];
    if (!parent) return;
    parent.text += decodeCharacterReferences(text);
  };

  skipWhitespace();
  if (source[index] !== '<') throw new XmlNotWellFormedError('no root element');

  while (index < source.length) {
    if (source[index] === '<') {
      if (source.startsWith('<!--', index)) {
        const end = source.indexOf('-->', index + 4);
        if (end === -1) throw new XmlNotWellFormedError('unterminated comment');
        index = end + 3;
        sawFirstToken = true;
        continue;
      }
      if (source.startsWith('<![CDATA[', index)) {
        const end = source.indexOf(']]>', index + 9);
        if (end === -1) throw new XmlNotWellFormedError('unterminated cdata');
        const text = source.slice(index + 9, end);
        if (text.length > PARSE_LIMITS.textLength) throw new XmlParseLimitError('text too long');
        const parent = stack[stack.length - 1];
        if (parent) parent.text += text;
        index = end + 3;
        sawFirstToken = true;
        continue;
      }
      if (source.startsWith('<!DOCTYPE', index) || source.startsWith('<!doctype', index)) {
        hasDoctype = true;
        index = skipDoctype(source, index);
        sawFirstToken = true;
        continue;
      }
      if (source.startsWith('<?', index)) {
        const end = source.indexOf('?>', index + 2);
        if (end === -1) throw new XmlNotWellFormedError('unterminated processing instruction');
        const body = source.slice(index + 2, end);
        const isDeclaration = /^xml(\s|$)/i.test(body);
        if (isDeclaration && !sawFirstToken && !sawDeclaration) sawDeclaration = true;
        else extraProcessingInstructions += 1;
        index = end + 2;
        sawFirstToken = true;
        continue;
      }
      if (source.startsWith('</', index)) {
        index += 2;
        const name = readName();
        skipWhitespace();
        if (source[index] !== '>') throw new XmlNotWellFormedError('bad end tag');
        index += 1;
        const open = stack.pop();
        if (!open || open.name !== name) throw new XmlNotWellFormedError('mismatched end tag');
        sawFirstToken = true;
        continue;
      }

      index += 1;
      const name = readName();
      const { prefix, localName } = splitName(name);
      const element: XmlElement = {
        name,
        prefix,
        localName,
        namespace: '',
        attributes: [],
        children: [],
        text: '',
      };
      elementCount += 1;
      if (elementCount > PARSE_LIMITS.elements) throw new XmlParseLimitError('too many elements');

      for (;;) {
        skipWhitespace();
        const char = source[index];
        if (char === undefined) throw new XmlNotWellFormedError('unterminated start tag');
        if (char === '>' || char === '/') break;
        const attributeName = readName();
        skipWhitespace();
        if (source[index] !== '=') throw new XmlNotWellFormedError('attribute without a value');
        index += 1;
        skipWhitespace();
        const quote = source[index];
        if (quote !== '"' && quote !== "'") throw new XmlNotWellFormedError('unquoted attribute value');
        index += 1;
        const end = source.indexOf(quote, index);
        if (end === -1) throw new XmlNotWellFormedError('unterminated attribute value');
        const rawValue = source.slice(index, end);
        if (rawValue.length > PARSE_LIMITS.textLength) throw new XmlParseLimitError('attribute value too long');
        index = end + 1;
        const split = splitName(attributeName);
        element.attributes.push({
          name: attributeName,
          prefix: split.prefix,
          localName: split.localName,
          value: decodeCharacterReferences(rawValue),
        });
        if (element.attributes.length > PARSE_LIMITS.attributesPerElement) {
          throw new XmlParseLimitError('too many attributes');
        }
      }

      const selfClosing = source[index] === '/';
      if (selfClosing) index += 1;
      if (source[index] !== '>') throw new XmlNotWellFormedError('bad start tag');
      index += 1;

      element.namespace = resolveNamespace(element, stack);
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(element);
      else if (root) throw new XmlNotWellFormedError('more than one root element');
      else root = element;

      if (!selfClosing) {
        stack.push(element);
        if (stack.length > PARSE_LIMITS.depth) throw new XmlParseLimitError('too deep');
      }
      sawFirstToken = true;
      continue;
    }

    const next = source.indexOf('<', index);
    const text = next === -1 ? source.slice(index) : source.slice(index, next);
    appendText(text);
    index = next === -1 ? source.length : next;
    if (text.trim().length > 0) sawFirstToken = true;
  }

  if (stack.length > 0) throw new XmlNotWellFormedError('unclosed element');
  if (!root) throw new XmlNotWellFormedError('no root element');
  return { root, hasDoctype, extraProcessingInstructions };
}

function skipDoctype(source: string, start: number): number {
  let index = start + '<!DOCTYPE'.length;
  let depth = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '[') depth += 1;
    else if (char === ']') depth -= 1;
    else if (char === '>' && depth <= 0) return index + 1;
    index += 1;
  }
  throw new XmlNotWellFormedError('unterminated doctype');
}

export function* walkElements(element: XmlElement): Generator<XmlElement> {
  yield element;
  for (const child of element.children) yield* walkElements(child);
}

export function attributeValue(element: XmlElement, localName: string): string | null {
  for (const attribute of element.attributes) {
    if (attribute.localName === localName && attribute.prefix === '') return attribute.value;
  }
  return null;
}

export function childByLocalName(element: XmlElement, localName: string): XmlElement | null {
  for (const child of element.children) {
    if (child.localName.toLowerCase() === localName.toLowerCase()) return child;
  }
  return null;
}
