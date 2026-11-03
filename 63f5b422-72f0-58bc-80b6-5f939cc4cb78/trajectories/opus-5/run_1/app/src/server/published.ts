import { notices } from '../shared/notices.js';
import { boundPropValue, focalPosition, publishedCss } from '../shared/render.js';
import { escapeHtml, escapeTextContent } from '../shared/richtext.js';
import { allNodes } from '../shared/tree.js';
import type { Entry, Page, PlinthDocument, PlinthNode } from '../shared/types.js';

const MENU_SCRIPT = `(function(){
var lists=document.querySelectorAll('[data-nav-list]');
var reduce=window.matchMedia('(prefers-reduced-motion: reduce)');
lists.forEach(function(list){
  var button=document.getElementById(list.getAttribute('data-nav-button'));
  var progress=0,open=false,raf=0,timer=0,anchorTime=0,anchorProgress=0;
  function paint(){
    list.setAttribute('data-progress',progress.toFixed(2));
    list.setAttribute('data-motion',progress>=1?'open':progress<=0?'closed':(open?'opening':'closing'));
    button.setAttribute('aria-expanded',open?'true':'false');
    list.style.setProperty('--p',String(progress));
  }
  function settle(){
    progress=open?1:0;
    if(raf){cancelAnimationFrame(raf);raf=0;}
    if(timer){clearTimeout(timer);timer=0;}
    paint();
  }
  function step(now){
    progress=anchorProgress+(open?1:-1)*((now-anchorTime)/200);
    if(progress>1){progress=1;}
    if(progress<0){progress=0;}
    paint();
    if((open&&progress<1)||(!open&&progress>0)){raf=requestAnimationFrame(step);}else{raf=0;settle();}
  }
  function toggle(){
    open=!open;
    if(reduce.matches){settle();return;}
    anchorProgress=progress;anchorTime=performance.now();
    if(timer){clearTimeout(timer);}
    timer=setTimeout(settle,(open?1-anchorProgress:anchorProgress)*200);
    if(!raf){raf=requestAnimationFrame(step);}
    paint();
  }
  button.addEventListener('click',toggle);
  list.addEventListener('keydown',function(event){
    if(event.key==='Escape'&&open){toggle();button.focus();}
  });
  button.addEventListener('keydown',function(event){
    if(event.key==='Escape'&&open){toggle();button.focus();}
  });
  paint();
});
})();`;

