/**
 * Notes render: only the published markdown subset, everything else
 * literal, raw HTML escaped, links restricted to the two schemes.
 */

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function linkSchemeOk(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

export function renderNote(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let inList = false;
  const inline = (s: string): string => {
    let html = escapeHtml(s);
    // inline code first so code contents stay literal
    const codes: string[] = [];
    html = html.replace(/`([^`]+)`/g, (_m, code: string) => {
      codes.push(code);
      return `\u0000${codes.length - 1}\u0000`;
    });
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (whole, label: string, url: string) => {
      if (!linkSchemeOk(url)) return whole;
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`;
    });
    html = html.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `<code>${codes[Number(i)]}</code>`);
    return html;
  };
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  for (const line of lines) {
    if (line.startsWith('- ')) {
      if (!inList) { closeList(); out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('');
}
