// Markdown → HTML under the rendering allowlist from Business rules. Every marked renderer is
// overridden so the only body elements are the allowlisted ones, the only attributes are href and
// rel on links, raw HTML is escaped text and wikilinks are resolved by the caller.
import { Marked, type Tokens } from "marked";
import { nameIndex, nameKey, parseWikilink, type BoundaryNote, type Wikilink } from "./boundary.ts";

type ResolvedLink =
  | { kind: "link"; href: string; text: string }
  | { kind: "text"; text: string; muted: boolean };

type LinkResolver = (link: Wikilink) => ResolvedLink;

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

/** Escapes text for HTML text and double-quoted attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ESCAPES[c]);
}

const EXTERNAL = /^(https?:|mailto:)/i;
const EXTERNAL_REL = "noopener noreferrer nofollow";

interface WikilinkToken extends Tokens.Generic {
  type: "wikilink";
  link: Wikilink;
}

function createMarked(resolve: LinkResolver): Marked {
  const marked = new Marked({ gfm: true, breaks: false, async: false });
  marked.use({
    extensions: [{
      name: "wikilink",
      level: "inline",
      start: (src: string) => {
        const at = src.indexOf("[[");
        return at === -1 ? undefined : at;
      },
      tokenizer: (src: string) => {
        const match = /^\[\[([^\[\]\n]+?)\]\]/.exec(src);
        return match ? { type: "wikilink", raw: match[0], link: parseWikilink(match[1]) } : undefined;
      },
      renderer: (token) => {
        const resolved = resolve((token as WikilinkToken).link);
        if (resolved.kind === "link") return `<a href="${escapeHtml(resolved.href)}">${escapeHtml(resolved.text)}</a>`;
        return resolved.muted
          ? `<span class="wikilink-missing">${escapeHtml(resolved.text)}</span>`
          : escapeHtml(resolved.text);
      },
    }],
    renderer: {
      space: () => "",
      def: () => "",
      heading({ tokens, depth }) {
        const level = Math.min(depth + 1, 4);
        return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>\n`;
      },
      paragraph({ tokens }) {
        return `<p>${this.parser.parseInline(tokens)}</p>\n`;
      },
      text(token) {
        if ("tokens" in token && token.tokens) return this.parser.parseInline(token.tokens);
        return escapeHtml(token.type === "escape" ? token.text : token.raw);
      },
      html({ text, block }) {
        return block ? `<p>${escapeHtml(text.trim())}</p>\n` : escapeHtml(text);
      },
      code({ text }) {
        return `<pre><code>${escapeHtml(text)}</code></pre>\n`;
      },
      codespan({ text }) {
        return `<code>${escapeHtml(text)}</code>`;
      },
      blockquote({ tokens }) {
        return `<blockquote>\n${this.parser.parse(tokens)}</blockquote>\n`;
      },
      list({ ordered, items }) {
        const tag = ordered ? "ol" : "ul";
        return `<${tag}>\n${items.map((item) => this.listitem(item)).join("")}</${tag}>\n`;
      },
      listitem(item) {
        return `<li>${this.parser.parse(item.tokens)}</li>\n`;
      },
      checkbox({ checked }) {
        return checked ? "[x] " : "[ ] ";
      },
      hr: () => "<hr>\n",
      br: () => "<br>",
      strong({ tokens }) {
        return `<strong>${this.parser.parseInline(tokens)}</strong>`;
      },
      em({ tokens }) {
        return `<em>${this.parser.parseInline(tokens)}</em>`;
      },
      del({ tokens }) {
        return this.parser.parseInline(tokens);
      },
      link({ href, tokens }) {
        const label = this.parser.parseInline(tokens);
        return EXTERNAL.test(href.trim())
          ? `<a href="${escapeHtml(href.trim())}" rel="${EXTERNAL_REL}">${label}</a>`
          : label;
      },
      image({ text }) {
        return escapeHtml(text);
      },
      table(token) {
        const cell = (c: Tokens.TableCell) => {
          const tag = c.header ? "th" : "td";
          return `<${tag}>${this.parser.parseInline(c.tokens)}</${tag}>`;
        };
        const head = `<tr>${token.header.map(cell).join("")}</tr>`;
        const rows = token.rows.map((row) => `<tr>${row.map(cell).join("")}</tr>`).join("\n");
        return `<table>\n<thead>${head}</thead>\n${rows ? `<tbody>${rows}</tbody>\n` : ""}</table>\n`;
      },
    },
  });
  return marked;
}

/**
 * Wikilinks under a publish boundary: a link to an inside note becomes a link to its page (label,
 * else that note's title); every other one is plain text (label, else "[withheld]").
 */
export function boundaryLinks(notes: readonly BoundaryNote[], insideIds: Set<string>, pageHref: (noteId: string) => string): LinkResolver {
  const index = nameIndex(notes);
  return (link) => {
    const target = index.get(nameKey(link.target));
    if (target && insideIds.has(target.id)) return { kind: "link", href: pageHref(target.id), text: link.label ?? target.title };
    return { kind: "text", text: link.label ?? "[withheld]", muted: false };
  };
}

/** Renders a note body; `resolve` decides what each wikilink becomes. */
export function renderBody(markdown: string, resolve: LinkResolver): string {
  return createMarked(resolve).parse(markdown) as string;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"' };

/** Plain text of rendered (already resolved) HTML, for the search index and link previews. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot);/g, (e) => ENTITIES[e])
    .replace(/\s+/g, " ")
    .trim();
}
