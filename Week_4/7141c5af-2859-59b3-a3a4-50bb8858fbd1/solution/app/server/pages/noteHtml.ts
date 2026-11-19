import { parseNote } from "../domain/markup.ts";
import { escapeHtml } from "./document.ts";

/** A pin note as HTML: only the published markup becomes tags, everything else is escaped text. */
export function noteHtml(note: string): string {
  return parseNote(note)
    .map((part) => {
      const text = escapeHtml(part.text);
      if (part.kind === "bold") return `<strong>${text}</strong>`;
      if (part.kind === "italic") return `<em>${text}</em>`;
      if (part.kind === "link") return `<a href="${escapeHtml(part.address)}">${text}</a>`;
      return text;
    })
    .join("");
}
