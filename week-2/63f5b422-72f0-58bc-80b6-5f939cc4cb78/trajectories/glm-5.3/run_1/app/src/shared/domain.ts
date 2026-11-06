// Shared domain rules, used by both server and client.

import { NAMED_COLORS } from './colors.js';

export type Breakpoint = 'desktop' | 'tablet' | 'phone';
export const BREAKPOINTS: readonly Breakpoint[] = ['desktop', 'tablet', 'phone'];
export const BP_WIDTH: Record<Breakpoint, number> = { desktop: 1280, tablet: 768, phone: 375 };
export const BP_LABEL: Record<Breakpoint, string> = { desktop: 'Desktop', tablet: 'Tablet', phone: 'Phone' };

export type NodeType = 'page' | 'section' | 'stack' | 'heading' | 'text' | 'image' | 'button' | 'nav' | 'collection_list';
export const NODE_TYPES: readonly NodeType[] = ['page', 'section', 'stack', 'heading', 'text', 'image', 'button', 'nav', 'collection_list'];
export const CONTAINERS: readonly NodeType[] = ['page', 'section', 'stack', 'nav', 'collection_list'];
export const TYPE_LABEL: Record<NodeType, string> = {
  page: 'Page', section: 'Section', stack: 'Stack', heading: 'Heading', text: 'Text',
  image: 'Image', button: 'Button', nav: 'Nav', collection_list: 'Collection list',
};

export type StyleProperty = 'color' | 'background-color' | 'font-size' | 'padding' | 'gap' | 'width' | 'text-align' | 'display' | 'flex-direction';
export const STYLE_PROPERTIES: readonly StyleProperty[] = ['color', 'background-color', 'font-size', 'padding', 'gap', 'width', 'text-align', 'display', 'flex-direction'];

export type TokenKind = 'color' | 'size';
export interface Token { name: string; kind: TokenKind; value: string | number; unit?: 'px' | 'rem' }
export interface DocumentNode {
  id: string; type: NodeType; name: string;
  props: Record<string, unknown>;
  styles: Partial<Record<Breakpoint, Record<string, StyleValue>>>;
  children: DocumentNode[];
  shared?: { componentId: string };
  bind?: Record<string, string>;
}
export type StyleValue = string | { token: string };
export interface CollectionField { name: string; kind: 'text' | 'rich_text' | 'image' }
export interface CollectionEntry { id: string; order: number; values: Record<string, string> }
export interface Collection { name: string; fields: CollectionField[]; entries: CollectionEntry[] }
export interface Page {
  id: string; name: string; slug: string; order: number;
  publishedAt?: number;
  root: DocumentNode;
}
export interface ComponentDef { id: string; name: string; root: DocumentNode }
export interface WorkspaceDocument {
  id: string; name: string; slug: string; seq: number;
  tokens: Token[];
  pages: Page[];
  components: ComponentDef[];
  collection: Collection;
}

export type Role = 'owner' | 'editor' | 'viewer';

// ---- helpers ----------------------------------------------------------

export function isTokenRef(v: StyleValue | undefined): v is { token: string } {
  return typeof v === 'object' && v !== null && 'token' in v;
}

export function styleAt(styles: DocumentNode['styles'], bp: Breakpoint, prop: StyleProperty): StyleValue | undefined {
  return styles[bp]?.[prop];
}

/** The one place that decides breakpoint inheritance (DP-10). */
export function resolveStyle(
  styles: DocumentNode['styles'], bp: Breakpoint, prop: StyleProperty,
): { value: StyleValue | undefined; source: 'set' | 'inherited' | 'unset'; setAt: Breakpoint | null } {
  if (styleAt(styles, bp, prop) !== undefined) return { value: styles[bp]![prop], source: 'set', setAt: bp };
  for (let i = BREAKPOINTS.indexOf(bp) - 1; i >= 0; i--) {
    const above = BREAKPOINTS[i];
    if (styleAt(styles, above, prop) !== undefined) return { value: styles[above]![prop], source: 'inherited', setAt: above };
  }
  return { value: undefined, source: 'unset', setAt: null };
}

/** Pip state, the one place that decides it (DP-13). */
export function pipState(styles: DocumentNode['styles'], bp: Breakpoint, prop: StyleProperty): 'set' | 'inherited' | 'overridden' | 'unset' {
  if (styleAt(styles, bp, prop) !== undefined) return bp === 'desktop' ? 'set' : 'overridden';
  for (let i = BREAKPOINTS.indexOf(bp) - 1; i >= 0; i--) {
    if (styleAt(styles, BREAKPOINTS[i], prop) !== undefined) return 'inherited';
  }
  return 'unset';
}

