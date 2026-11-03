import { FONT_FACE_CSS, nodeCss } from "../shared/nodecss.js";
import { escapeHtml, sanitizeRichText } from "../shared/richtext.js";
import { declarations } from "../shared/styles.js";
import { BREAKPOINTS, type Breakpoint, type DocNode, type Entry, type Page, type WorkspaceDoc } from "../shared/types.js";
import { notice } from "../shared/notices.js";
import { menuDisclosure } from "./snapshot-menu.js";

/** Published breakpoint ranges (Breakpoints: Widths), as exclusive media queries. */
const MEDIA: Record<Breakpoint, string> = {
  desktop: "(min-width: 1280px)",
  tablet: "(min-width: 768px) and (max-width: 1279.98px)",
  phone: "(max-width: 767.98px)",
};

const PUBLISHED_CSS = `
html{-webkit-text-size-adjust:100%}
body{margin:0}
*,*::before,*::after{box-sizing:border-box}
.pl-skip{position:absolute;left:8px;top:-80px;z-index:10;padding:12px 16px;min-height:44px;background:#1d4ed8;color:#ffffff;font-weight:600;text-decoration:none;border-radius:4px}
.pl-skip:focus{top:8px;outline:2px solid #1d4ed8;outline-offset:2px}
a:focus-visible,button:focus-visible{outline:2px solid #1d4ed8;outline-offset:2px}
.pl-menu{display:none}
.pl-navlist{display:contents}
@media (max-width: 767.98px){
  body .pn-button,body .pn-text a{min-width:44px;min-height:44px}
  body .pn-text a{display:inline-block;line-height:44px}
  .pl-menu{display:inline-flex;align-items:center;gap:8px;min-width:44px;min-height:44px;margin:8px;padding:0 16px;border:1px solid #1d1b18;border-radius:6px;background:#ffffff;color:#1d1b18;font:600 1rem/1 "IBM Plex Sans",system-ui,sans-serif}
  .pl-navlist{display:flex;flex-direction:column;align-items:flex-start;gap:8px;width:100%;padding:0 8px 8px}
  .pl-navlist[data-motion="closed"]{display:none}
}
`;

interface Rendering {
  html: string;
  images: Set<string>;
}

interface Row {
  entry: Entry;
}

class Renderer {
  readonly rules = new Map<string, { node: DocNode; selectors: string[] }>();
  readonly images = new Set<string>();
  constructor(
    private readonly doc: WorkspaceDoc,
    private readonly assets: string,
  ) {}

  private rule(node: DocNode, id: string): void {
    const existing = this.rules.get(node.id);
    if (existing) existing.selectors.push(`#${id}`);
    else this.rules.set(node.id, { node, selectors: [`#${id}`] });
  }

  private boundValue(node: DocNode, row: Row | null, prop: "text" | "imageId"): string | undefined {
    const field = node.bind?.[prop];
    if (!row || !field) return undefined;
    return row.entry.values[field] ?? "";
  }

