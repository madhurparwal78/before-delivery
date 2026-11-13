import { texToMathML } from './tex.js';

/**
 * The one markdown allowlist. Raw HTML keeps only these tags; every other tag
 * is removed and its text content kept as plain text.
 */
const ALLOWED_TAGS = [
  'b', 'i', 'em', 'strong', 'code', 'pre', 'br', 'p', 'ul', 'ol', 'li', 'a',
  'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sub', 'sup',
] as const;

const ALLOWED_ATTRIBUTES = ['href', 'src', 'alt', 'title'] as const;

const ALLOWED_LINK_SCHEMES = ['https', 'http', 'mailto'] as const;

const ALLOWED_TAG_SET = new Set<string>(ALLOWED_TAGS);
const ALLOWED_ATTRIBUTE_SET = new Set<string>(ALLOWED_ATTRIBUTES);
const VOID_TAGS = new Set(['br', 'img']);

export interface MarkdownOptions {
  /** Maps an `attachment:<name>` reference to a URL, or null when unknown. */
  resolveAttachment?: (name: string) => string | null;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function schemeOf(url: string): string | null {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(url.trim());
  return match ? match[1].toLowerCase() : null;
}

/** A link target the allowlist keeps, or null when the link must be dropped. */
function linkHref(raw: string): string | null {
  const url = raw.trim();
  const scheme = schemeOf(url);
  if (scheme === null) return url === '' ? null : url;
  return (ALLOWED_LINK_SCHEMES as readonly string[]).includes(scheme) ? url : null;
}

function imageSrc(raw: string, options: MarkdownOptions): string | null {
  const url = raw.trim();
  const scheme = schemeOf(url);
  if (scheme === 'attachment') {
    const name = url.slice('attachment:'.length);
    const resolved = options.resolveAttachment ? options.resolveAttachment(name) : null;
    return resolved;
  }
  if (scheme === null) return url === '' ? null : url;
  return scheme === 'https' || scheme === 'http' ? url : null;
}

interface InlineItem {
  kind: 'html' | 'text';
  value: string;
}

const PLACEHOLDER = '\u0000';

/** Reads one raw HTML tag at position i, returning the HTML to keep. */
function readRawTag(
  text: string,
  index: number,
  openTags: string[],
  options: MarkdownOptions,
): { html: string; next: number } | null {
  const rest = text.slice(index);
  if (rest.startsWith('<!--')) {
    const end = rest.indexOf('-->');
    return { html: '', next: end < 0 ? text.length : index + end + 3 };
  }
  const match = /^<(\/?)([A-Za-z][A-Za-z0-9]*)((?:[^<>"']|"[^"]*"|'[^']*')*?)(\/?)>/.exec(rest);
  if (!match) return null;
  const [raw, slash, rawName, rawAttrs] = match;
  const name = rawName.toLowerCase();
  const next = index + raw.length;
  if (!ALLOWED_TAG_SET.has(name)) return { html: '', next };
  if (slash === '/') {
    const at = openTags.lastIndexOf(name);
    if (at < 0) return { html: '', next };
    openTags.splice(at, 1);
    return { html: `</${name}>`, next };
  }
  const attributes = new Map<string, string>();
  const attrPattern = /([A-Za-z][A-Za-z0-9-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let attrMatch = attrPattern.exec(rawAttrs);
  while (attrMatch) {
    const key = attrMatch[1].toLowerCase();
    const value = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';
    if (ALLOWED_ATTRIBUTE_SET.has(key)) attributes.set(key, value);
    attrMatch = attrPattern.exec(rawAttrs);
  }
  if (name === 'a') {
    const href = attributes.has('href') ? linkHref(attributes.get('href') as string) : null;
    if (href === null) return { html: '', next };
    const title = attributes.get('title');
    const titleAttr = title === undefined ? '' : ` title="${escapeHtml(title)}"`;
    openTags.push(name);
    return { html: `<a href="${escapeHtml(href)}"${titleAttr}>`, next };
  }
  if (name === 'img') {
    const src = attributes.has('src') ? imageSrc(attributes.get('src') as string, options) : null;
    const alt = attributes.get('alt') ?? '';
    const srcAttr = src === null ? '' : ` src="${escapeHtml(src)}"`;
    const title = attributes.get('title');
    const titleAttr = title === undefined ? '' : ` title="${escapeHtml(title)}"`;
    return { html: `<img${srcAttr} alt="${escapeHtml(alt)}"${titleAttr}>`, next };
  }
  const kept: string[] = [];
  for (const key of ['title']) {
    const value = attributes.get(key);
    if (value !== undefined) kept.push(` ${key}="${escapeHtml(value)}"`);
  }
  if (VOID_TAGS.has(name)) return { html: `<${name}>`, next };
  openTags.push(name);
  return { html: `<${name}${kept.join('')}>`, next };
}

/** Finds the end of an inline formula opened at `start` (the `$`). */
function findInlineMathEnd(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i += 1) {
    if (text[i] === '\\') {
      i += 1;
      continue;
    }
    if (text[i] === '$' && !/\s/.test(text[i - 1])) return i;
  }
  return -1;
}

function renderInline(text: string, options: MarkdownOptions): string {
  const items: InlineItem[] = [];
  const openTags: string[] = [];
  let plain = '';
  const flush = (): void => {
    if (plain !== '') {
      items.push({ kind: 'text', value: plain });
      plain = '';
    }
  };
  const pushHtml = (html: string): void => {
    flush();
    items.push({ kind: 'html', value: html });
  };

  const source = text.replace(/\u0000/g, '');
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\' && i + 1 < source.length && /[\\`*_{}[\]()#+\-.!$|<>~"']/.test(source[i + 1])) {
      plain += source[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const fence = /^`+/.exec(source.slice(i))as RegExpExecArray;
      const close = source.indexOf(fence[0], i + fence[0].length);
      if (close > 0) {
        const code = source.slice(i + fence[0].length, close);
        pushHtml(`<code>${escapeHtml(code)}</code>`);
        i = close + fence[0].length;
        continue;
      }
    }
    if (ch === '$' && source[i + 1] === '$') {
      const close = source.indexOf('$$', i + 2);
      if (close > 0) {
        const tex = source.slice(i + 2, close);
        const math = texToMathML(tex, true);
        pushHtml(math ?? escapeHtml(`$$${tex}$$`));
        i = close + 2;
        continue;
      }
    }
    if (ch === '$' && i + 1 < source.length && !/\s/.test(source[i + 1]) && source[i + 1] !== '$') {
      const close = findInlineMathEnd(source, i);
      if (close > 0) {
        const tex = source.slice(i + 1, close);
        const math = texToMathML(tex, false);
        pushHtml(math ?? escapeHtml(`$${tex}$`));
        i = close + 1;
        continue;
      }
    }
    if (ch === '!' && source[i + 1] === '[') {
      const parsed = readLinkLike(source, i + 1);
      if (parsed) {
        const src = imageSrc(parsed.target, options);
        const srcAttr = src === null ? '' : ` src="${escapeHtml(src)}"`;
        const titleAttr = parsed.title === null ? '' : ` title="${escapeHtml(parsed.title)}"`;
        pushHtml(`<img${srcAttr} alt="${escapeHtml(parsed.label)}"${titleAttr}>`);
        i = parsed.next;
        continue;
      }
    }
    if (ch === '[') {
      const parsed = readLinkLike(source, i);
      if (parsed) {
        const href = linkHref(parsed.target);
        const label = renderInline(parsed.label, options);
        if (href === null) {
          pushHtml(label);
        } else {
          const titleAttr = parsed.title === null ? '' : ` title="${escapeHtml(parsed.title)}"`;
          pushHtml(`<a href="${escapeHtml(href)}"${titleAttr}>${label}</a>`);
        }
        i = parsed.next;
        continue;
      }
    }
    if (ch === '<') {
      const tag = readRawTag(source, i, openTags, options);
      if (tag) {
        pushHtml(tag.html);
        i = tag.next;
        continue;
      }
    }
    plain += ch;
    i += 1;
  }
  flush();
  while (openTags.length > 0) {
    const name = openTags.pop() as string;
    items.push({ kind: 'html', value: `</${name}>` });
  }

  const htmlParts: string[] = [];
  let composite = '';
  for (const item of items) {
    if (item.kind === 'text') {
      composite += escapeHtml(item.value);
    } else {
      composite += `${PLACEHOLDER}${htmlParts.length}${PLACEHOLDER}`;
      htmlParts.push(item.value);
    }
  }
  composite = composite
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>')
    .replace(/(\*|_)(?=\S)([\s\S]*?\S)\1/g, '<em>$2</em>');
  return composite.replace(
    new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'),
    (_all, index: string) => htmlParts[Number(index)],
  );
}

interface LinkLike {
  label: string;
  target: string;
  title: string | null;
  next: number;
}

function readLinkLike(text: string, start: number): LinkLike | null {
  let depth = 0;
  let labelEnd = -1;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '\\') {
      i += 1;
      continue;
    }
    if (text[i] === '[') depth += 1;
    else if (text[i] === ']') {
      depth -= 1;
      if (depth === 0) {
        labelEnd = i;
        break;
      }
    }
  }
  if (labelEnd < 0 || text[labelEnd + 1] !== '(') return null;
  let parens = 0;
  let targetEnd = -1;
  for (let i = labelEnd + 1; i < text.length; i += 1) {
    if (text[i] === '(') parens += 1;
    else if (text[i] === ')') {
      parens -= 1;
      if (parens === 0) {
        targetEnd = i;
        break;
      }
    }
  }
  if (targetEnd < 0) return null;
  const inner = text.slice(labelEnd + 2, targetEnd).trim();
  const titleMatch = /^(\S*)\s+["'](.*)["']$/.exec(inner);
  return {
    label: text.slice(start + 1, labelEnd),
    target: titleMatch ? titleMatch[1] : inner,
    title: titleMatch ? titleMatch[2] : null,
    next: targetEnd + 1,
  };
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line) && line.includes('-');
}

function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) trimmed = trimmed.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] === '\\' && trimmed[i + 1] === '|') {
      current += '|';
      i += 1;
      continue;
    }
    if (trimmed[i] === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += trimmed[i];
  }
  cells.push(current.trim());
  return cells;
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

interface ListItemLine {
  indent: number;
  ordered: boolean;
  text: string[];
}

function renderList(lines: ListItemLine[], options: MarkdownOptions): string {
  const ordered = lines.length > 0 ? lines[0].ordered : false;
  const tag = ordered ? 'ol' : 'ul';
  const parts: string[] = [`<${tag}>`];
  let index = 0;
  while (index < lines.length) {
    const item = lines[index];
    const children: ListItemLine[] = [];
    index += 1;
    while (index < lines.length && lines[index].indent > item.indent) {
      children.push(lines[index]);
      index += 1;
    }
    const body = renderInline(item.text.join('\n'), options);
    const nested = children.length > 0 ? renderList(children, options) : '';
    parts.push(`<li>${body}${nested}</li>`);
  }
  parts.push(`</${tag}>`);
  return parts.join('');
}

/** Renders one markdown cell to the filtered HTML every role sees. */
export function renderMarkdown(source: string, options: MarkdownOptions = {}): string {
  const lines = source.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const fence = /^\s*(```|~~~)(.*)$/.exec(line);
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2], options)}</h${level}>`);
      i += 1;
      continue;
    }
    if (line.trim() === '$$') {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && lines[i].trim() !== '$$') {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      const tex = body.join('\n');
      const math = texToMathML(tex, true);
      out.push(math ?? `<p>${escapeHtml(`$$${tex}$$`)}</p>`);
      continue;
    }
    if (/^\s*(\*\s*){3,}$/.test(line) || /^\s*(-\s*){3,}$/.test(line) || /^\s*(_\s*){3,}$/.test(line)) {
      out.push('<p></p>');
      i += 1;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitTableRow(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        body.push(splitTableRow(lines[i]));
        i += 1;
      }
      const head = header.map((cell) => `<th>${renderInline(cell, options)}</th>`).join('');
      const rows = body
        .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell, options)}</td>`).join('')}</tr>`)
        .join('');
      out.push(`<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`);
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const items: ListItemLine[] = [];
      while (i < lines.length) {
        const match = LIST_ITEM.exec(lines[i]);
        if (match) {
          items.push({
            indent: match[1].length,
            ordered: /\d/.test(match[2]),
            text: [match[3]],
          });
          i += 1;
          continue;
        }
        if (lines[i].trim() !== '' && items.length > 0 && /^\s+/.test(lines[i])) {
          items[items.length - 1].text.push(lines[i].trim());
          i += 1;
          continue;
        }
        break;
      }
      out.push(renderList(items, options));
      continue;
    }
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*(```|~~~)/.test(lines[i]) &&
      !LIST_ITEM.test(lines[i]) &&
      lines[i].trim() !== '$$'
    ) {
      paragraph.push(lines[i]);
      i += 1;
    }
    const text = paragraph.join('\n');
    const rendered = renderInline(text, options);
    const blockOnly = /^\s*<(p|ul|ol|table|pre)\b/i.test(text.trim());
    out.push(blockOnly ? rendered : `<p>${rendered}</p>`);
  }
  return out.join('\n');
}

/** Filters raw HTML (a `text/html` display output) through the same allowlist. */
export function filterHtml(html: string, options: MarkdownOptions = {}): string {
  return renderInline(html, options);
}

/** The plain text of an inline markdown run, used for headings and search. */
export function inlineText(source: string): string {
  return source
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(\S[\s\S]*?\S)\1/g, '$2')
    .replace(/(\*|_)(\S[\s\S]*?\S)\1/g, '$2')
    .replace(/<[^<>]*>/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!$])/g, '$1')
    .trim();
}
