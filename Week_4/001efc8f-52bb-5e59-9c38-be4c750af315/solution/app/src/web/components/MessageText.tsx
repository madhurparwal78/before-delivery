import { Fragment } from "react";
import { linkify } from "../linkify";

// Message text as plain text: only line breaks and safe http(s) links, never HTML or Markdown.
export function MessageText({ text, className = "message-text" }: { text: string; className?: string }) {
  return (
    <div className={className}>
      {linkify(text).map((piece, i) =>
        piece.kind === "break" ? (
          <br key={i} />
        ) : piece.kind === "link" ? (
          <a key={i} href={piece.href} target="_blank" rel="noopener noreferrer">
            {piece.href}
          </a>
        ) : (
          <Fragment key={i}>{piece.text}</Fragment>
        ),
      )}
    </div>
  );
}
