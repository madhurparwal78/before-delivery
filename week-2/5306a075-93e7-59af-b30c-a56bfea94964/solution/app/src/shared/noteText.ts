// A note body as a tree of allowlisted nodes, and the one rule that turns it into plain text with offsets.
// The server derives `text` with it; the reading view renders exactly the characters it lays out, so a
// mark's data-start/data-end are positions in that same text (UTF-16 code units).

const NOTE_TAGS = ["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "blockquote", "code", "pre", "a"] as const;
export type NoteTag = (typeof NOTE_TAGS)[number];

export type NoteNode =
  | { type: "text"; value: string }
  | { type: "element"; tag: NoteTag; href: string | null; children: NoteNode[] };

/** A laid-out text piece: the characters of `text` it renders, starting at `start`. */
export type LaidNode =
  | { type: "text"; value: string; start: number }
  | { type: "element"; tag: NoteTag; href: string | null; children: LaidNode[] };

const BLOCKS: ReadonlySet<NoteTag> = new Set(["p", "li", "blockquote", "pre", "ul", "ol"]);
const SPACE = /[ \t\n\r\f]/;

export function isNoteTag(tag: string): tag is NoteTag {
  return (NOTE_TAGS as readonly string[]).includes(tag);
}

/** Collapses HTML whitespace runs to one space and trims, as text outside `pre` is read. */
export function collapseWhitespace(value: string): string {
  return value.replace(/[ \t\n\r\f]+/g, " ").replace(/^ | $/g, "");
}

export function layoutNote(nodes: NoteNode[]): { text: string; nodes: LaidNode[] } {
  let text = "";
  let lineHasContent = false;
  let pendingSpace: { type: "text"; value: string; start: number } | null = null;
  let boundary = false;
  let breaks = 0;
  let lastWasBreak = false;

  const separate = (): void => {
    const newlines = text === "" ? 0 : (boundary ? 1 : 0) + breaks;
    if (newlines > 0) {
      text += "\n".repeat(newlines);
      lineHasContent = false;
      pendingSpace = null;
    }
    boundary = false;
    breaks = 0;
  };

  const endLine = (): void => {
    if (lastWasBreak && breaks > 0) breaks -= 1;
    lastWasBreak = false;
    if (text !== "") boundary = true;
    pendingSpace = null;
    lineHasContent = false;
  };

  const walk = (list: NoteNode[], pre: boolean): LaidNode[] =>
    list.map((node): LaidNode => {
      if (node.type === "text") {
        const piece = { type: "text" as const, value: "", start: -1 };
        for (const char of node.value) {
          if (!pre && SPACE.test(char)) {
            if (lineHasContent && pendingSpace === null) pendingSpace = piece;
            continue;
          }
          separate();
          if (pendingSpace !== null) {
            const owner: { value: string; start: number } = pendingSpace;
            if (owner.start < 0) owner.start = text.length;
            owner.value += " ";
            text += " ";
            pendingSpace = null;
          }
          if (piece.start < 0) piece.start = text.length;
          piece.value += char;
          text += char;
          lineHasContent = char !== "\n";
        }
        lastWasBreak = lastWasBreak && piece.value === "";
        if (piece.start < 0) piece.start = text.length;
        return piece;
      }
      if (node.tag === "br") {
        breaks += 1;
        lastWasBreak = true;
        pendingSpace = null;
        lineHasContent = false;
        return { type: "element", tag: "br", href: null, children: [] };
      }
      const block = BLOCKS.has(node.tag);
      if (block) endLine();
      const children = walk(node.children, pre || node.tag === "pre");
      if (block) endLine();
      return { type: "element", tag: node.tag, href: node.href, children };
    });

  const laid = walk(nodes, false);
  return { text, nodes: laid };
}

/** True when `index` falls between the two halves of a surrogate pair in `text`. */
export function splitsSurrogatePair(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return false;
  const before = text.charCodeAt(index - 1);
  const after = text.charCodeAt(index);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}
