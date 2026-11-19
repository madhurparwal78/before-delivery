/* Markdown: a CommonMark subset renderer that escapes all raw HTML and then
   allows only the published elements and attributes. The same renderer is used
   by publishing, preview and tests; it is the single sanitiser. */

export function renderMarkdown(src: string): string {
  const src0 = normalizeLineEndings(src);
  const lines = src0.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    const blank = /^\s*$/.test(line);
    if (blank) { i++; continue; }
    const hr = /^(?:\s*)(?:-{3,}|\*{3,}|_{3,})\s*$/.exec(line);
    if (hr) { out.push('<hr>'); i++; continue; }
    const fenceStart = /^(\s*)(`{3,}|~{3,})\s*([^`]*?)\s*$/.exec(line);
    if (fenceStart) {
      const marker = (fenceStart[2] as string)[0] as string;
      const len = (fenceStart[2] as string).length;
      const info = (fenceStart[3] ?? '').trim();
      const lang = /^[A-Za-z0-9_-]+$/.test(info) ? info : '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${marker === '`' ? '`' : '~'}{${len},}\\s*$`).test(lines[i] as string)) {
        codeLines.push((lines[i] as string).replace(/^\s{0,3}/, ''));
        i++;
      }
      i++;
      const code = escapeHtml(codeLines.join('\n'));
      out.push(lang ? `<pre><code class="language-${escapeHtml(lang)}">${code}</code></pre>` : `<pre><code>${code}</code></pre>`);
      continue;
    }
    if (line[0] === '>' || line[0] === '#') {
      // Blockquote (headings are not in the allow-list, rendered as text)
      if (line[0] === '>') {
        const quote: string[] = [];
        while (i < lines.length && (lines[i] as string).startsWith('>')) {
          quote.push((lines[i] as string).replace(/^>\s?/, ''));
          i++;
        }
        out.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`);
        continue;
      }
    }
    const listM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line);
    if (listM) {
      const res = parseList(lines, i);
      out.push(res.html);
      i = res.next;
      continue;
    }
    const tableM = /^\s*\|(.+)\|\s*$/.exec(line);
    const nextLine = lines[i + 1] ?? '';
    if (tableM && /^\s*\|?[\s:|-]+\|?\s*$/.test(nextLine) && nextLine.includes('-')) {
      const res = parseTable(lines, i);
      out.push(res.html);
      i = res.next;
      continue;
    }
    // Paragraph: gather until blank, list, fence, hr, blockquote or table
    const para: string[] = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i] as string) &&
      !/^(?:\s*)(?:-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i] as string) &&
      !/^(\s*)(`{3,}|~{3,})/.test(lines[i] as string) &&
      !/^(\s*)([-*+]|\d{1,9}[.)])\s+/.test(lines[i] as string) &&
      !(lines[i] as string).startsWith('>') &&
      !/^\s*\|/.test(lines[i] as string)
    ) {
      para.push(lines[i] as string);
      i++;
    }
    if (para.length > 0) {
      const text = para.join('\n');
      out.push(`<p>${renderInline(text)}</p>`);
    }
  }
  return out.join('\n');
}

function normalizeLineEndings(s: string): string {
  return s.replace(/\r\n?/g, '\n');
}

function parseList(lines: string[], start: number): { html: string; next: number } {
  const first = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(lines[start] as string) as RegExpExecArray;
  const ordered = /\d/.test(first[2] as string);
  const startNumMatch = /^(\d{1,9})[.)]/.exec(first[2] as string);
  const startNum = ordered && startNumMatch ? Number(startNumMatch[1]) : 1;
  const items: string[][] = [];
  let i = start;
  const baseIndent = first[1] ? (first[1] as string).length : 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (/^\s*$/.test(line)) {
      const after = lines[i + 1];
      if (after !== undefined && new RegExp(`^\\s{0,${baseIndent + 2}}(?:[-*+]|\\d{1,9}[.)])\\s+`).test(after)) { i++; continue; }
      break;
    }
    const m = new RegExp(`^(\\s{0,${baseIndent + 2}})([-*+]|\\d{1,9}[.)])\\s+(.*)$`).exec(line);
    if (!m) break;
    const indent = (m[1] ?? '').length;
    if (indent < baseIndent) break;
    if (m && indent > baseIndent && items.length > 0) {
      // continuation of previous item
      const prev = items[items.length - 1] as string[];
      prev.push((m[3] as string));
      i++;
      continue;
    }
    items.push([m[3] as string]);
    i++;
  }
  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && startNum !== 1 ? ` start="${startNum}"` : '';
  const inner = items
    .map((it) => {
      const body = it.join('\n');
      const rendered = renderMarkdown(body);
      return `<li>${rendered}</li>`;
    })
    .join('');
  return { html: `<${tag}${startAttr}>${inner}</${tag}>`, next: i };
}

function parseTable(lines: string[], start: number): { html: string; next: number } {
  const headerCells = splitRow(lines[start] as string);
  const alignRow = lines[start + 1] as string;
  const aligns = splitRow(alignRow).map((c) => (/^:-+:$/.test(c.trim()) ? 'center' : c.trim().endsWith(':') ? 'right' : 'left'));
  let i = start + 2;
  const bodyRows: string[][] = [];
  while (i < lines.length && /^\s*\|/.test(lines[i] as string) && !/^\s*\|[\s:|-]+\|\s*$/.test(lines[i] as string)) {
    bodyRows.push(splitRow(lines[i] as string));
    i++;
  }
  const th = headerCells.map((c) => `<th>${renderInline(c)}</th>`).join('');
  const tb = bodyRows.map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`).join('');
  return { html: `<table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`, next: i };
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function renderInline(text: string): string {
  let s = escapeHtml(text);
  // inline spoilers >!text!<
  s = s.replace(/&gt;!(.*?)!&lt;/g, (_m, body: string) => `<span class="spoiler">${body}</span>`);
  // links: [label](url). Unsafe schemes render as plain text.
  s = s.replace(/\[([^\]]*)\]\(([^)\s]*)\)/g, (whole: string, label: string, url: string) => {
    const clean = sanitizeHref(url);
    if (clean === null) return label;
    return `<a href="${escapeHtml(clean)}" rel="nofollow ugc noopener noreferrer">${label}</a>`;
  });
  // inline code first so its content is not further formatted
  s = s.replace(/`([^`]+)`/g, (_m: string, code: string) => `<code>${code}</code>`);
  // strong then emphasis
  s = s.replace(/\*\*([^*]+)\*\*/g, (_m: string, body: string) => `<strong>${body}</strong>`);
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, (_m: string, pre: string, body: string) => `${pre}<em>${body}</em>`);
  s = s.replace(/__([^_]+)__/g, (_m: string, body: string) => `<strong>${body}</strong>`);
  s = s.replace(/(^|[^_])_([^_\n]+)_/g, (_m: string, pre: string, body: string) => `${pre}<em>${body}</em>`);
  // hard line breaks
  s = s.replace(/  \n/g, '<br>');
  return s;
}

function sanitizeHref(url: string): string | null {
  const t = url.trim().replace(/[<>"\s]/g, '');
  const lower = t.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('mailto:')) return t;
  return null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export { renderMarkdown as previewHtml };
export { escapeHtml };
