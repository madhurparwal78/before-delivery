import type { ReactNode } from "react";
import { Glyph } from "../ui/Glyphs.tsx";

/** The not-found page: a single field cell with one large glyph and the heading `Not found`. */
export function NotFound(): ReactNode {
  return (
    <div className="empty-state field-stone not-found" data-frame>
      <Glyph name="lost" size={160} />
      <h1>Not found</h1>
    </div>
  );
}
