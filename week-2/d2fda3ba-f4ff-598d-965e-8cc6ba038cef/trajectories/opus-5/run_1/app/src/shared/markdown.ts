import { parseWikilinks } from './boundary';

/** How one wikilink renders: a link to a reachable note, or plain text when it is severed. */
export type WikilinkRender =
  | { kind: 'link'; href: string; text: string }
  | { kind: 'plain'; text: string; className?: string };

export interface RenderContext {
  resolveWikilink(target: string, label: string | null): WikilinkRender;
}

/** Shown in place of a wikilink whose target is outside the boundary and has no label. */
export const WITHHELD = '[withheld]';

/** Escapes text content. Quotes stay readable, so published copy matches what was written. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

function allowedHref(url: string): string | null {
  const trimmed = url.trim();
  const scheme = /^[a-zA-Z][a-zA-Z0-9+.\-]*:/.exec(trimmed);
  if (!scheme) return null;
  return ALLOWED_SCHEMES.has(scheme[0].toLowerCase()) ? trimmed : null;
}

interface InlineToken {
  start: number;
  end: number;
  html: string;
}

function renderInline(text: string, ctx: RenderContext): string {
  const tokens: InlineToken[] = [];

  for (const link of parseWikilinks(text)) {
    const resolved = ctx.resolveWikilink(link.target, link.label);
    const html =
      resolved.kind === 'link'
        ? `<a href="${escapeAttribute(resolved.href)}">${escapeHtml(resolved.text)}</a>`
        : resolved.className
          ? `<span class="${escapeAttribute(resolved.className)}">${escapeHtml(resolved.text)}</span>`
          : escapeHtml(resolved.text);
    tokens.push({ start: link.index, end: link.index + link.raw.length, html });
  }

  const mdLink = /(!?)\[([^\[\]]*)\]\(([^()\s]*(?:\([^()]*\)[^()\s]*)*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = mdLink.exec(text)) !== null) {
    if (tokens.some((token) => match!.index < token.end && token.start < match!.index + match![0].length)) continue;
    const label = match[2] ?? '';
    const href = match[1] === '!' ? null : allowedHref(match[3] ?? '');
    const html = href
      ? `<a href="${escapeAttribute(href)}" rel="noopener noreferrer nofollow">${renderEmphasis(label, ctx)}</a>`
      : renderEmphasis(label, ctx);
    tokens.push({ start: match.index, end: match.index + match[0].length, html });
  }

  const code = /`([^`]+)`/g;
  while ((match = code.exec(text)) !== null) {
    if (tokens.some((token) => match!.index < token.end && token.start < match!.index + match![0].length)) continue;
    tokens.push({
      start: match.index,
      end: match.index + match[0].length,
      html: `<code>${escapeHtml(match[1] ?? '')}</code>`,
    });
  }

  tokens.sort((a, b) => a.start - b.start);

  let out = '';
  let cursor = 0;
  for (const token of tokens) {
    if (token.start < cursor) continue;
    out += renderEmphasis(text.slice(cursor, token.start), ctx);
    out += token.html;
    cursor = token.end;
  }
  out += renderEmphasis(text.slice(cursor), ctx);
  return out;
}

function renderEmphasis(text: string, _ctx: RenderContext): string {
  let html = escapeHtml(text);
  html = html.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>');
  html = html.replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*/g, '$1<em>$2</em>');
  html = html.replace(/(^|[^_\w])_(?=\S)([^_]*?\S)_/g, '$1<em>$2</em>');
  html = html.replace(/ {2,}\n/g, '<br />\n');
  html = html.replace(/\n/g, '<br />\n');
  return html;
}

interface TableRow {
  cells: string[];
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell));
}

function listMarker(line: string): { ordered: boolean; content: string; indent: number } | null {
  const match = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line);
  if (!match) return null;
  return {
    ordered: !/^[-*+]$/.test(match[2] ?? ''),
    content: match[3] ?? '',
    indent: (match[1] ?? '').length,
  };
}

/** Renders a note body to the allowlisted subset of HTML. Everything else becomes text. */
export function renderMarkdown(body: string, ctx: RenderContext): string {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  return renderBlocks(lines, ctx);
}

