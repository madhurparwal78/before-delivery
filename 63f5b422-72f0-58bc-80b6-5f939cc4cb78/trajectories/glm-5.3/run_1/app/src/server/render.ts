// Renders published pages. Editor frames use the same computedDeclarations from
// shared/style.ts, so editor and published computed styles agree (DP-16).
import { escapeHtml, isSafeHref, type WorkspaceDocument, type DocumentNode, type Page, type CollectionEntry } from '../shared/domain.js';
import { computedDeclarations, declarationsToCss, focalPoint, TYPE_DEFAULTS } from '../shared/style.js';

interface RenderCtx {
  doc: WorkspaceDocument;
  assets: boolean; // true: published asset urls; false: editor image api
  wsSlug: string;
  pageSlug: string;
}

function nodeId(node: DocumentNode, entry?: CollectionEntry): string {
  return entry ? `${node.id}-${entry.id}` : node.id;
}

function nodeClass(node: DocumentNode): string {
  return `pl-${node.type}`;
}

function styleAttr(ctx: RenderCtx, node: DocumentNode, filled?: { values: Record<string, string> }): string {
  const decs = computedDeclarations(ctx.doc, node, 'desktop');
  // inline style on published markup: the phone computed rules are the base,
  // tablet and desktop come from the page stylesheet; but per-element inline
  // style would win over media queries, so styles are emitted only in the
  // stylesheet and elements carry classes only.
  void decs;
  void filled;
  return '';
}

function tagFor(node: DocumentNode): string {
  switch (node.type) {
    case 'section': return 'section';
    case 'stack': return 'div';
    case 'heading': return `h${typeof node.props.level === 'number' ? node.props.level : 1}`;
    case 'text': return 'p';
    case 'image': return 'img';
    case 'button': return 'a';
    case 'nav': return 'nav';
    case 'collection_list': return 'ul';
    case 'page': return 'div';
    default: return 'div';
  }
}

function imageSrc(ctx: RenderCtx, node: DocumentNode, entry?: CollectionEntry): string {
  const imageId = typeof node.props.imageId === 'string' ? node.props.imageId : '';
  const bound = node.bind?.imageId;
  const id = bound && entry ? entry.values[bound] ?? imageId : imageId;
  return ctx.assets
    ? `/p/${ctx.wsSlug}/${ctx.pageSlug}/assets/${id}`
    : `/api/images/${id}`;
}

function openTag(ctx: RenderCtx, node: DocumentNode, entry?: CollectionEntry): string {
  const tag = tagFor(node);
  const id = nodeId(node, entry);
  const cls = nodeClass(node);
  if (node.type === 'image') {
    const alt = typeof node.props.alt === 'string' ? node.props.alt : '';
    return `<${tag} id="${id}" class="${cls}" src="${escapeHtml(imageSrc(ctx, node, entry))}" alt="${escapeHtml(alt)}" style="object-position:${focalPoint(node)}">`;
  }
  if (node.type === 'button') {
    const hrefRaw = typeof node.props.href === 'string' ? node.props.href : '/';
    const href = isSafeHref(hrefRaw) ? hrefRaw : '/';
    return `<${tag} id="${id}" class="${cls}" href="${escapeHtml(href)}">`;
  }
  if (node.type === 'nav') {
    return `<${tag} id="${id}" class="${cls} pl-site-nav" aria-label="Site" data-nav-id="${id}">`;
  }
  return `<${tag} id="${id}" class="${cls}">`;
}

function richTextOf(ctx: RenderCtx, node: DocumentNode, entry?: CollectionEntry): string {
  const bound = node.bind?.text;
  if (!bound) return escapeHtml(typeof node.props.text === 'string' ? node.props.text : '');
  const field = ctx.doc.collection.fields.find((f) => f.name === bound);
  const value = entry ? entry.values[bound] ?? '' : '';
  if (field?.kind === 'rich_text') return value;
  return escapeHtml(value);
}

