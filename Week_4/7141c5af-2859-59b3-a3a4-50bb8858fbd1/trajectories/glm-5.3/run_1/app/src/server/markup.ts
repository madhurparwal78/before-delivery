export type Markup = { kind: "text"; text: string } | { kind: "bold"; text: string } | { kind: "italic"; text: string } | { kind: "link"; text: string; href: string };

const isHref = (h: string) => /^https?:\/\/.+/i.test(h) || /^mailto:.+/.test(h);

/**
 * Parse `**bold**`, `*italic*` and `[words](address)` where the address starts
 * with http://, https:// or mailto: only. Everything else is plain text.
 */
export function parseNote(note: string): Markup[] {
  const out: Markup[] = [];
  let i = 0;
  const pushText = (s: string) => {
    if (s) out.push({ kind: "text", text: s });
  };
  while (i < note.length) {
    const rest = note.slice(i);
    const bold = /^\*\*([^*]+)\*\*/.exec(rest);
    if (bold) {
      out.push({ kind: "bold", text: bold[1] });
      i += bold[0].length;
      continue;
    }
    const italic = /^\*([^*]+)\*/.exec(rest);
    if (italic) {
      out.push({ kind: "italic", text: italic[1] });
      i += italic[0].length;
      continue;
    }
    const link = /^\[([^\]]+)\]\(([^)]*)\)/.exec(rest);
    if (link && isHref(link[2])) {
      out.push({ kind: "link", text: link[1], href: link[2] });
      i += link[0].length;
      continue;
    }
    const nextSpecial = note.indexOf("*", i + 1);
    const nextBracket = note.indexOf("[", i + 1);
    let next = Math.min(nextSpecial === -1 ? Infinity : nextSpecial, nextBracket === -1 ? Infinity : nextBracket);
    if (!Number.isFinite(next)) next = note.length;
    if (next <= i) next = i + 1;
    pushText(note.slice(i, next));
    i = next;
  }
  return out;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const safeHref = (h: string) =>
  /^https?:\/\//i.test(h) ? h : h.toLowerCase().startsWith("mailto:") ? h : "#";
/** Render note markup to safe HTML (screens only; plain text elsewhere). */
export function renderNoteHtml(note: string): string {
  return parseNote(note)
    .map((m) =>
      m.kind === "text" ? escapeHtml(m.text)
      : m.kind === "bold" ? `<strong>${escapeHtml(m.text)}</strong>`
      : m.kind === "italic" ? `<em>${escapeHtml(m.text)}</em>`
      : `<a href="${escapeHtml(safeHref(m.href))}" rel="noopener noreferrer">${escapeHtml(m.text)}</a>`
    )
    .join("");
}
export const renderNoteText = (note: string) =>
  parseNote(note)
    .map((m) => (m.kind === "link" ? m.text : m.text))
    .join("");
