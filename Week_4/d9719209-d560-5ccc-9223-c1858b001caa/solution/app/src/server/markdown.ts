import { Marked, type Tokens, type TokenizerAndRendererExtension } from 'marked';

/**
 * The sanitiser lives here: every renderer below emits only the allow-listed elements
 * (p em strong a ul ol li blockquote code pre table thead tbody tr th td span br hr) and only
 * the attributes href, rel and class. Raw HTML is escaped, never rendered.
 */
const LINK_REL = 'nofollow ugc noopener noreferrer';
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

/** A link target is kept only when its scheme, ignoring case and whitespace, is allow-listed. */
function safeHref(href: string): string | null {
  const compact = href.replace(/[\s\u0000-\u001f]+/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*:)/i.exec(compact)?.[1]?.toLowerCase();
  return scheme && ALLOWED_PROTOCOLS.has(scheme) ? compact : null;
}

const spoiler: TokenizerAndRendererExtension = {
  name: 'spoiler',
  level: 'inline',
  start: (source: string) => source.indexOf('>!'),
  tokenizer(source: string) {
    const match = /^>!(?=\S)([\s\S]+?)!</.exec(source);
    if (!match) return undefined;
    const text = match[1] ?? '';
    return { type: 'spoiler', raw: match[0], text, tokens: this.lexer.inlineTokens(text) };
  },
  renderer(token) {
    return `<span class="spoiler">${this.parser.parseInline(token.tokens ?? [])}</span>`;
  },
};

const renderer = new Marked({
  gfm: true,
  breaks: false,
  async: false,
  extensions: [spoiler],
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag) {
      const text = escapeHtml(token.text.trim());
      return token.block ? `<p>${text}</p>\n` : text;
    },
    heading(token: Tokens.Heading) {
      return `<p>${this.parser.parseInline(token.tokens)}</p>\n`;
    },
    image(token: Tokens.Image) {
      return escapeHtml(token.text);
    },
    del(token: Tokens.Del) {
      return this.parser.parseInline(token.tokens);
    },
    checkbox() {
      return '';
    },
    code(token: Tokens.Code) {
      return `<pre><code>${escapeHtml(token.text)}</code></pre>\n`;
    },
    list(token: Tokens.List) {
      const tag = token.ordered ? 'ol' : 'ul';
      return `<${tag}>\n${token.items.map((item) => this.listitem(item)).join('')}</${tag}>\n`;
    },
    link(token: Tokens.Link) {
      const inner = this.parser.parseInline(token.tokens);
      const href = safeHref(token.href);
      return href === null ? inner : `<a href="${escapeHtml(href)}" rel="${LINK_REL}">${inner}</a>`;
    },
    tablecell(token: Tokens.TableCell) {
      const tag = token.header ? 'th' : 'td';
      return `<${tag}>${this.parser.parseInline(token.tokens)}</${tag}>\n`;
    },
  },
});

export function renderMarkdown(source: string): string {
  return (renderer.parse(source, { async: false }) as string).trim();
}
