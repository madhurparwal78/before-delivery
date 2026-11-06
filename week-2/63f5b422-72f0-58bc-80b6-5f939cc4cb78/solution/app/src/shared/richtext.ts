/**
 * The rich-text allowlist: the one place it is decided. Only p, strong, em, ul, ol, li and a with an
 * http:, https: or mailto: href survive; every other element is removed with its text kept (script
 * included) and every other attribute is dropped. The output is well formed and safe as innerHTML.
 */

const ALLOWED = new Set(["p", "strong", "em", "ul", "ol", "li", "a"]);
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "noscript", "iframe", "noembed", "noframes"]);
const SAFE_HREF = /^(https?:|mailto:)/i;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface Tag {
  name: string;
  closing: boolean;
  attrs: Map<string, string>;
  end: number;
}

function readTag(source: string, start: number): Tag | null {
  const head = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(source.slice(start, start + 64));
  if (!head) return null;
  let i = start + head[0].length;
  const attrs = new Map<string, string>();
  while (i < source.length) {
    while (i < source.length && /[\s/]/.test(source[i])) i += 1;
    if (source[i] === ">") return { name: head[2].toLowerCase(), closing: head[1] === "/", attrs, end: i + 1 };
    const nameMatch = /^[^\s/>=]+/.exec(source.slice(i));
    if (!nameMatch) return null;
    const name = nameMatch[0].toLowerCase();
    i += nameMatch[0].length;
    while (i < source.length && /\s/.test(source[i])) i += 1;
    let value = "";
    if (source[i] === "=") {
      i += 1;
      while (i < source.length && /\s/.test(source[i])) i += 1;
      const quote = source[i];
      if (quote === '"' || quote === "'") {
        const close = source.indexOf(quote, i + 1);
        if (close < 0) return null;
        value = source.slice(i + 1, close);
        i = close + 1;
      } else {
        const bare = /^[^\s>]*/.exec(source.slice(i))?.[0] ?? "";
        value = bare;
        i += bare.length;
      }
    }
    if (!attrs.has(name)) attrs.set(name, decodeEntities(value));
  }
  return null;
}

export function sanitizeRichText(source: string): string {
  let out = "";
  const open: string[] = [];
  let i = 0;
  const text = (chunk: string) => {
    out += escapeHtml(decodeEntities(chunk));
  };
  while (i < source.length) {
    const lt = source.indexOf("<", i);
    if (lt < 0) {
      text(source.slice(i));
      break;
    }
    text(source.slice(i, lt));
    if (source.startsWith("<!--", lt)) {
      const close = source.indexOf("-->", lt + 4);
      i = close < 0 ? source.length : close + 3;
      continue;
    }
    if (source.startsWith("<!", lt) || source.startsWith("<?", lt)) {
      const close = source.indexOf(">", lt);
      i = close < 0 ? source.length : close + 1;
      continue;
    }
    const tag = readTag(source, lt);
    if (!tag) {
      text("<");
      i = lt + 1;
      continue;
    }
    i = tag.end;
    if (!tag.closing && RAW_TEXT.has(tag.name)) {
      const close = source.toLowerCase().indexOf(`</${tag.name}`, i);
      const inner = source.slice(i, close < 0 ? source.length : close);
      out += escapeHtml(inner);
      i = close < 0 ? source.length : Math.max(source.indexOf(">", close) + 1, close + 1);
      continue;
    }
    if (!ALLOWED.has(tag.name)) continue;
    const href = tag.attrs.get("href")?.trim() ?? "";
    if (tag.name === "a" && !tag.closing && !SAFE_HREF.test(href)) {
      open.push("a:dropped");
      continue;
    }
    if (tag.closing) {
      const at = open.lastIndexOf(tag.name);
      const dropped = tag.name === "a" ? open.lastIndexOf("a:dropped") : -1;
      if (dropped > at) {
        open.splice(dropped, 1);
        continue;
      }
      if (at < 0) continue;
      while (open.length > at) {
        const name = open.pop() as string;
        if (name !== "a:dropped") out += `</${name}>`;
      }
      continue;
    }
    open.push(tag.name);
    out += tag.name === "a" ? `<a href="${escapeHtml(href)}">` : `<${tag.name}>`;
  }
  while (open.length) {
    const name = open.pop() as string;
    if (name !== "a:dropped") out += `</${name}>`;
  }
  return out;
}
