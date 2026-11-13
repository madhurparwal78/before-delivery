import katex from "katex";
import { Marked } from "marked";
import type { Tokens, TokenizerAndRendererExtension } from "marked";

/** Where a cell's markdown is rendered: its notebook and cell, so attachment references can find their image. */
export interface MarkdownContext {
  notebookId: string;
  cellId: string;
}

/** The markdown allowlist lives here: tags, attributes and link schemes, the same for every role. */
const TAGS = new Set(["b", "i", "em", "strong", "code", "pre", "br", "p", "ul", "ol", "li", "a", "img", "table", "thead", "tbody", "tr", "th", "td", "sub", "sup"]);
const VOID_TAGS = new Set(["br", "img"]);
const LINK_SCHEMES = ["https", "http", "mailto"];
const IMAGE_SCHEMES = ["https", "http"];

let current: MarkdownContext = { notebookId: "", cellId: "" };

const escapeText = (text: string): string =>
  text.replace(/&(?!#?\w+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = (text: string): string => escapeText(text).replace(/"/g, "&quot;");

function decodeEntities(text: string): string {
  const box = document.createElement("textarea");
  box.innerHTML = text;
  return box.value;
}

/** The URL when its scheme is allowed, otherwise null. A URL without a scheme is not allowed. */
function allowedUrl(value: string, schemes: string[]): string | null {
  const cleaned = decodeEntities(value).replace(/[\u0000- \u007f-\u009f]/g, "");
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned)?.[1]?.toLowerCase();
  return scheme && schemes.includes(scheme) ? decodeEntities(value).trim() : null;
}

function imageSource(value: string): string | null {
  const web = allowedUrl(value, IMAGE_SCHEMES);
  if (web) return web;
  const name = /^attachment:(.+)$/i.exec(decodeEntities(value).trim())?.[1];
  return name ? `/api/notebooks/${current.notebookId}/attachments/${current.cellId}/${encodeURIComponent(name)}` : null;
}

const TAG = /<(\/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function keptAttributes(tag: string, raw: string): string {
  let out = "";
  for (const match of raw.matchAll(ATTRIBUTE)) {
    const name = (match[1] as string).toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    let kept: string | null = null;
    if (name === "title") kept = decodeEntities(value);
    else if (name === "alt" && tag === "img") kept = decodeEntities(value);
    else if (name === "href" && tag === "a") kept = allowedUrl(value, LINK_SCHEMES);
    else if (name === "src" && tag === "img") kept = imageSource(value);
    if (kept !== null) out += ` ${name}="${escapeAttribute(kept)}"`;
  }
  return out;
}

/** Raw HTML in a cell: allowed tags keep only allowed attributes, every other tag is dropped and its text stays as text. */
function cleanHtml(html: string): string {
  const source = html.replace(/<!--[\s\S]*?-->/g, "");
  let out = "";
  let last = 0;
  for (const match of source.matchAll(TAG)) {
    out += escapeText(source.slice(last, match.index));
    last = (match.index ?? 0) + match[0].length;
    const tag = (match[2] as string).toLowerCase();
    if (!TAGS.has(tag)) continue;
    out += match[1] ? `</${tag}>` : `<${tag}${keptAttributes(tag, match[3] ?? "")}${VOID_TAGS.has(tag) ? " /" : ""}>`;
  }
  return out + escapeText(source.slice(last));
}

/** Math is added after the allowlist: the renderer's own markup is not filtered. TeX that cannot be parsed shows as its source. */
function math(tex: string, display: boolean, source: string): string {
  try {
    return katex.renderToString(tex, { displayMode: display, output: "mathml", throwOnError: true, strict: "ignore" });
  } catch {
    return escapeText(source);
  }
}

interface MathToken extends Tokens.Generic {
  tex: string;
  display: boolean;
}

const inlineMath: TokenizerAndRendererExtension = {
  name: "inlineMath",
  level: "inline",
  start: (src) => src.indexOf("$"),
  tokenizer(src) {
    const display = /^\$\$([^$`]+?)\$\$/.exec(src);
    if (display) return { type: "inlineMath", raw: display[0], tex: display[1], display: true } as MathToken;
    const inline = /^\$([^\s$`](?:[^$`]*[^\s$`])?)\$/.exec(src);
    if (inline) return { type: "inlineMath", raw: inline[0], tex: inline[1], display: false } as MathToken;
    return undefined;
  },
  renderer(token) {
    const t = token as MathToken;
    return math(t.tex, t.display, t.raw);
  },
};

const blockMath: TokenizerAndRendererExtension = {
  name: "blockMath",
  level: "block",
  start: (src) => src.indexOf("$$"),
  tokenizer(src) {
    const found = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(src);
    return found ? ({ type: "blockMath", raw: found[0], tex: found[1], display: true } as MathToken) : undefined;
  },
  renderer(token) {
    const t = token as MathToken;
    return `<p>${math(t.tex.trim(), true, t.raw.trim())}</p>\n`;
  },
};

const marked = new Marked({
  gfm: true,
  extensions: [blockMath, inlineMath],
  renderer: {
    html: ({ text }) => cleanHtml(text),
    link(token) {
      const href = allowedUrl(token.href, LINK_SCHEMES);
      const inner = this.parser.parseInline(token.tokens);
      if (!href) return inner;
      const title = token.title ? ` title="${escapeAttribute(token.title)}"` : "";
      return `<a href="${escapeAttribute(href)}"${title}>${inner}</a>`;
    },
    image(token) {
      const src = imageSource(token.href);
      if (!src) return escapeText(token.text);
      const title = token.title ? ` title="${escapeAttribute(token.title)}"` : "";
      return `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(token.text)}"${title} />`;
    },
  },
});

/** A markdown cell's source as safe HTML. */
export function renderMarkdown(source: string, context: MarkdownContext): string {
  current = context;
  return marked.parse(source, { async: false });
}
