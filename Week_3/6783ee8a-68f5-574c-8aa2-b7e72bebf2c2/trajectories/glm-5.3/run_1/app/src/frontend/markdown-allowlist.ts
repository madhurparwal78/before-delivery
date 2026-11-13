const ALLOWED_TAGS = new Set([
  "b", "i", "em", "strong", "code", "pre", "br", "p", "ul", "ol", "li",
  "a", "img", "table", "thead", "tbody", "tr", "th", "td", "sub", "sup",
]);

const ALLOWED_ATTRS = new Set(["href", "src", "alt", "title"]);

const LINK_SCHEMES = ["https:", "http:", "mailto:"];

/** The markdown allowlist in one place: same filtered result for every role. */
export function filterHtml(html: string): string {
  let out = "";
  let i = 0;
  while (i < html.length) {
    const open = html.indexOf("<", i);
    if (open === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, open);
    const close = findTagEnd(html, open);
    if (close === -1) {
      out += html.slice(open);
      break;
    }
    const tag = html.slice(open, close + 1);
    out += filterTag(tag);
    i = close + 1;
  }
  return out;
}

function findTagEnd(html: string, from: number): number {
  const inQuote = (index: number): boolean => {
    let quote: string | null = null;
    for (let i = from; i < index; i++) {
      const ch = html[i];
      if (quote !== null) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
    }
    return false;
  };
  for (let i = from; i < html.length; i++) {
    if (html[i] === ">" && !inQuote(i)) return i;
  }
  return -1;
}

function filterTag(tag: string): string {
  const match = tag.match(/^<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/);
  if (match === null) return escapeHtml(tag);
  const name = match[1].toLowerCase();
  const closing = tag.startsWith("</");
  if (!ALLOWED_TAGS.has(name)) return "";
  if (closing) return `</${name}>`;
  const attrText = tag.slice(match[0].length, tag.length - 1);
  const kept: string[] = [];
  const attrRe = /([a-zA-Z][a-zA-Z0-9-]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let attrMatch: RegExpExecArray | null;
  while ((attrMatch = attrRe.exec(attrText)) !== null) {
    const attr = attrMatch[1].toLowerCase();
    if (!ALLOWED_ATTRS.has(attr)) continue;
    const raw = attrMatch[3] ?? attrMatch[4] ?? attrMatch[5] ?? "";
    const value = raw;
    if (name === "a" && attr === "href") {
      if (!schemeAllowed(value)) continue;
      kept.push(`href="${escapeAttr(value)}"`);
      continue;
    }
    if (name === "img" && attr === "src") {
      if (!imageSrcAllowed(value)) continue;
      kept.push(`src="${escapeAttr(value)}"`);
      continue;
    }
    kept.push(`${attr}="${escapeAttr(value)}"`);
  }
  if (name === "img" && !kept.some((k) => k.startsWith("src="))) return "";
  if (name === "a" && !kept.some((k) => k.startsWith("href="))) {
    return "";
  }
  return `<${name}${kept.length > 0 ? " " + kept.join(" ") : ""}>`;
}

function schemeAllowed(value: string): boolean {
  const trimmed = value.trim();
  const scheme = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (scheme === null) return true;
  return LINK_SCHEMES.includes(`${scheme[1].toLowerCase()}:`);
}

function imageSrcAllowed(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("attachment:")) return true;
  return schemeAllowed(trimmed);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/'/g, "&#39;");
}

export type TocEntry = { level: number; text: string; number: string; cellId: string; paragraphIndex: number };

/** Table-of-contents numbering in one place: counters of each used level down to its own,
 *  joined by dots, with an unseen level counting as 0. */
export function numberHeadings(headings: { level: number; text: string; cellId: string; paragraphIndex: number }[]): TocEntry[] {
  const levelsUsed = [...new Set(headings.map((h) => h.level))].sort((a, b) => a - b);
  if (levelsUsed.length === 0) return [];
  const shallowest = levelsUsed[0];
  const counters = new Map<number, number>();
  for (const level of levelsUsed) counters.set(level, 0);
  return headings.map((heading) => {
    const chain: number[] = [];
    for (const level of levelsUsed) {
      if (level < heading.level) {
        chain.push(counters.get(level) ?? 0);
        continue;
      }
      if (level === heading.level) {
        const next = (counters.get(level) ?? 0) + 1;
        counters.set(level, next);
        chain.push(next);
        for (const deeper of levelsUsed) {
          if (deeper > heading.level) counters.set(deeper, 0);
        }
        continue;
      }
      break;
    }
    void shallowest;
    return { ...heading, number: chain.join(".") };
  });
}

/** Heading texts outside code blocks, in document order. */
export function headingsFromMarkdown(source: string): { level: number; text: string; index: number }[] {
  const lines = source.split("\n");
  const found: { level: number; text: string; index: number }[] = [];
  let inFence = false;
  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (match !== null) {
      found.push({ level: match[1].length, text: match[2].trim(), index });
    }
  });
  return found;
}
