/** Render only the published Markdown subset. HTML is escaped. */
export function renderWiki(content: string): string {
  const lines = content.split('\n');
  const out: string[] = [];
  let inCode = false;
  let listOpen = false;
  const closeList = (): void => {
    if (listOpen) {
      out.push('</ul>');
      listOpen = false;
    }
  };
  for (const rawLine of lines) {
    const line = rawLine;
    if (line.trim().startsWith('```')) {
      if (inCode) {
        out.push('</code></pre>');
        inCode = false;
      } else {
        closeList();
        out.push('<pre><code>');
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      out.push(escapeHtml(line));
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length + 1;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (line.trim() === '') {
      closeList();
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      if (!listOpen) {
        out.push('<ul>');
        listOpen = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    const tableRow = line.match(/^\s*\|(.+)\|\s*$/);
    if (tableRow) {
      closeList();
      const cells = tableRow[1].split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
      out.push(`<table><tr>${cells.map((c) => `<td>${inline(c)}</td>`).join('')}</tr></table>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}

function inline(text: string): string {
  let t = escapeHtml(text);
  // images from project files
  t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, src: string) => {
    if (src.startsWith('/') || src.startsWith('#')) return `<img src="${escapeHtml(src)}" alt="${alt}">`;
    return `<img src="${escapeHtml(src)}" alt="${alt}">`;
  });
  // links: only http, https, / and #
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, href: string) => {
    if (/^https?:\/\//.test(href) || href.startsWith('/') || href.startsWith('#')) {
      return `<a href="${escapeHtml(href)}">${label}</a>`;
    }
    return `${label} (${href})`;
  });
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return t;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
