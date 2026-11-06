import { parseFragment } from 'parse5';
import type { ChildNode, Element, ParentNode } from 'parse5/dist/tree-adapters/default';
import { buildNoteDoc, type NoteDoc, type SimpleNode } from '../../shared/doc';

/** The note body allowlist. Nothing else may reach storage, the API or the reading view. */
const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'ul',
  'ol',
  'li',
  'blockquote',
  'code',
  'pre',
  'a',
]);

/** Elements removed together with everything inside them. */
const DROPPED_SUBTREES: ReadonlySet<string> = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'template',
  'noscript',
  'svg',
  'math',
]);

const VOID_TAGS: ReadonlySet<string> = new Set(['br']);

const SAFE_LINK_SCHEMES = ['http:', 'https:', 'mailto:'];

const LINK_REL = 'noopener noreferrer nofollow';

function safeHref(value: string): string | null {
  const trimmed = value.replace(/^[\s\u0000-\u001f]+/u, '');
  const lower = trimmed.toLowerCase();
  return SAFE_LINK_SCHEMES.some((scheme) => lower.startsWith(scheme)) ? trimmed : null;
}

function childNodesOf(node: ParentNode): ChildNode[] {
  return node.childNodes ?? [];
}

function toSimpleNodes(nodes: readonly ChildNode[]): SimpleNode[] {
  const result: SimpleNode[] = [];
  for (const node of nodes) {
    if (node.nodeName === '#text') {
      const value = (node as unknown as { value: string }).value;
      if (value !== '') result.push({ type: 'text', value });
      continue;
    }
    if (node.nodeName === '#comment' || node.nodeName === '#documentType') continue;
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (DROPPED_SUBTREES.has(tag)) continue;
    const children = toSimpleNodes(childNodesOf(element as unknown as ParentNode));
    if (!ALLOWED_TAGS.has(tag)) {
      result.push(...children);
      continue;
    }
    const attrs: Record<string, string> = {};
    if (tag === 'a') {
      const raw = element.attrs.find((attr) => attr.name === 'href');
      const href = raw ? safeHref(raw.value) : null;
      if (href !== null) {
        attrs.href = href;
        attrs.rel = LINK_REL;
      }
    }
    result.push({ type: 'element', tag, attrs, children });
  }
  return result;
}

function escapeText(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/gu, '&quot;');
}

function serialise(nodes: readonly SimpleNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      out += escapeText(node.value);
      continue;
    }
    const attrs = Object.entries(node.attrs)
      .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
      .join('');
    if (VOID_TAGS.has(node.tag)) {
      out += `<${node.tag}${attrs}>`;
      continue;
    }
    out += `<${node.tag}${attrs}>${serialise(node.children)}</${node.tag}>`;
  }
  return out;
}

export function parseAllowlistedBody(html: string): SimpleNode[] {
  return toSimpleNodes(childNodesOf(parseFragment(html) as unknown as ParentNode));
}

export interface SanitisedBody {
  body: string;
  doc: NoteDoc;
}

export function sanitiseBody(raw: string): SanitisedBody {
  const nodes = parseAllowlistedBody(raw);
  const doc = buildNoteDoc(nodes);
  return { body: serialise(nodes), doc };
}

/** Plain text placed in one paragraph, used by the legacy import and the seed. */
export function plainTextBody(text: string): SanitisedBody {
  return sanitiseBody(`<p>${escapeText(text)}</p>`);
}
