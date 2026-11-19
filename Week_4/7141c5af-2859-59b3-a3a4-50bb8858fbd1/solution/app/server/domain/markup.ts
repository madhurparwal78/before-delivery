/** A pin note in its published markup. Imported by the server's PDF and by both browsers' screens. */
type NotePart =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "link"; text: string; address: string };

const MARKUP = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s()]+)\)/g;

export function parseNote(note: string): NotePart[] {
  const parts: NotePart[] = [];
  let cursor = 0;
  for (const match of note.matchAll(MARKUP)) {
    if (match.index > cursor) parts.push({ kind: "text", text: note.slice(cursor, match.index) });
    const [whole, bold, italic, words, address] = match;
    if (bold !== undefined) parts.push({ kind: "bold", text: bold });
    else if (italic !== undefined) parts.push({ kind: "italic", text: italic });
    else parts.push({ kind: "link", text: words as string, address: address as string });
    cursor = match.index + whole.length;
  }
  if (cursor < note.length) parts.push({ kind: "text", text: note.slice(cursor) });
  return parts;
}
