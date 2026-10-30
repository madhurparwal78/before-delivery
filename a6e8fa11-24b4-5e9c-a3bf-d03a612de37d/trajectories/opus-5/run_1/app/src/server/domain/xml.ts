export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_match: string, entity: string) => {
    switch (entity) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default:
        return entity.startsWith('#x')
          ? String.fromCodePoint(parseInt(entity.slice(2), 16))
          : String.fromCodePoint(Number(entity.slice(1)));
    }
  });
}

const ATTR_RE = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"|([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*'([^']*)'/g;

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  for (;;) {
    const match = ATTR_RE.exec(source);
    if (!match) break;
    const name = match[1] ?? match[3];
    const value = match[2] ?? match[4];
    attrs[name] = unescapeXml(value);
  }
  return attrs;
}

/** A small pull parser: enough for the parts of an xlsx package this app reads. */
export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let at = 0;
  while (at < source.length) {
    const open = source.indexOf('<', at);
    if (open < 0) break;
    if (open > at) {
      const text = source.slice(at, open);
      const current = stack[stack.length - 1];
      current.text += unescapeXml(text);
    }
    if (source.startsWith('<!--', open)) {
      at = source.indexOf('-->', open);
      at = at < 0 ? source.length : at + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', open)) {
      const end = source.indexOf(']]>', open);
      const stop = end < 0 ? source.length : end;
      stack[stack.length - 1].text += source.slice(open + 9, stop);
      at = stop + 3;
      continue;
    }
    if (source.startsWith('<?', open) || source.startsWith('<!', open)) {
      const close = source.indexOf('>', open);
      at = close < 0 ? source.length : close + 1;
      continue;
    }
    const close = source.indexOf('>', open);
    if (close < 0) break;
    const inner = source.slice(open + 1, close);
    at = close + 1;
    if (inner.startsWith('/')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const space = body.search(/\s/);
    const name = space < 0 ? body : body.slice(0, space);
    const node: XmlNode = {
      name,
      attrs: space < 0 ? {} : parseAttrs(body.slice(space)),
      children: [],
      text: '',
    };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
}

export function findChild(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((child) => localName(child.name) === name);
}

export function findChildren(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child) => localName(child.name) === name);
}

export function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon < 0 ? name : name.slice(colon + 1);
}
