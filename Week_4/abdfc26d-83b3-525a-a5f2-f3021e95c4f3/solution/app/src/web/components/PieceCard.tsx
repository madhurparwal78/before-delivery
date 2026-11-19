import { forwardRef, useId } from "react";
import type { Card } from "../api";
import { Link } from "../router";
import { useReducedMotion } from "../session";
import { LiveCanvas } from "./LiveCanvas";

/** A live piece card: the whole face is the running canvas, a scrim, a tag chip, title and caption. */
export const PieceCard = forwardRef<HTMLHeadingElement, { card: Card }>(function PieceCard({ card }, headingRef) {
  const reduced = useReducedMotion();
  const titleId = useId();
  return (
    <article className="piece-card" aria-labelledby={titleId}>
      <LiveCanvas
        program={{ kind: "house", slug: card.slug }}
        slug={card.slug}
        still={reduced}
        scale={0.75}
        className="card-canvas"
        scene={() => ({ seed: 0, uniforms: {}, time: (t) => t })}
      />
      <span className="tag-chip">{card.remix_of ? "Remix" : card.engine}</span>
      <div className="card-text">
        <h3 id={titleId} ref={headingRef} tabIndex={-1} className="card-title">
          <Link to={`/pieces/${card.slug}`} className="card-link">
            {card.title}
          </Link>
        </h3>
        <p className="card-caption">
          {card.creator_display_name} · {card.editions_left} of {card.edition_count} left
        </p>
      </div>
    </article>
  );
});