/** Reach of a change, the one place that decides it (DP-14). */
export function reachOfChange(
  styles: DocumentNode['styles'], prop: StyleProperty, changed: Breakpoint,
): { inherited: Breakpoint[]; kept: Breakpoint[]; shielded: Breakpoint[] } {
  const inherited: Breakpoint[] = [], kept: Breakpoint[] = [], shielded: Breakpoint[] = [];
  const start = BREAKPOINTS.indexOf(changed);
  for (let j = start + 1; j < BREAKPOINTS.length; j++) {
    const bp = BREAKPOINTS[j];
    if (styleAt(styles, bp, prop) !== undefined) { kept.push(bp); continue; }
    let shieldedBp = false;
    for (let k = start + 1; k < j; k++) if (styleAt(styles, BREAKPOINTS[k], prop) !== undefined) { shieldedBp = true; break; }
    (shieldedBp ? shielded : inherited).push(bp);
  }
  return { inherited, kept, shielded };
}

export function joinBps(list: Breakpoint[]): string {
  return list.length === 0 ? 'no other breakpoint' : list.map((b) => BP_LABEL[b]).join(' and ');
}

export function cascadeNotice(prop: StyleProperty, bp: Breakpoint, styles: DocumentNode['styles']): string {
  const r = reachOfChange(styles, prop, bp);
  return `${prop} changed on ${BP_LABEL[bp]}. Inherited by ${joinBps(r.inherited)}. Kept override on ${joinBps(r.kept)}.`;
}

export function tokenDisplay(v: StyleValue | undefined): string {
  if (v === undefined) return 'nothing';
  return isTokenRef(v) ? v.token : String(v);
}

export function displayValue(v: StyleValue | undefined, tokensByName?: Map<string, Token>): string {
  if (v === undefined) return 'nothing';
  if (isTokenRef(v)) {
    const t = tokensByName?.get(v.token);
    if (!t) return v.token;
    return t.kind === 'size' ? `${t.value}${t.unit ?? 'px'}` : String(t.value);
  }
  return String(v);
}

// ---- validation -------------------------------------------------------

const NAMED_COLOR_SET = new Set(NAMED_COLORS);
const PX_RE = /^(\d{1,3})(\.\d{1,3})?px$/;
const REM_RE = /^(\d{1,3})(\.\d{1,3})?rem$/;
const PCT_RE = /^(100|[0-9]{1,2})%$/;

export function isSafeHref(href: string): boolean {
  return /^https:\/\//i.test(href) || /^http:\/\//i.test(href) || /^mailto:/i.test(href) || href.startsWith('/');
}

export function styleValueError(prop: StyleProperty, value: StyleValue, tokenKind: (name: string) => TokenKind | undefined): string | null {
  if (isTokenRef(value)) {
    const kind = tokenKind(value.token);
    if (kind === undefined) return `${value.token} is not a token.`;
    if (tokenKindFor(prop) !== kind) return `${prop} takes a ${tokenKindFor(prop)} token.`;
    return null;
  }
  const v = String(value);
  switch (prop) {
    case 'color': case 'background-color':
      return NAMED_COLOR_SET.has(v) ? null : `${prop} takes a CSS named colour.`;
    case 'font-size': case 'padding': case 'gap':
      return (PX_RE.test(v) || REM_RE.test(v)) ? null : `${prop} takes a px or rem size.`;
    case 'width':
      return (PX_RE.test(v) || REM_RE.test(v) || PCT_RE.test(v) || v === 'auto') ? null : `${prop} takes a px, rem, % size or auto.`;
    case 'text-align':
      return v === 'left' || v === 'center' || v === 'right' ? null : `${prop} takes left, center or right.`;
    case 'display':
      return v === 'block' || v === 'flex' || v === 'none' ? null : `${prop} takes block, flex or none.`;
    case 'flex-direction':
      return v === 'row' || v === 'column' ? null : `${prop} takes row or column.`;
  }
}

export function tokenKindFor(prop: StyleProperty): TokenKind | 'none' {
  if (prop === 'color' || prop === 'background-color') return 'color';
  if (prop === 'font-size' || prop === 'padding' || prop === 'gap' || prop === 'width') return 'size';
  return 'none';
}

export function containerAccepts(parentType: NodeType, childType: NodeType): boolean {
  if (parentType === 'nav') return childType === 'button';
  if (parentType === 'collection_list') return false;
  return CONTAINERS.includes(parentType);
}

