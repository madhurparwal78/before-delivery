/**
 * The single home of the rich text allowlist, the stored body (canonical form),
 * the edit text and the plain text of a block.
 */

export const ALLOWED_ELEMENTS = [
  'p',
  'br',
  'strong',
  'em',
  'code',
  'a',
  'ul',
  'ol',
  'li',
  'blockquote',
] as const;

export const DROPPED_WITH_CONTENT = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'template',
  'noscript',
] as const;

export const ALLOWED_LINK_SCHEMES = ['http', 'https', 'mailto'] as const;

export const LINK_REL = 'noopener noreferrer nofollow';

export const BLOCK_BODY_MAX_CHARS = 20_000;

export type Mark = { strong: boolean; em: boolean; code: boolean; href: string | null };

export type ContainerKind = 'p' | 'li-ul' | 'li-ol' | 'blockquote';

export type FlatItem =
  | { kind: 'text'; ch: string; mark: Mark; container: ContainerKind }
  | { kind: 'br'; container: ContainerKind }
  | { kind: 'boundary'; container: ContainerKind };

export const PLAIN_MARK: Mark = { strong: false, em: false, code: false, href: null };

export function sameMark(a: Mark, b: Mark): boolean {
  return a.strong === b.strong && a.em === b.em && a.code === b.code && a.href === b.href;
}

function cloneMark(m: Mark): Mark {
  return { strong: m.strong, em: m.em, code: m.code, href: m.href };
}

/* ------------------------------------------------------------------ parsing */

type RawNode =
  | { type: 'text'; text: string }
  | { type: 'element'; name: string; attrs: Record<string, string>; children: RawNode[] };

const VOID_ELEMENTS = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'source', 'area']);

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const named: Record<string, string> = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
      nbsp: '\u00a0',
      '#39': "'",
    };
    const hit = named[body.toLowerCase()];
    return hit === undefined ? whole : hit;
  });
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s"'>/=]+)(\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[4] ?? match[5] ?? match[6] ?? '';
    if (!(name in attrs)) attrs[name] = decodeEntities(value);
  }
  return attrs;
}

export function parseHtml(input: string): RawNode[] {
  const root: { type: 'element'; name: string; attrs: Record<string, string>; children: RawNode[] } = {
    type: 'element',
    name: '#root',
    attrs: {},
    children: [],
  };
  const stack = [root];
  let index = 0;
  const pushText = (text: string) => {
    if (text.length === 0) return;
    stack[stack.length - 1].children.push({ type: 'text', text: decodeEntities(text) });
  };
  while (index < input.length) {
    const lt = input.indexOf('<', index);
    if (lt === -1) {
      pushText(input.slice(index));
      break;
    }
    pushText(input.slice(index, lt));
    if (input.startsWith('<!--', lt)) {
      const end = input.indexOf('-->', lt + 4);
      index = end === -1 ? input.length : end + 3;
      continue;
    }
    if (input.startsWith('<!', lt) || input.startsWith('<?', lt)) {
      const end = input.indexOf('>', lt + 2);
      index = end === -1 ? input.length : end + 1;
      continue;
    }
    const gt = input.indexOf('>', lt + 1);
    if (gt === -1) {
      pushText(input.slice(lt));
      break;
    }
    const inner = input.slice(lt + 1, gt);
    index = gt + 1;
    if (inner.startsWith('/')) {
      const name = inner.slice(1).trim().toLowerCase();
      for (let depth = stack.length - 1; depth > 0; depth -= 1) {
        if (stack[depth].name === name) {
          stack.length = depth;
          break;
        }
      }
      continue;
    }
    const nameMatch = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(inner);
    if (nameMatch === null) continue;
    const name = nameMatch[1].toLowerCase();
    const selfClosing = inner.trimEnd().endsWith('/');
    const attrs = parseAttributes(inner.slice(nameMatch[1].length));
    const element: RawNode = { type: 'element', name, attrs, children: [] };
    stack[stack.length - 1].children.push(element);
    if (!selfClosing && !VOID_ELEMENTS.has(name)) {
      stack.push(element as { type: 'element'; name: string; attrs: Record<string, string>; children: RawNode[] });
    }
  }
  return root.children;
}

