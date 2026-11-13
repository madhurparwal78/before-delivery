import { escapeHtml, filterHtml, numberHeadings } from "./markdown-allowlist.ts";
import temml from "temml";

export type RenderedMarkdown = {
  html: string;
  headings: { level: number; text: string; number: string; anchor: string }[];
};

type AttachmentResolver = (name: string) => string;

/** Inline math needs a non-space right after the opening `$` and before the closing `$`,
 *  on the same paragraph line. `\$` is a literal dollar. */
function splitMath(text: string): { kind: "text" | "math"; content: string; display: boolean }[] {
  const parts: { kind: "text" | "math"; content: string; display: boolean }[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer !== "") parts.push({ kind: "text", content: buffer, display: false });
    buffer = "";
  };
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("\\$", i)) {
      buffer += "$";
      i += 2;
      continue;
    }
    if (text.startsWith("$$", i)) {
      const close = text.indexOf("$$", i + 2);
      if (close !== -1) {
        flush();
        parts.push({ kind: "math", content: text.slice(i + 2, close), display: true });
        i = close + 2;
        continue;
      }
    }
    if (text[i] === "$" && text[i + 1] !== undefined && !/\s/.test(text[i + 1])) {
      let found = -1;
      for (let j = i + 1; j < text.length; j++) {
        const ch = text[j];
        if (ch === "\n") break;
        if (ch === "$" && !/\s/.test(text[j - 1])) {
          found = j;
          break;
        }
      }
      if (found !== -1) {
        flush();
        parts.push({ kind: "math", content: text.slice(i + 1, found), display: false });
        i = found + 1;
        continue;
      }
    }
    buffer += text[i];
    i += 1;
  }
  flush();
  return parts;
}

function mathToHtml(tex: string, display: boolean): string {
  try {
    return temml.renderToString(tex, { displayMode: display, annotate: true });
  } catch {
    return escapeHtml(display ? `$$${tex}$$` : `$${tex}$`);
  }
}