export function takesChildren(t: NodeType): boolean {
  return CONTAINERS.includes(t);
}

export function mainPropOf(type: NodeType): string | null {
  if (type === 'heading' || type === 'text' || type === 'button') return 'text';
  if (type === 'image') return 'imageId';
  return null;
}

// ---- rich text allowlist (the one place that filters markup, DP-27) ----

const RICH_ALLOWED = new Set(['p', 'strong', 'em', 'ul', 'ol', 'li', 'a']);

export function isSafeRichHref(href: string): boolean {
  return /^https:\/\//i.test(href) || /^http:\/\//i.test(href) || /^mailto:/i.test(href);
}

interface RichNode { name: string; text: string; attrs: Record<string, string>; children: RichNode[] }

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    switch (ent) {
      case 'amp': return '&'; case 'lt': return '<'; case 'gt': return '>';
      case 'quot': return '"'; case 'apos': return "'"; case 'nbsp': return '\u00a0';
      default: return m;
    }
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface RichToken { kind: 'text' | 'open' | 'close'; text: string; tag: string; attrs: Record<string, string> }

function tokenizeRich(html: string): RichToken[] {
  const tokens: RichToken[] = [];
  let i = 0;
  const pushText = (raw: string) => { const t = decodeEntities(raw); if (t) tokens.push({ kind: 'text', text: t, tag: '', attrs: {} }); };
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { pushText(html.slice(i)); break; }
    if (lt > i) pushText(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const end = html.indexOf('>', lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    if (html[lt + 1] === '/') {
      const end = html.indexOf('>', lt);
      const tag = html.slice(lt + 2, end === -1 ? html.length : end).trim().toLowerCase().split(/\s/)[0];
      tokens.push({ kind: 'close', text: '', tag, attrs: {} });
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    // open tag: parse until '>' outside quotes
    let j = lt + 1, quote: string | null = null, depthEnd = -1;
    while (j < html.length) {
      const c = html[j];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') { depthEnd = j; break; }
      j++;
    }
    const inner = html.slice(lt + 1, depthEnd === -1 ? html.length : depthEnd);
    i = depthEnd === -1 ? html.length : depthEnd + 1;
    const selfClosing = /\/\s*$/.test(inner);
    const content = inner.replace(/\/\s*$/, '');
    const m = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(content);
    if (!m) continue;
    const tag = m[1].toLowerCase();
    const attrs: Record<string, string> = {};
    const attrRe = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*(=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(content.slice(m[1].length)))) {
      const val = am[4] ?? am[5] ?? am[6] ?? '';
      attrs[am[1].toLowerCase()] = decodeEntities(val);
    }
    tokens.push({ kind: 'open', text: '', tag, attrs });
    if (selfClosing) tokens.push({ kind: 'close', text: '', tag, attrs: {} });
  }
  return tokens;
}

export function filterRichTextNodes(html: string): RichNode[] {
  const tokens = tokenizeRich(html);
  const root: RichNode = { name: '', text: '', attrs: {}, children: [] };
  const stack: RichNode[] = [root];
  for (const t of tokens) {
    const top = stack[stack.length - 1];
    if (t.kind === 'text') { top.children.push({ name: '', text: t.text, attrs: {}, children: [] }); continue; }
    if (t.kind === 'open') {
      if (!RICH_ALLOWED.has(t.tag)) continue; // element removed, its text is kept
      const attrs: Record<string, string> = {};
      if (t.tag === 'a' && t.attrs['href'] && isSafeRichHref(t.attrs['href'])) attrs['href'] = t.attrs['href'];
      const node: RichNode = { name: t.tag, text: '', attrs, children: [] };
      top.children.push(node);
      stack.push(node);
    } else {
      for (let k = stack.length - 1; k >= 1; k--) {
        if (stack[k].name === t.tag) { stack.length = k; break; }
      }
    }
  }
  return root.children;
}

export function richNodesToHtml(nodes: RichNode[]): string {
  let out = '';
  for (const n of nodes) {
    if (n.name === '') { out += escapeHtml(n.text); continue; }
    const attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${escapeHtml(v)}"`).join('');
    out += `<${n.name}${attrs}>${richNodesToHtml(n.children)}</${n.name}>`;
  }
  return out;
}

export function filterRichText(html: string): string {
  return richNodesToHtml(filterRichTextNodes(html));
}

export function richTextLength(html: string): number {
  return filterRichText(html).length;
}

// ---- slugs ------------------------------------------------------------

export function slugify(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return s.length > 0 ? s : 'page';
}
