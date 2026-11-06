// Rich text allowlist, stored body, edit text and plain text (Business rules).
// A body is modelled as leaves: runs of inline content, each inside a chain of block containers.
// Edit text is the leaves joined by "\n", with each br as "\n".

import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import type { Op } from './ot.ts';

export const BLOCK_LIMIT = 20000;

type Node = DefaultTreeAdapterTypes.ChildNode;
type ContainerName = 'p' | 'li' | 'blockquote' | 'ul' | 'ol';
type Container = { name: ContainerName; id: number };
type Marks = { strong: boolean; em: boolean; code: boolean; href: string | null };
/** One edit-text character: a UTF-16 unit of text, or a br (written as "\n"). */
type Item = { ch: string; br: boolean; marks: Marks };
type Leaf = { path: Container[]; items: Item[] };

const NO_MARKS: Marks = { strong: false, em: false, code: false, href: null };
const DROPPED = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript']);
const CONTAINERS = new Set<string>(['p', 'li', 'blockquote', 'ul', 'ol']);
const LINK_SCHEMES = new Set(['http', 'https', 'mailto']);
const HTML_WHITESPACE = /^[ \t\n\f\r]*$/;

function isContainerName(name: string): name is ContainerName {
  return CONTAINERS.has(name);
}

function allowedHref(element: DefaultTreeAdapterTypes.Element): string | null {
  const attr = element.attrs.find((a) => a.name === 'href');
  if (attr === undefined) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(attr.value.trim());
  return scheme !== null && LINK_SCHEMES.has(scheme[1].toLowerCase()) ? attr.value : null;
}

function markedBy(element: DefaultTreeAdapterTypes.Element, marks: Marks): Marks {
  switch (element.tagName) {
    case 'strong':
    case 'b':
      return { ...marks, strong: true };
    case 'em':
    case 'i':
      return { ...marks, em: true };
    case 'code':
      return { ...marks, code: true };
    case 'a': {
      const href = allowedHref(element);
      return href === null ? marks : { ...marks, href };
    }
    default:
      return marks;
  }
}

/** Collects leaves while walking one container; inline content joins the open leaf until a nested container emits one. */
type Scope = { path: Container[]; open: Leaf | null };

class LeafBuilder {
  leaves: Leaf[] = [];
  private nextId = 1;

  container(name: ContainerName): Container {
    const id = this.nextId;
    this.nextId += 1;
    return { name, id };
  }

  build(nodes: Node[]): Leaf[] {
    this.walk(nodes, { path: [], open: null }, NO_MARKS);
    return this.leaves;
  }

  private walk(nodes: Node[], scope: Scope, marks: Marks): void {
    for (const node of nodes) {
      if ('value' in node) this.text(node.value, scope, marks);
      else if ('tagName' in node) this.element(node, scope, marks);
    }
  }

  private element(element: DefaultTreeAdapterTypes.Element, scope: Scope, marks: Marks): void {
    const name = element.tagName;
    if (DROPPED.has(name)) return;
    if (name === 'br') {
      this.leafFor(scope).items.push({ ch: '\n', br: true, marks });
      return;
    }
    if (!isContainerName(name)) {
      this.walk(element.childNodes, scope, markedBy(element, marks));
      return;
    }
    // Mirror how HTML parsing nests these elements so the output parses back to the same leaves:
    // no container inside a p, and no li directly inside an li.
    let parentPath = scope.path;
    while (parentPath.length > 0 && parentPath[parentPath.length - 1].name === 'p') parentPath = parentPath.slice(0, -1);
    if (name === 'li' && parentPath.length > 0 && parentPath[parentPath.length - 1].name === 'li') {
      parentPath = parentPath.slice(0, -1);
    }
    const inner: Scope = { path: [...parentPath, this.container(name)], open: null };
    const before = this.leaves.length;
    this.walk(element.childNodes, inner, marks);
    if (this.leaves.length === before && name !== 'ul' && name !== 'ol') this.leaves.push({ path: inner.path, items: [] });
    if (this.leaves.length > before) scope.open = null;
  }

  private text(value: string, scope: Scope, marks: Marks): void {
    if (value === '') return;
    const last = scope.path[scope.path.length - 1];
    // Whitespace-only text directly inside ul/ol is layout between list items, not content.
    if (last !== undefined && (last.name === 'ul' || last.name === 'ol') && HTML_WHITESPACE.test(value)) return;
    const items = this.leafFor(scope).items;
    for (const ch of value.split('')) items.push({ ch, br: false, marks });
  }

  /** The leaf inline content goes into; inline content outside p, li or blockquote gets its own p per run. */
  private leafFor(scope: Scope): Leaf {
    if (scope.open !== null) return scope.open;
    const last = scope.path[scope.path.length - 1];
    const wraps = last === undefined || last.name === 'ul' || last.name === 'ol';
    const leaf: Leaf = { path: wraps ? [...scope.path, this.container('p')] : scope.path, items: [] };
    this.leaves.push(leaf);
    scope.open = leaf;
    return leaf;
  }
}