function renderBlocks(lines: string[], ctx: RenderContext): string {
  let html = '';
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    const fence = /^\s*(```|~~~)(.*)$/.exec(line);
    if (fence) {
      const marker = fence[1] ?? '```';
      const content: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith(marker)) {
        content.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      html += `<pre><code>${escapeHtml(content.join('\n'))}\n</code></pre>\n`;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = Math.min((heading[1] ?? '#').length + 1, 4);
      html += `<h${level}>${renderInline(heading[2] ?? '', ctx)}</h${level}>\n`;
      index += 1;
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      html += '<hr />\n';
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && (/^\s*>\s?/.test(lines[index] ?? '') || (lines[index] ?? '').trim().length > 0)) {
        const current = lines[index] ?? '';
        if (!/^\s*>\s?/.test(current) && quoted.length === 0) break;
        if (!/^\s*>\s?/.test(current) && current.trim().length === 0) break;
        quoted.push(current.replace(/^\s*>\s?/, ''));
        index += 1;
      }
      html += `<blockquote>\n${renderBlocks(quoted, ctx)}</blockquote>\n`;
      continue;
    }

    if (
      line.includes('|') &&
      index + 1 < lines.length &&
      (lines[index + 1] ?? '').includes('|') &&
      isTableSeparator(lines[index + 1] ?? '')
    ) {
      const header: TableRow = { cells: splitTableRow(line) };
      index += 2;
      const rows: TableRow[] = [];
      while (index < lines.length && (lines[index] ?? '').includes('|') && (lines[index] ?? '').trim().length > 0) {
        rows.push({ cells: splitTableRow(lines[index] ?? '') });
        index += 1;
      }
      html += '<table>\n<thead>\n<tr>';
      for (const cell of header.cells) html += `<th>${renderInline(cell, ctx)}</th>`;
      html += '</tr>\n</thead>\n<tbody>\n';
      for (const row of rows) {
        html += '<tr>';
        for (let column = 0; column < header.cells.length; column += 1) {
          html += `<td>${renderInline(row.cells[column] ?? '', ctx)}</td>`;
        }
        html += '</tr>\n';
      }
      html += '</tbody>\n</table>\n';
      continue;
    }

    const marker = listMarker(line);
    if (marker) {
      const tag = marker.ordered ? 'ol' : 'ul';
      html += `<${tag}>\n`;
      while (index < lines.length) {
        const itemMarker = listMarker(lines[index] ?? '');
        if (!itemMarker || itemMarker.ordered !== marker.ordered || itemMarker.indent > marker.indent + 1) break;
        const itemLines = [itemMarker.content];
        index += 1;
        while (index < lines.length) {
          const next = lines[index] ?? '';
          if (next.trim().length === 0) break;
          const nextMarker = listMarker(next);
          if (nextMarker && nextMarker.indent <= marker.indent + 1) break;
          itemLines.push(next.replace(/^\s{1,4}/, ''));
          index += 1;
        }
        const nested = itemLines.slice(1).some((itemLine) => listMarker(itemLine) !== null);
        html += nested
          ? `<li>\n${renderBlocks(itemLines, ctx)}</li>\n`
          : `<li>${renderInline(itemLines.join('\n').trim(), ctx)}</li>\n`;
        if (index < lines.length && (lines[index] ?? '').trim().length === 0) {
          const after = listMarker(lines[index + 1] ?? '');
          if (!after || after.ordered !== marker.ordered) break;
          index += 1;
        }
      }
      html += `</${tag}>\n`;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (current.trim().length === 0) break;
      if (listMarker(current) || /^\s*>\s?/.test(current) || /^(#{1,6})\s+/.test(current)) break;
      if (/^\s*(```|~~~)/.test(current)) break;
      paragraph.push(current);
      index += 1;
    }
    html += `<p>${renderInline(paragraph.join('\n'), ctx)}</p>\n`;
  }

  return html;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** Visible text of markup produced by this module. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(br|hr)\s*\/?>/g, '\n')
    .replace(/<\/(p|h2|h3|h4|li|tr|blockquote|pre|table)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, (entity) => ENTITIES[entity] ?? entity)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
