import type { JSX } from "preact";
import { parseNote } from "../../../server/domain/markup.ts";

/** A pin note in its published markup: bold, italic and safe links as elements, everything else as plain text. */
export function Note({ text }: { text: string }): JSX.Element {
  return (
    <>
      {parseNote(text).map((part, index) => {
        if (part.kind === "bold") return <strong key={index}>{part.text}</strong>;
        if (part.kind === "italic") return <em key={index}>{part.text}</em>;
        if (part.kind === "link") return <a key={index} href={part.address} rel="noreferrer">{part.text}</a>;
        return part.text;
      })}
    </>
  );
}
