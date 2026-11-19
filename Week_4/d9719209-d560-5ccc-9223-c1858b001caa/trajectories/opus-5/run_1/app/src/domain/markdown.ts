/**
 * The one renderer for post and comment bodies: a CommonMark subset whose output can only ever
 * contain the allowed elements and attributes, because every element is emitted here and every
 * piece of source text is escaped. Raw HTML in the source is therefore shown as text.
 */

const ALLOWED_LINK_SCHEMES = ['http:', 'https:', 'mailto:'];

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHref(target: string): string | null {
  const trimmed = target.trim().replace(/[\s\u0000-\u001f]/g, '');
  const colon = trimmed.indexOf(':');
  if (colon >= 0) {
    const scheme = trimmed.slice(0, colon + 1).toLowerCase();
    if (!ALLOWED_LINK_SCHEMES.includes(scheme)) return null;
    // Reject schemes that only look safe after a stray prefix, e.g. "java\nscript:".
    if (!/^[a-z][a-z0-9+.-]*:$/.test(scheme)) return null;
    return trimmed;
  }
  if (trimmed.startsWith('//')) return null;
  return trimmed;
}

function findClosing(source: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (source.startsWith(open, index)) depth += 1;
    else if (source.startsWith(close, index)) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

const EMPHASIS: ReadonlyArray<readonly [string, 'strong' | 'em']> = [
  ['**', 'strong'],
  ['__', 'strong'],
  ['*', 'em'],
  ['_', 'em'],
];

function matchEmphasis(source: string, index: number): { html: string; next: number } | null {
  for (const [marker, tag] of EMPHASIS) {
    if (!source.startsWith(marker, index)) continue;
    const end = source.indexOf(marker, index + marker.length);
    if (end < 0) return { html: escapeText(marker), next: index + marker.length };
    const inner = source.slice(index + marker.length, end);
    if (inner.length === 0) return { html: escapeText(marker.repeat(2)), next: end + marker.length };
    return { html: `<${tag}>${renderInline(inner)}</${tag}>`, next: end + marker.length };
  }
  return null;
}

function renderInline(source: string): string {
  let output = '';
  let index = 0;

  while (index < source.length) {
    const character = source[index];

    if (character === '\\' && index + 1 < source.length && /[\\`*_[\]()>!#+\-.{}~|"']/.test(source[index + 1])) {
      output += escapeText(source[index + 1]);
      index += 2;
      continue;
    }

    if (character === '`') {
      let fence = 0;
      while (source[index + fence] === '`') fence += 1;
      const marker = '`'.repeat(fence);
      const end = source.indexOf(marker, index + fence);
      if (end >= 0) {
        const content = source.slice(index + fence, end);
        output += `<code>${escapeText(content.replace(/^ (.*) $/, '$1'))}</code>`;
        index = end + fence;
        continue;
      }
      output += escapeText(marker);
      index += fence;
      continue;
    }

    if (source.startsWith('>!', index)) {
      const end = source.indexOf('!<', index + 2);
      if (end > 0) {
        output += `<span class="spoiler">${renderInline(source.slice(index + 2, end))}</span>`;
        index = end + 2;
        continue;
      }
    }

    if (character === '[') {
      const labelEnd = findClosing(source, index, '[', ']');
      if (labelEnd > 0 && source[labelEnd + 1] === '(') {
        const targetEnd = findClosing(source, labelEnd + 1, '(', ')');
        if (targetEnd > 0) {
          const label = renderInline(source.slice(index + 1, labelEnd));
          const rawTarget = source.slice(labelEnd + 2, targetEnd).replace(/\s+"[^"]*"$/, '');
          const href = safeHref(rawTarget);
          output += href
            ? `<a href="${escapeText(href)}" rel="nofollow ugc noopener noreferrer">${label}</a>`
            : label;
          index = targetEnd + 1;
          continue;
        }
      }
    }

    const emphasis = matchEmphasis(source, index);
    if (emphasis) {
      output += emphasis.html;
      index = emphasis.next;
      continue;
    }

    if (character === '\n') {
      output += '\n';
      index += 1;
      continue;
    }

    output += escapeText(character);
    index += 1;
  }

  return output;
}

/** Turns hard line breaks ("two spaces" or a trailing backslash) into <br> and keeps soft breaks as text. */
function renderParagraphContent(lines: string[]): string {
  const prepared = lines
    .map((line, position) => {
      const isLast = position === lines.length - 1;
      if (isLast) return line.replace(/\s+$/, '');
      if (/ {2,}$/.test(line)) return `${line.replace(/\s+$/, '')}\u0000`;
      if (/\\$/.test(line)) return `${line.slice(0, -1)}\u0000`;
      return line.replace(/\s+$/, '');
    })
    .join('\n');
  return renderInline(prepared).split('\u0000').join('<br>');
}

interface Line {
  raw: string;
  indent: number;
  content: string;
}

function measure(raw: string): Line {
  const expanded = raw.replace(/\t/g, '    ');
  const indent = expanded.length - expanded.trimStart().length;
  return { raw: expanded, indent, content: expanded.trim() };
}

const BULLET = /^([-*+])(\s+)(.*)$/;
const ORDERED = /^(\d{1,9})([.)])(\s+)(.*)$/;
const FENCE = /^(```+|~~~+)(.*)$/;
const RULE = /^(-{3,}|\*{3,}|_{3,})$/;
const TABLE_DELIMITER = /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$/;

function isBlockquote(content: string): boolean {
  return content.startsWith('>') && !content.startsWith('>!');
}

function renderBlocks(lines: Line[]): string {
  let html = '';
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.content === '') {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line.content);
    if (fence) {
      const marker = fence[1][0].repeat(3);
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].content.startsWith(marker)) {
        body.push(lines[index].raw.slice(Math.min(line.indent, lines[index].indent)));
        index += 1;
      }
      if (index < lines.length) index += 1;
      html += `<pre><code>${escapeText(body.join('\n'))}${body.length ? '\n' : ''}</code></pre>`;
      continue;
    }

    if (RULE.test(line.content)) {
      html += '<hr>';
      index += 1;
      continue;
    }

    if (isBlockquote(line.content)) {
      const inner: Line[] = [];
      while (index < lines.length && (isBlockquote(lines[index].content) || lines[index].content !== '')) {
        if (!isBlockquote(lines[index].content) && inner.length === 0) break;
        if (!isBlockquote(lines[index].content) && lines[index].content === '') break;
        const stripped = isBlockquote(lines[index].content)
          ? lines[index].content.replace(/^>\s?/, '')
          : lines[index].content;
        inner.push(measure(stripped));
        index += 1;
      }
      html += `<blockquote>${renderBlocks(inner)}</blockquote>`;
      continue;
    }

    const bullet = BULLET.exec(line.content);
    const ordered = ORDERED.exec(line.content);
    if (bullet || ordered) {
      const tag = bullet ? 'ul' : 'ol';
      const items: Line[][] = [];
      const baseIndent = line.indent;
      while (index < lines.length) {
        const candidate = lines[index];
        if (candidate.content === '') {
          const next = lines[index + 1];
          if (!next || next.content === '' || next.indent < baseIndent) break;
          index += 1;
          continue;
        }
        if (candidate.indent < baseIndent) break;
        const candidateBullet = BULLET.exec(candidate.content);
        const candidateOrdered = ORDERED.exec(candidate.content);
        const isItem = Boolean(bullet ? candidateBullet : candidateOrdered);
        if (candidate.indent === baseIndent && isItem) {
          const text = candidateBullet ? candidateBullet[3] : candidateOrdered ? candidateOrdered[4] : '';
          items.push([measure(text)]);
          index += 1;
          continue;
        }
        if (candidate.indent > baseIndent && items.length > 0) {
          items[items.length - 1].push(measure(candidate.raw.slice(baseIndent + 2)));
          index += 1;
          continue;
        }
        break;
      }
      html += `<${tag}>${items.map((item) => `<li>${renderBlocks(item).replace(/^<p>(.*)<\/p>$/s, '$1')}</li>`).join('')}</${tag}>`;
      continue;
    }

    const next = lines[index + 1];
    if (line.content.includes('|') && next && TABLE_DELIMITER.test(next.content) && next.content.includes('-')) {
      const cells = (row: string) =>
        row
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((cell) => cell.trim());
      const headers = cells(line.content);
      index += 2;
      const bodyRows: string[][] = [];
      while (index < lines.length && lines[index].content !== '' && lines[index].content.includes('|')) {
        bodyRows.push(cells(lines[index].content));
        index += 1;
      }
      const head = `<thead><tr>${headers.map((cell) => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead>`;
      const body = bodyRows.length
        ? `<tbody>${bodyRows
            .map(
              (row) =>
                `<tr>${headers
                  .map((_, column) => `<td>${renderInline(row[column] ?? '')}</td>`)
                  .join('')}</tr>`,
            )
            .join('')}</tbody>`
        : '';
      html += `<table>${head}${body}</table>`;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index];
      if (
        candidate.content === '' ||
        FENCE.test(candidate.content) ||
        RULE.test(candidate.content) ||
        isBlockquote(candidate.content) ||
        BULLET.test(candidate.content) ||
        ORDERED.test(candidate.content)
      ) {
        break;
      }
      paragraph.push(candidate.raw.trimStart());
      index += 1;
    }
    html += `<p>${renderParagraphContent(paragraph)}</p>`;
  }

  return html;
}

export function renderMarkdown(source: string): string {
  const normalised = source.replace(/\r\n?/g, '\n');
  return renderBlocks(normalised.split('\n').map(measure));
}