  node(node: DocNode, row: Row | null): string {
    const id = row ? `${node.id}-${row.entry.id}` : node.id;
    this.rule(node, id);
    const cls = `pn pn-${node.type}`;
    const kids = () => node.children.map((c) => this.node(c, row)).join("");
    switch (node.type) {
      case "page":
        return `<main id="${id}" class="${cls}" tabindex="-1">${kids()}</main>`;
      case "section":
        return `<section id="${id}" class="${cls}">${kids()}</section>`;
      case "stack":
        return `<div id="${id}" class="${cls}">${kids()}</div>`;
      case "heading": {
        const level = node.props.level ?? 1;
        const text = this.boundValue(node, row, "text") ?? node.props.text ?? "";
        return `<h${level} id="${id}" class="${cls} pn-h${level}">${escapeHtml(text)}</h${level}>`;
      }
      case "text": {
        const field = node.bind?.text && this.doc.collection.fields.find((f) => f.name === node.bind?.text);
        const value = this.boundValue(node, row, "text");
        if (row && field && field.kind === "rich_text") return `<div id="${id}" class="${cls}">${sanitizeRichText(value ?? "")}</div>`;
        return `<p id="${id}" class="${cls}">${escapeHtml(value ?? node.props.text ?? "")}</p>`;
      }
      case "button": {
        const text = this.boundValue(node, row, "text") ?? node.props.text ?? "";
        return `<a id="${id}" class="${cls}" href="${escapeHtml(node.props.href ?? "/")}">${escapeHtml(text)}</a>`;
      }
      case "image": {
        const imageId = this.boundValue(node, row, "imageId") ?? node.props.imageId ?? "";
        if (!imageId) return `<div id="${id}" class="${cls}" role="img" aria-label="${escapeHtml(node.props.alt ?? "")}"></div>`;
        this.images.add(imageId);
        return `<img id="${id}" class="${cls}" src="${this.assets}/${imageId}" alt="${escapeHtml(node.props.alt ?? "")}">`;
      }
      case "nav":
        return (
          `<nav id="${id}" class="${cls}" aria-label="Site">` +
          `<button type="button" class="pl-menu" aria-expanded="false" aria-controls="${id}-links">Menu</button>` +
          `<div id="${id}-links" class="pl-navlist" data-motion="closed" data-progress="0.00">${kids()}</div></nav>`
        );
      case "collection_list": {
        const entries = [...this.doc.collection.entries].sort((a, b) => a.order - b.order);
        const template = node.children[0];
        const items = entries.length && template
          ? entries.map((entry) => `<li class="pl-entry" data-collection-row="${entry.id}">${this.node(template, { entry })}</li>`).join("")
          : `<li class="pl-empty">${notice.emptyList}</li>`;
        return `<ul id="${id}" class="${cls}">${items}</ul>`;
      }
    }
  }

  css(): string {
    const parts: string[] = [];
    for (const bp of BREAKPOINTS) {
      const rules: string[] = [];
      for (const { node, selectors } of this.rules.values()) {
        const decls = declarations(node.styles, bp, this.doc.tokens);
        if (decls.length) rules.push(`${selectors.join(",")}{${decls.map(([k, v]) => `${k}:${v}`).join(";")}}`);
      }
      if (rules.length) parts.push(`@media ${MEDIA[bp]}{${rules.join("\n")}}`);
    }
    for (const { node, selectors } of this.rules.values())
      if (node.type === "image") parts.push(`${selectors.join(",")}{object-position:${node.props.focalX ?? 50}% ${node.props.focalY ?? 50}%}`);
    return parts.join("\n");
  }
}

/** Render a page of the current document into one self-contained HTML snapshot. */
export function renderSnapshot(doc: WorkspaceDoc, page: Page): Rendering {
  const assets = `/p/${doc.slug}/${page.slug}/assets`;
  const renderer = new Renderer(doc, assets);
  const main = renderer.node(page.root, null);
  const hasNav = renderer.rules.size > 0 && [...renderer.rules.values()].some((r) => r.node.type === "nav");
  const script = hasNav ? `<script>(${menuDisclosure.toString()})();</script>` : "";
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(`${page.name} · ${doc.name}`)}</title>` +
    `<link rel="preload" href="/fonts/ibm-plex-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>` +
    `<link rel="preload" href="/fonts/space-grotesk-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin>` +
    `<style>${FONT_FACE_CSS}\n${PUBLISHED_CSS}\n${nodeCss("body")}\n${renderer.css()}</style></head>` +
    `<body><a class="pl-skip" href="#${page.root.id}">Skip to content</a>${main}${script}</body></html>`;
  return { html, images: renderer.images };
}

/** The public not-found and storage-unavailable pages share the gridded ground. */
export function publicMessagePage(heading: string, text: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(heading)}</title><style>${FONT_FACE_CSS}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box;background-color:#f5f0e6;
background-image:linear-gradient(#e6dfd0 1px,transparent 1px),linear-gradient(90deg,#e6dfd0 1px,transparent 1px);background-size:8px 8px;
color:#1d1b18;font:400 1rem/1.5 "IBM Plex Sans",system-ui,sans-serif}
main{max-width:32rem;text-align:center}
h1{font:700 1.728rem/1.2 "Space Grotesk","IBM Plex Sans",system-ui,sans-serif;margin:0 0 8px}
p{margin:0;color:#5a544a}</style></head>` +
    `<body><main><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(text)}</p></main></body></html>`
  );
}
