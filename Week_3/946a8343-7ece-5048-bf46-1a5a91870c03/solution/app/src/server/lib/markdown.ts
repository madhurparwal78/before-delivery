// The wiki's Markdown subset: headings, paragraphs, bold, italic, inline code, fenced code blocks, lists, tables,
// links to http, https, / and #, and images from project files. Every other character is escaped text.

interface MarkdownOptions {
  /** Maps a project file path to the URL of its raw content; without it images print their alt text. */
  readonly imageBase?: (path: string) => string;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/gu, (char) => HTML_ESCAPES[char] ?? char);
}

const LINK_URL = /^(?:https?:\/\/|\/|#)/iu;
const ESCAPABLE = /[\\`*_[\]()#+\-.!|<>{}~&"']/u;

function isLinkUrl(url: string): boolean {
  return LINK_URL.test(url);
}

function projectFilePath(url: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(url) || url.startsWith("//") || url.startsWith("#")) return null;
  const path = url.replace(/^\/+/u, "");
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return path;
}

interface Bracketed {
  readonly inner: string;
  readonly url: string;
  readonly end: number;
}

/** `[inner](url)` starting at `start` (the `[`), with balanced brackets and parentheses. */
function bracketed(text: string, start: number): Bracketed | null {
  let depth = 0;
  let close = -1;
  for (let i = start; i < text.length; i++) {
    const char = text.charAt(i);
    if (char === "\\") i++;
    else if (char === "`") {
      const span = codeSpanEnd(text, i);
      if (span !== null) i = span - 1;
    } else if (char === "[") depth++;
    else if (char === "]" && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close === -1 || text.charAt(close + 1) !== "(") return null;
  let parens = 0;
  for (let i = close + 1; i < text.length; i++) {
    const char = text.charAt(i);
    if (/\s/u.test(char)) return null;
    if (char === "(") parens++;
    else if (char === ")" && --parens === 0) {
      return { inner: text.slice(start + 1, close), url: text.slice(close + 2, i), end: i + 1 };
    }
  }
  return null;
}

/** Index just past the code span that opens at `start`, or null when the backtick run is never closed. */
function codeSpanEnd(text: string, start: number): number | null {
  let run = 0;
  while (text.charAt(start + run) === "`") run++;
  for (let i = start + run; i < text.length; i++) {
    if (text.charAt(i) !== "`") continue;
    let closing = 0;
    while (text.charAt(i + closing) === "`") closing++;
    if (closing === run) return i + closing;
    i += closing - 1;
  }
  return null;
}

/** Index of the closing `delimiter` for an emphasis that opens at `from`, or -1. */
function findClosing(text: string, from: number, delimiter: string): number {
  const char = delimiter.charAt(0);
  for (let i = from; i < text.length; i++) {
    const current = text.charAt(i);
    if (current === "\\") i++;
    else if (current === "`") {
      const span = codeSpanEnd(text, i);
      if (span !== null) i = span - 1;
    } else if (current === char) {
      let run = 0;
      while (text.charAt(i + run) === char) run++;
      const previous = text.charAt(i - 1);
      const after = text.charAt(i + run);
      const fits = delimiter.length === 2 ? run >= 2 : run === 1;
      if (i > from && !/\s/u.test(previous) && fits) {
        const wordEdge = char === "_" && /[\p{L}\p{N}]/u.test(after);
        if (!wordEdge) return i + run - delimiter.length;
      }
      i += run - 1;
    }
  }
  return -1;
}

function renderLink(inner: string, url: string, options: MarkdownOptions): string {
  const label = renderInline(inner, options);
  if (!isLinkUrl(url)) return label;
  return `<a href="${escapeHtml(url)}">${label}</a>`;
}

function renderImage(alt: string, url: string, options: MarkdownOptions): string {
  const path = projectFilePath(url);
  if (path === null || options.imageBase === undefined) return escapeHtml(alt);
  return `<img src="${escapeHtml(options.imageBase(path))}" alt="${escapeHtml(alt)}">`;
}

function renderInline(text: string, options: MarkdownOptions): string {
  let html = "";
  let i = 0;
  while (i < text.length) {
    const char = text.charAt(i);
    const next = text.charAt(i + 1);
    if (char === "\\" && next !== "" && ESCAPABLE.test(next)) {
      html += escapeHtml(next);
      i += 2;
    } else if (char === "`") {
      const end = codeSpanEnd(text, i);
      let run = 0;
      while (text.charAt(i + run) === "`") run++;
      if (end === null) {
        html += "`".repeat(run);
        i += run;
      } else {
        html += `<code>${escapeHtml(text.slice(i + run, end - run).replace(/^ (.*) $/u, "$1"))}</code>`;
        i = end;
      }
    } else if (char === "!" && next === "[") {
      const image = bracketed(text, i + 1);
      if (image === null) {
        html += "!";
        i += 1;
      } else {
        html += renderImage(image.inner, image.url, options);
        i = image.end;
      }
    } else if (char === "[") {
      const link = bracketed(text, i);
      if (link === null) {
        html += "[";
        i += 1;
      } else {
        html += renderLink(link.inner, link.url, options);
        i = link.end;
      }
    } else if (char === "*" || char === "_") {
      const wordStart = char === "_" && /[\p{L}\p{N}]/u.test(text.charAt(i - 1));
      const delimiter = next === char ? char + char : char;
      const opens = !wordStart && !/\s/u.test(text.charAt(i + delimiter.length)) && i + delimiter.length < text.length;
      const close = opens ? findClosing(text, i + delimiter.length, delimiter) : -1;
      if (close === -1) {
        html += escapeHtml(char);
        i += 1;
      } else {
        const tag = delimiter.length === 2 ? "strong" : "em";
        html += `<${tag}>${renderInline(text.slice(i + delimiter.length, close), options)}</${tag}>`;
        i = close + delimiter.length;
      }
    } else {
      html += escapeHtml(char);
      i += 1;
    }
  }
  return html;
}

const FENCE = /^ {0,3}(?:(`{3,})[^`]*|(~{3,}).*)$/u;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/u;
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])[ \t]+(\S.*)$/u;
const TABLE_SEPARATOR = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/u;

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < row.length; i++) {
    const char = row.charAt(i);
    if (char === "\\" && row.charAt(i + 1) === "|") {
      cell += "|";
      i++;
    } else if (char === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function startsTable(lines: readonly string[], at: number): boolean {
  const header = lines[at];
  const separator = lines[at + 1];
  if (header === undefined || separator === undefined || !header.includes("|")) return false;
  return TABLE_SEPARATOR.test(separator) && separator.includes("-") && splitRow(separator).length === splitRow(header).length;
}

function startsBlock(lines: readonly string[], at: number): boolean {
  const line = lines[at] ?? "";
  return FENCE.test(line) || HEADING.test(line) || LIST_ITEM.test(line) || startsTable(lines, at);
}

function renderTable(lines: readonly string[], start: number, options: MarkdownOptions): { html: string; next: number } {
  const header = splitRow(lines[start] ?? "");
  let html = `<table><thead><tr>${header.map((cell) => `<th>${renderInline(cell, options)}</th>`).join("")}</tr></thead>`;
  let next = start + 2;
  const rows: string[] = [];
  while (next < lines.length && (lines[next] ?? "").trim() !== "" && (lines[next] ?? "").includes("|")) {
    const cells = splitRow(lines[next] ?? "");
    rows.push(`<tr>${header.map((_, column) => `<td>${renderInline(cells[column] ?? "", options)}</td>`).join("")}</tr>`);
    next++;
  }
  html += rows.length > 0 ? `<tbody>${rows.join("")}</tbody></table>` : "</table>";
  return { html, next };
}

function renderList(lines: readonly string[], start: number, options: MarkdownOptions): { html: string; next: number } {
  const first = LIST_ITEM.exec(lines[start] ?? "");
  const indent = first?.[1]?.length ?? 0;
  const ordered = /^\d/u.test(first?.[2] ?? "");
  const items: string[] = [];
  let next = start;
  while (next < lines.length) {
    const match = LIST_ITEM.exec(lines[next] ?? "");
    if (match === null || (match[1]?.length ?? 0) !== indent || /^\d/u.test(match[2] ?? "") !== ordered) break;
    const text = [match[3] ?? ""];
    let nested = "";
    next++;
    while (next < lines.length) {
      const line = lines[next] ?? "";
      const lineIndent = line.length - line.trimStart().length;
      if (line.trim() === "" || lineIndent <= indent) break;
      if (LIST_ITEM.test(line)) {
        const sub = renderList(lines, next, options);
        nested += sub.html;
        next = sub.next;
      } else {
        text.push(line.trim());
        next++;
      }
    }
    items.push(`<li>${renderInline(text.join("\n"), options)}${nested}</li>`);
    let peek = next;
    while (peek < lines.length && (lines[peek] ?? "").trim() === "") peek++;
    const upcoming = LIST_ITEM.exec(lines[peek] ?? "");
    if (peek > next && upcoming !== null && (upcoming[1]?.length ?? 0) === indent) next = peek;
  }
  const tag = ordered ? "ol" : "ul";
  const startNumber = ordered ? Number.parseInt(first?.[2] ?? "1", 10) : 1;
  const attribute = ordered && startNumber !== 1 ? ` start="${startNumber}"` : "";
  return { html: `<${tag}${attribute}>${items.join("")}</${tag}>`, next };
}

export function renderMarkdown(source: string, options: MarkdownOptions = {}): string {
  const lines = source.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    const heading = HEADING.exec(line);
    if (fence !== null) {
      const marker = fence[1] ?? fence[2] ?? "```";
      const code: string[] = [];
      i++;
      while (i < lines.length) {
        const current = lines[i] ?? "";
        i++;
        const closing = current.trim();
        if (closing.length >= marker.length && closing === marker.charAt(0).repeat(closing.length)) break;
        code.push(current);
      }
      blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}${code.length > 0 ? "\n" : ""}</code></pre>`);
    } else if (heading !== null) {
      const level = heading[1]?.length ?? 1;
      blocks.push(`<h${level}>${renderInline(heading[2] ?? "", options)}</h${level}>`);
      i++;
    } else if (startsTable(lines, i)) {
      const table = renderTable(lines, i, options);
      blocks.push(table.html);
      i = table.next;
    } else if (LIST_ITEM.test(line)) {
      const list = renderList(lines, i, options);
      blocks.push(list.html);
      i = list.next;
    } else {
      const paragraph = [line.trim()];
      i++;
      while (i < lines.length && (lines[i] ?? "").trim() !== "" && !startsBlock(lines, i)) {
        paragraph.push((lines[i] ?? "").trim());
        i++;
      }
      blocks.push(`<p>${renderInline(paragraph.join("\n"), options)}</p>`);
    }
  }
  return blocks.join("\n");
}
