import type { ReactNode } from "react";
import { Glyph } from "./Glyphs.tsx";

/** An error inside the form, panel, card or row that failed: `alert` with the API message verbatim. Renders nothing without one. */
export function Alert({ message }: { message: string | null | undefined }): ReactNode {
  if (!message) return null;
  return (
    <div role="alert" className="alert">
      <Glyph name="bar" size={20} />
      <span>{message}</span>
    </div>
  );
}

/** One field cell with one large glyph and one sentence (empty and error states). */
export function EmptyState({ glyph, children, tone = "stone" }: { glyph: Parameters<typeof Glyph>[0]["name"]; children: ReactNode; tone?: "stone" | "ember" | "meadow" | "saffron" }): ReactNode {
  return (
    <div className={`empty-state field-${tone}`} data-frame>
      <Glyph name={glyph} size={120} />
      <p>{children}</p>
    </div>
  );
}

/** A skeleton cell shown only while a real request is in flight. */
export function Loading(): ReactNode {
  return (
    <div className="cell cell-pad skeleton" data-frame aria-busy="true">
      <span className="skeleton-bar" />
      <span className="skeleton-bar short" />
      <span className="visually-hidden">Loading</span>
    </div>
  );
}