function renderNode(ctx: RenderCtx, node: DocumentNode, entry?: CollectionEntry): string {
  if (node.type === 'collection_list') {
    const entries = [...ctx.doc.collection.entries].sort((a, b) => a.order - b.order);
    const tag = 'ul';
    if (entries.length === 0) {
      return `<${tag} id="${node.id}" class="${nodeClass(node)}"><li class="pl-empty">Nothing here yet.</li></${tag}>`;
    }
    const template = node.children[0];
    const rows = entries.map((e) => {
      const inner = template ? renderNode(ctx, template, e) : '';
      return `<li id="${node.id}-${e.id}" data-collection-row="${e.id}">${inner}</li>`;
    }).join('');
    return `<${tag} id="${node.id}" class="${nodeClass(node)}">${rows}</${tag}>`;
  }
  const tag = tagFor(node);
  const open = openTag(ctx, node, entry);
  let inner: string;
  if (node.type === 'heading' || node.type === 'button') {
    inner = escapeHtml(boundText(ctx, node, entry));
  } else if (node.type === 'text') {
    const bound = node.bind?.text;
    const field = bound ? ctx.doc.collection.fields.find((f) => f.name === bound) : undefined;
    inner = field?.kind === 'rich_text'
      ? `<div class="pl-rich">${richTextOf(ctx, node, entry)}</div>`
      : escapeHtml(richTextOf(ctx, node, entry));
  } else if (node.type === 'image') {
    return open;
  } else {
    inner = node.children.map((c) => renderNode(ctx, c, entry)).join('');
  }
  return `${open}${inner}</${tag}>`;
}

function boundText(ctx: RenderCtx, node: DocumentNode, entry?: CollectionEntry): string {
  const bound = node.bind?.text;
  if (!bound) return typeof node.props.text === 'string' ? node.props.text : '';
  return entry ? entry.values[bound] ?? '' : '';
}

export function hasNav(node: DocumentNode): boolean {
  if (node.type === 'nav') return true;
  return node.children.some((c) => hasNav(c));
}

/** The page stylesheet: phone computed declarations as base, then tablet and
 * desktop blocks, so the published page switches exactly at 1280 / 768. */
export function pageStyleSheet(doc: WorkspaceDocument, page: Page): string {
  const collect = (bp: 'desktop' | 'tablet' | 'phone'): string[] => {
    const rules: string[] = [];
    const visit = (node: DocumentNode) => {
      const decs = computedDeclarations(doc, node, bp);
      const css = declarationsToCss(decs);
      if (css) rules.push(`#${node.id}{${css}}`);
      // defaults for the collection template nodes appear once, keyed by template id
      for (const c of node.children) {
        if (c.type === 'collection_list' && c.children[0]) {
          const template = c.children[0];
          const tdecs = computedDeclarations(doc, template, bp);
          rules.push(`.pl-row [data-template-node="${template.id}"],#${template.id}{${declarationsToCss(tdecs)}}`);
          for (const d of template.children) visitTemplate(d, bp, rules);
        }
        visit(c);
      }
    };
    const visitTemplate = (node: DocumentNode, bp: 'desktop' | 'tablet' | 'phone', rules: string[]) => {
      const decs = computedDeclarations(doc, node, bp);
      rules.push(`[data-template-node="${node.id}"]{${declarationsToCss(decs)}}`);
      for (const c of node.children) visitTemplate(c, bp, rules);
    };
    visit(page.root);
    return rules;
  };

  const phoneRules = collect('phone');
  const tabletRules = collect('tablet');
  const desktopRules = collect('desktop');
  const typeDefaults = Object.entries(TYPE_DEFAULTS)
    .filter(([type]) => type !== 'page')
    .map(([type, decs]) => `.pl-${type}{${decs}}`).join('');
  return [
    typeDefaults,
    phoneRules.join(''),
    `@media (min-width:768px){${tabletRules.join('')}}`,
    `@media (min-width:1280px){${desktopRules.join('')}}`,
  ].join('\n');
}

export interface RenderedPage { html: string; css: string }

export function renderPublishedPage(doc: WorkspaceDocument, page: Page): RenderedPage {
  const ctx: RenderCtx = { doc, assets: true, wsSlug: doc.slug, pageSlug: page.slug };
  const body = renderNode(ctx, page.root);
  const css = pageStyleSheet(doc, page);
  const nav = hasNav(page.root);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.name)} · ${escapeHtml(doc.name)}</title>
<style>${css}</style>
<style>__PLINTH_PUBLISHED_CSS__</style>
</head>
<body>
<a class="pl-skip" href="#main">Skip to content</a>
<main id="main">
${body}
</main>
${nav ? '<script src="/p/plinth-menu.js" defer></script>' : ''}
</body>
</html>`;
  return { html, css };
}