const PAGE_CSS = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;max-width:100%;overflow-x:hidden}
body{background:#faf7f2;font-family:'IBM Plex Sans',system-ui,sans-serif;color:#1b1a17}
.pl-skip{position:absolute;left:-9999px;top:0;background:#faf7f2;color:#1b1a17;padding:12px;z-index:10}
.pl-skip:focus{left:8px;top:8px;outline:2px solid #1d4ed8}
.pl-menu{display:none;min-height:44px;min-width:44px;font:inherit;background:transparent;border:1px solid currentColor;border-radius:2px;cursor:pointer}
.pl-nav-list{display:flex;gap:inherit;flex-wrap:wrap;align-items:center}
@media (max-width:767px){
  .pl-menu{display:inline-flex;align-items:center;justify-content:center}
  .pl-nav-list[data-motion="closed"]{display:none}
  .pl-nav-list{flex-direction:column;align-items:stretch;width:100%;opacity:calc(0.2 + 0.8 * var(--p, 1))}
}
.pl-collection_list{margin:0}
img{max-width:100%}
`;

function fontFaces(): string {
  return `
@font-face{font-family:'Space Grotesk';src:url('/fonts/space-grotesk-latin.woff2') format('woff2');font-weight:300 700;font-display:swap}
@font-face{font-family:'IBM Plex Sans';src:url('/fonts/ibm-plex-sans-latin.woff2') format('woff2');font-weight:100 700;font-display:swap}
@font-face{font-family:'IBM Plex Mono';src:url('/fonts/ibm-plex-mono-400-latin.woff2') format('woff2');font-weight:400;font-display:swap}
@font-face{font-family:'IBM Plex Mono';src:url('/fonts/ibm-plex-mono-500-latin.woff2') format('woff2');font-weight:500;font-display:swap}
`;
}

function classesOf(node: PlinthNode): string {
  return `pl-node pl-${node.type} n-${node.id}`;
}

function idOf(node: PlinthNode, entry: Entry | undefined): string {
  return entry === undefined ? node.id : `${node.id}-${entry.id}`;
}

interface RenderContext {
  doc: PlinthDocument;
  assetBase: string;
  images: Set<string>;
}

function renderChildren(
  node: PlinthNode,
  entry: Entry | undefined,
  ctx: RenderContext,
): string {
  return node.children.map((child) => renderNode(child, entry, ctx)).join('');
}

function renderNode(node: PlinthNode, entry: Entry | undefined, ctx: RenderContext): string {
  const id = idOf(node, entry);
  const attrs = `id="${id}" class="${classesOf(node)}"`;
  switch (node.type) {
    case 'page':
      return `<main ${attrs}>${renderChildren(node, entry, ctx)}</main>`;
    case 'section':
      return `<section ${attrs}>${renderChildren(node, entry, ctx)}</section>`;
    case 'stack':
      return `<div ${attrs}>${renderChildren(node, entry, ctx)}</div>`;
    case 'heading': {
      const level = Math.min(3, Math.max(1, Number(node.props['level'] ?? 1)));
      const bound = boundPropValue(node, 'text', entry, ctx.doc.collection.fields);
      return `<h${level} ${attrs}>${escapeTextContent(bound.value)}</h${level}>`;
    }
    case 'text': {
      const bound = boundPropValue(node, 'text', entry, ctx.doc.collection.fields);
      if (bound.field?.kind === 'rich_text') {
        return `<div ${attrs}>${bound.value}</div>`;
      }
      return `<p ${attrs}>${escapeTextContent(bound.value)}</p>`;
    }
    case 'image': {
      const bound = boundPropValue(node, 'imageId', entry, ctx.doc.collection.fields);
      const imageId = bound.value;
      if (imageId !== '') ctx.images.add(imageId);
      const src = imageId === '' ? '' : `${ctx.assetBase}/${imageId}`;
      const alt = escapeHtml(String(node.props['alt'] ?? ''));
      return `<img ${attrs} src="${src}" alt="${alt}" style="object-position:${focalPosition(node)}">`;
    }
    case 'button': {
      const bound = boundPropValue(node, 'text', entry, ctx.doc.collection.fields);
      const href = escapeHtml(String(node.props['href'] ?? '/'));
      return `<a ${attrs} href="${href}">${escapeTextContent(bound.value)}</a>`;
    }
    case 'nav': {
      const listId = `${id}-list`;
      const buttonId = `${id}-menu`;
      return (
        `<nav ${attrs} aria-label="Site">` +
        `<button id="${buttonId}" class="pl-menu" type="button" aria-expanded="false" ` +
        `aria-controls="${listId}">Menu</button>` +
        `<div id="${listId}" class="pl-nav-list" data-nav-list data-nav-button="${buttonId}" ` +
        `data-motion="closed" data-progress="0.00">${renderChildren(node, entry, ctx)}</div>` +
        `</nav>`
      );
    }
    case 'collection_list': {
      const template = node.children[0];
      const entries = [...ctx.doc.collection.entries].sort((a, b) => a.order - b.order);
      if (template === undefined || entries.length === 0) {
        return `<ul ${attrs}><li class="pl-empty-list">${notices.emptyList}</li></ul>`;
      }
      const rows = entries
        .map(
          (item) =>
            `<li data-collection-row="${item.id}">${renderNode(template, item, ctx)}</li>`,
        )
        .join('');
      return `<ul ${attrs}>${rows}</ul>`;
    }
  }
}

export interface RenderedPage {
  html: string;
  imageIds: string[];
}

/** One page rendered into the fixed snapshot that the public address serves. */
export function renderPublishedPage(
  doc: PlinthDocument,
  page: Page,
  assetBase: string,
): RenderedPage {
  const ctx: RenderContext = { doc, assetBase, images: new Set() };
  const body = renderNode(page.root, undefined, ctx);
  const title = `${page.name} · ${doc.name}`;
  const html =
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeTextContent(title)}</title>` +
    `<style>${fontFaces()}${PAGE_CSS}${publishedCss(page, doc.tokens)}</style>` +
    `</head><body>` +
    `<a class="pl-skip" href="#${page.root.id}">Skip to content</a>` +
    body +
    (hasNav(page) ? `<script>${MENU_SCRIPT}</script>` : '') +
    `</body></html>`;
  return { html, imageIds: [...ctx.images] };
}

function hasNav(page: Page): boolean {
  return allNodes(page.root).some((node) => node.type === 'nav');
}