export function safeHref(raw: string): string | null {
  const trimmed = raw.trim();
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (schemeMatch === null) return null;
  const scheme = schemeMatch[1].toLowerCase();
  if (!(ALLOWED_LINK_SCHEMES as readonly string[]).includes(scheme)) return null;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

/* ------------------------------------------------------------ flat document */

const INLINE_ELEMENTS = new Set(['strong', 'em', 'code', 'a', 'b', 'i', 'br']);

function isAllowedElement(name: string): boolean {
  return (ALLOWED_ELEMENTS as readonly string[]).includes(name);
}

export function parseBody(body: string): FlatItem[] {
  const nodes = parseHtml(body);
  const items: FlatItem[] = [];
  let openContainer: ContainerKind | null = null;
  let containerHasStarted = false;
  let listKind: 'ul' | 'ol' | null = null;

  const startContainer = (kind: ContainerKind) => {
    if (containerHasStarted) items.push({ kind: 'boundary', container: kind });
    containerHasStarted = true;
    openContainer = kind;
  };
  const ensureContainer = (kind: ContainerKind) => {
    if (openContainer === null) startContainer(kind);
  };

  const walkInline = (node: RawNode, mark: Mark, container: ContainerKind) => {
    if (node.type === 'text') {
      for (const ch of splitUnits(node.text)) {
        items.push({ kind: 'text', ch, mark: cloneMark(mark), container });
      }
      return;
    }
    const name = node.name === 'b' ? 'strong' : node.name === 'i' ? 'em' : node.name;
    if (name === 'br') {
      items.push({ kind: 'br', container });
      return;
    }
    if ((DROPPED_WITH_CONTENT as readonly string[]).includes(name)) return;
    let next = mark;
    if (name === 'strong') next = { ...mark, strong: true };
    else if (name === 'em') next = { ...mark, em: true };
    else if (name === 'code') next = { ...mark, code: true };
    else if (name === 'a') {
      const href = node.attrs['href'] === undefined ? null : safeHref(node.attrs['href']);
      next = href === null ? mark : { ...mark, href };
    }
    for (const child of node.children) walkInline(child, next, container);
  };

  const walkBlock = (node: RawNode, inheritedKind: ContainerKind | null) => {
    if (node.type === 'text') {
      if (node.text.trim().length === 0 && openContainer === null) return;
      ensureContainer(inheritedKind ?? 'p');
      walkInline(node, PLAIN_MARK, openContainer ?? 'p');
      return;
    }
    const name = node.name === 'b' ? 'strong' : node.name === 'i' ? 'em' : node.name;
    if ((DROPPED_WITH_CONTENT as readonly string[]).includes(name)) return;
    if (name === 'p' || name === 'blockquote' || name === 'li') {
      const kind: ContainerKind =
        name === 'p' ? 'p' : name === 'blockquote' ? 'blockquote' : listKind === 'ol' ? 'li-ol' : 'li-ul';
      startContainer(kind);
      const container = kind;
      for (const child of node.children) {
        if (child.type === 'element' && !INLINE_ELEMENTS.has(child.name) && !(DROPPED_WITH_CONTENT as readonly string[]).includes(child.name)) {
          walkBlock(child, container);
        } else {
          walkInline(child, PLAIN_MARK, container);
        }
      }
      openContainer = null;
      return;
    }
    if (name === 'ul' || name === 'ol') {
      const previous = listKind;
      listKind = name;
      for (const child of node.children) walkBlock(child, inheritedKind);
      listKind = previous;
      return;
    }
    if (INLINE_ELEMENTS.has(name) && isAllowedElement(name === 'b' ? 'strong' : name === 'i' ? 'em' : name)) {
      ensureContainer(inheritedKind ?? 'p');
      walkInline(node, PLAIN_MARK, openContainer ?? inheritedKind ?? 'p');
      return;
    }
    // Every other element is removed and its text kept.
    for (const child of node.children) walkBlock(child, inheritedKind);
  };

  for (const node of nodes) walkBlock(node, null);
  return items;
}

function splitUnits(text: string): string[] {
  const units: string[] = [];
  for (let i = 0; i < text.length; i += 1) units.push(text.charAt(i));
  return units;
}

export function itemChar(item: FlatItem): string {
  return item.kind === 'text' ? item.ch : '\n';
}

export function editTextOfItems(items: FlatItem[]): string {
  let out = '';
  for (const item of items) out += itemChar(item);
  return out;
}

export function editTextOf(body: string): string {
  return editTextOfItems(parseBody(body));
}

export function plainTextOf(body: string): string {
  let out = '';
  for (const item of parseBody(body)) out += item.kind === 'text' ? item.ch : ' ';
  return out.trim();
}

/* -------------------------------------------------------------- serializing */

export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

type Group = { kind: ContainerKind; items: FlatItem[] };

function groupItems(items: FlatItem[]): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  for (const item of items) {
    if (item.kind === 'boundary') {
      if (current === null) groups.push({ kind: 'p', items: [] });
      current = { kind: item.container, items: [] };
      groups.push(current);
      continue;
    }
    if (current === null) {
      current = { kind: item.container, items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }
  return groups;
}

function serializeInline(items: FlatItem[], withRel: boolean): string {
  let out = '';
  let index = 0;
  while (index < items.length) {
    const item = items[index];
    if (item.kind !== 'text') {
      if (item.kind === 'br') out += '<br>';
      index += 1;
      continue;
    }
    const mark = item.mark;
    let text = '';
    while (index < items.length) {
      const next = items[index];
      if (next.kind !== 'text' || !sameMark(next.mark, mark)) break;
      text += next.ch;
      index += 1;
    }
    let inner = escapeText(text);
    if (mark.code) inner = `<code>${inner}</code>`;
    if (mark.em) inner = `<em>${inner}</em>`;
    if (mark.strong) inner = `<strong>${inner}</strong>`;
    if (mark.href !== null) {
      const rel = withRel ? ` rel="${LINK_REL}"` : '';
      inner = `<a href="${escapeAttribute(mark.href)}"${rel}>${inner}</a>`;
    }
    out += inner;
  }
  return out;
}

function serializeGroups(groups: Group[], withRel: boolean): string {
  let out = '';
  let openList: 'ul' | 'ol' | null = null;
  for (const group of groups) {
    const wantList = group.kind === 'li-ul' ? 'ul' : group.kind === 'li-ol' ? 'ol' : null;
    if (openList !== null && openList !== wantList) {
      out += `</${openList}>`;
      openList = null;
    }
    if (wantList !== null && openList === null) {
      out += `<${wantList}>`;
      openList = wantList;
    }
    const inner = serializeInline(group.items, withRel);
    if (wantList !== null) out += `<li>${inner}</li>`;
    else if (group.kind === 'blockquote') out += `<blockquote>${inner}</blockquote>`;
    else out += `<p>${inner}</p>`;
  }
  if (openList !== null) out += `</${openList}>`;
  return out;
}

export function serializeItems(items: FlatItem[]): string {
  const groups = groupItems(items).filter((group) => group.items.length > 0);
  if (groups.length === 0) return '';
  return serializeGroups(groups, false);
}

/** The stored body: sanitised and in the one canonical form. */
export function storedBody(input: string): string {
  return serializeItems(parseBody(input));
}

/** Markup for rendering a stored body on a page: the same allowlist, with rel on links. */
export function renderBody(body: string): string {
  const groups = groupItems(parseBody(body)).filter((group) => group.items.length > 0);
  if (groups.length === 0) return '';
  return serializeGroups(groups, true);
}

export function bodyFromPlainText(text: string): string {
  return storedBody(escapeText(text));
}

export function excerptOf(body: string, limit: number): string {
  const plain = plainTextOf(body);
  return plain.length <= limit ? plain : plain.slice(0, limit);
}