/** Code spans are protected before emphasis, so their contents stay literal. */
function renderInline(text: string, resolveAttachment: AttachmentResolver): string {
  const spans: string[] = [];
  const protectedText = text.replace(/`([^`]*)`/g, (_m, code: string) => {
    spans.push(code);
    return `\u0000${spans.length - 1}\u0000`;
  });
  let out = "";
  for (const part of splitMath(protectedText)) {
    if (part.kind === "math") {
      out += mathToHtml(part.content, part.display);
      continue;
    }
    out += renderEmphasisAndTags(part.content, resolveAttachment);
  }
  return out.replace(/\u0000(\d+)\u0000/g, (_m, index: string) => `<code>${escapeHtml(spans[Number(index)])}</code>`);
}

function renderEmphasisAndTags(text: string, resolveAttachment: AttachmentResolver): string {
  let out = "";
  let i = 0;
  // A dropped opener means its closer must be dropped too, so text stays plain.
  const droppedOpeners = new Set<string>();
  const openers: string[] = [];
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt !== -1 && /^<\/?\s*[a-zA-Z]/.test(text.slice(lt, lt + 3))) {
      out += escapePlain(text.slice(i, lt));
      const close = findTagEnd(text, lt);
      const rawTag = close === -1 ? text.slice(lt) : text.slice(lt, close + 1);
      const filtered = inlineTag(rawTag, resolveAttachment);
      const nameMatch = rawTag.match(/^<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/);
      const name = nameMatch?.[1]?.toLowerCase() ?? "";
      const isClosing = rawTag.startsWith("</");
      if (filtered === "") {
        if (!isClosing) {
          droppedOpeners.add(name);
          openers.push(name);
        } else if (droppedOpeners.has(name)) {
          // The matching opener was removed; drop this closer as well.
        }
      } else {
        if (isClosing && droppedOpeners.has(name)) {
          droppedOpeners.delete(name);
        } else {
          out += filtered;
        }
      }
      i = close === -1 ? text.length : close + 1;
      continue;
    }
    const next = lt === -1 ? text.length : lt;
    out += emphasisText(text.slice(i, next));
    i = next;
    if (next >= text.length) break;
  }
  void openers;
  return out;
}

function escapePlain(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function findTagEnd(text: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") return i;
  }
  return -1;
}

function inlineTag(tag: string, resolveAttachment: AttachmentResolver): string {
  const filtered = filterHtml(tag);
  const srcMatch = filtered.match(/src="([^"]*)"/);
  if (srcMatch !== null && srcMatch[1].startsWith("attachment:")) {
    return filtered.replace(srcMatch[0], `src="${escapeHtml(resolveAttachment(srcMatch[1].slice("attachment:".length)))}"`);
  }
  return filtered;
}

function emphasisText(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, alt: string, src: string) => {
    if (/^attachment:/.test(src) || /^https?:/.test(src)) {
      return match;
    }
    return escapeHtml(alt);
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    if (/^https?:|^mailto:/.test(href)) {
      return `<a href="${escapeHtml(href)}">${label}</a>`;
    }
    return label;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>");
  return out;
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

/** Markdown rendering in one place: the published subset, through the one allowlist. */
export function renderMarkdown(source: string, resolveAttachment: AttachmentResolver = () => ""): RenderedMarkdown {
  const lines = source.split("\n");
  const blocks: string[] = [];
  const rawHeadings: { level: number; text: string }[] = [];
  let paragraph: string[] = [];
  let listItems: { text: string; ordered: boolean }[] = [];
  let codeBlock: string[] | null = null;
  let tableHeader: string[] | null = null;
  let tableRows: string[][] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push(`<p>${paragraph.map((line) => renderInline(line, resolveAttachment)).join("<br>")}</p>`);
      paragraph = [];
    }
  };
  const flushList = (): void => {
    if (listItems.length > 0) {
      const tag = listItems[0].ordered ? "ol" : "ul";
      blocks.push(`<${tag}>${listItems.map((item) => `<li>${renderInline(item.text, resolveAttachment)}</li>`).join("")}</${tag}>`);
      listItems = [];
    }
  };
  const flushTable = (): void => {
    if (tableHeader !== null) {
      if (tableRows.length > 0) {
        const head = `<thead><tr>${tableHeader.map((cell) => `<th>${renderInline(cell, resolveAttachment)}</th>`).join("")}</tr></thead>`;
        const body = `<tbody>${tableRows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell, resolveAttachment)}</td>`).join("")}</tr>`).join("")}</tbody>`;
        blocks.push(`<table>${head}${body}</table>`);
      } else {
        blocks.push(`<p>${renderInline(tableHeader.join(" | "), resolveAttachment)}</p>`);
      }
      tableHeader = null;
      tableRows = [];
    }
  };

  for (const line of lines) {
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence !== null) {
      if (codeBlock !== null) {
        blocks.push(`<pre><code>${escapeHtml(codeBlock.join("\n"))}</code></pre>`);
        codeBlock = null;
      } else {
        flushParagraph();
        flushList();
        flushTable();
        codeBlock = [];
      }
      continue;
    }
    if (codeBlock !== null) {
      codeBlock.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading !== null) {
      flushParagraph();
      flushList();
      flushTable();
      rawHeadings.push({ level: heading[1].length, text: heading[2].trim() });
      continue;
    }
    const isDivider = /^\s*\|?\s*:?-{3,}[-\s|:]*\|?\s*$/.test(line);
    if (isDivider && tableHeader === null && paragraph.length === 1 && paragraph[0].includes("|")) {
      tableHeader = splitRow(paragraph[0]);
      paragraph = [];
      tableRows = [];
      continue;
    }
    if (tableHeader !== null && line.includes("|")) {
      tableRows.push(splitRow(line));
      continue;
    }
    if (tableHeader !== null) {
      flushTable();
    }
    const listItem = line.match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
    if (listItem !== null) {
      flushParagraph();
      const ordered = /\d+\./.test(listItem[1]);
      if (listItems.length > 0 && listItems[0].ordered !== ordered) flushList();
      listItems.push({ text: listItem[2], ordered });
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      flushTable();
      continue;
    }
    if (listItems.length > 0) flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  flushTable();
  if (codeBlock !== null) {
    blocks.push(`<pre><code>${escapeHtml(codeBlock.join("\n"))}</code></pre>`);
  }

  const numbered = numberHeadings(rawHeadings.map((heading, order) => ({ ...heading, cellId: "", paragraphIndex: order })));
  const headingBlocks = rawHeadings.map((heading, order) => {
    const anchor = `h-${order}`;
    return `<h${heading.level} id="${anchor}">${renderInline(heading.text, resolveAttachment)}</h${heading.level}>`;
  });
  const html = [...headingBlocks, ...blocks].join("\n");
  return {
    html,
    headings: numbered.map((heading, order) => ({
      level: heading.level,
      text: heading.text,
      number: heading.number,
      anchor: `h-${order}`,
    })),
  };
}
