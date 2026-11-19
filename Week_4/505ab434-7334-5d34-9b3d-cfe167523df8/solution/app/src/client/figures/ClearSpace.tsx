import type { ReactNode } from "react";
import { QuenbyMark } from "../ui/Glyphs.tsx";

/** Logo chapter: the mark inside its clear-space frame, one symbol height on every side. */
export function ClearSpaceFigure(): ReactNode {
  return (
    <section className="figure-cell cell cell-pad" data-frame aria-labelledby="space-title">
      <h2 id="space-title" className="cell-label">
        Clear space
      </h2>
      <div className="clear-space" aria-hidden="true">
        <div className="clear-space-frame">
          <QuenbyMark label={false} size={120} />
        </div>
      </div>
      <p className="prose muted">
        Leave an empty margin as tall as the mark itself on all four sides, so nothing crowds the symbol. The dashed frame shows the smallest empty area around it.
      </p>
    </section>
  );
}