function parseLeaves(html: string): Leaf[] {
  return new LeafBuilder().build(parseFragment(html).childNodes);
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

type MarkName = 'a' | 'strong' | 'em' | 'code';
type OpenMark = { name: MarkName; href: string | null };
const MARK_ORDER: MarkName[] = ['a', 'strong', 'em', 'code'];

function hasMark(marks: Marks, mark: OpenMark): boolean {
  if (mark.name === 'a') return marks.href !== null && marks.href === mark.href;
  return marks[mark.name];
}

function marksOf(marks: Marks): OpenMark[] {
  const out: OpenMark[] = [];
  if (marks.href !== null) out.push({ name: 'a', href: marks.href });
  for (const name of ['strong', 'em', 'code'] as const) if (marks[name]) out.push({ name, href: null });
  return out;
}

function openTag(mark: OpenMark, rel: boolean): string {
  if (mark.name !== 'a') return `<${mark.name}>`;
  const relAttr = rel ? ' rel="noopener noreferrer nofollow"' : '';
  return `<a href="${escapeAttr(mark.href ?? '')}"${relAttr}>`;
}

/** Writes inline items, keeping open marks open as long as they last and opening the longest-lasting mark outermost. */
function serialiseInline(items: Item[], rel: boolean): string {
  let out = '';
  const stack: OpenMark[] = [];
  items.forEach((item, index) => {
    const keep = stack.findIndex((mark) => !hasMark(item.marks, mark));
    if (keep !== -1) {
      for (const mark of stack.splice(keep).reverse()) out += `</${mark.name}>`;
    }
    const missing = marksOf(item.marks).filter((mark) => !stack.some((open) => open.name === mark.name));
    const span = (mark: OpenMark): number => {
      let end = index;
      while (end < items.length && hasMark(items[end].marks, mark)) end += 1;
      return end - index;
    };
    missing.sort((x, y) => span(y) - span(x) || MARK_ORDER.indexOf(x.name) - MARK_ORDER.indexOf(y.name));
    for (const mark of missing) {
      out += openTag(mark, rel);
      stack.push(mark);
    }
    out += item.br ? '<br>' : escapeText(item.ch);
  });
  for (const mark of stack.reverse()) out += `</${mark.name}>`;
  return out;
}

/** Writes leaves sharing the first `depth` containers, grouping adjacent leaves by their next container. */
function serialiseLeaves(leaves: Leaf[], depth: number, rel: boolean): string {
  let out = '';
  let i = 0;
  while (i < leaves.length) {
    const leaf = leaves[i];
    if (leaf.path.length === depth) {
      // An empty run beside nested blocks would vanish on re-parsing; an empty p keeps its line.
      out += leaf.items.length === 0 && leaves.length > 1 ? '<p></p>' : serialiseInline(leaf.items, rel);
      i += 1;
      continue;
    }
    const container = leaf.path[depth];
    let j = i;
    while (j < leaves.length && leaves[j].path.length > depth && leaves[j].path[depth].id === container.id) j += 1;
    out += `<${container.name}>${serialiseLeaves(leaves.slice(i, j), depth + 1, rel)}</${container.name}>`;
    i = j;
  }
  return out;
}

function serialise(leaves: Leaf[], rel: boolean): string {
  if (leaves.length === 0 || (leaves.length === 1 && leaves[0].items.length === 0)) return '';
  return serialiseLeaves(leaves, 0, rel);
}

export function sanitizeBody(html: string): string {
  return serialise(parseLeaves(html), false);
}

export function renderBody(stored: string): string {
  return serialise(parseLeaves(stored), true);
}

function joinLeaves(stored: string, lineBreak: string): string {
  return parseLeaves(stored)
    .map((leaf) => leaf.items.map((item) => (item.br ? lineBreak : item.ch)).join(''))
    .join(lineBreak);
}

export function editText(stored: string): string {
  return joinLeaves(stored, '\n');
}

export function plainText(stored: string): string {
  return joinLeaves(stored, ' ').replace(/^ +| +$/g, '');
}

export function textToBody(text: string): string {
  return text === '' ? '' : `<p>${escapeText(text).replace(/\n/g, '<br>')}</p>`;
}

/** A unit of edit text: an item, or the line feed that starts the next leaf. */
type Unit = { item: Item } | { leafPath: Container[] };

export function applyOpsToBody(stored: string, ops: Op[]): string {
  const leaves = parseLeaves(stored);
  const firstPath = leaves.length > 0 ? leaves[0].path : [{ name: 'p' as const, id: 0 }];
  const units: Unit[] = [];
  leaves.forEach((leaf, index) => {
    if (index > 0) units.push({ leafPath: leaf.path });
    for (const item of leaf.items) units.push({ item });
  });

  const out: Unit[] = [];
  let pos = 0;
  for (const op of ops) {
    if ('retain' in op) {
      out.push(...units.slice(pos, pos + op.retain));
      pos += op.retain;
    } else if ('delete' in op) {
      // Dropping a leaf boundary joins the following leaf into the one before it.
      pos += op.delete;
    } else {
      const neighbour = out.length > 0 ? out[out.length - 1] : units[pos];
      const marks = neighbour !== undefined && 'item' in neighbour ? neighbour.item.marks : NO_MARKS;
      for (const ch of op.insert.split('')) out.push({ item: { ch, br: ch === '\n', marks } });
    }
  }
  out.push(...units.slice(pos));

  const result: Leaf[] = [{ path: firstPath, items: [] }];
  for (const unit of out) {
    const current = result[result.length - 1];
    if ('item' in unit) current.items.push(unit.item);
    else if (unit.leafPath.length === current.path.length && unit.leafPath.every((c, i) => current.path[i].id === c.id)) {
      // Two runs of the same container met after a join: a br keeps the line feed between them.
      current.items.push({ ch: '\n', br: true, marks: NO_MARKS });
    } else {
      result.push({ path: unit.leafPath, items: [] });
    }
  }
  return serialise(result, false);
}
