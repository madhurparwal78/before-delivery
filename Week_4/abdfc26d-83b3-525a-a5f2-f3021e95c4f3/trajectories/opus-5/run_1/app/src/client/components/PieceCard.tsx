import { useRef } from 'react';
import type { PieceCard as PieceCardData } from '../../shared/api.js';
import { formatUsd } from '../../shared/money.js';
import { useEnterOnce } from '../lib/hooks.js';
import { PUBLIC_PIECE_SHADER } from '../lib/pieceShader.js';
import { usePublicUniforms } from '../lib/pieceUniforms.js';
import { Link } from '../lib/router.js';
import { LiveCanvas } from './LiveCanvas.js';

/**
 * The live piece card: a rounded card whose whole face is the running canvas,
 * with a dark scrim fading up from the bottom, a tag chip top-left and the
 * display-face title and caption at the bottom left.
 */
export function PieceCard({ card, index = 0 }: { card: PieceCardData; index?: number }): JSX.Element {
  const articleRef = useRef<HTMLElement | null>(null);
  const entered = useEnterOnce(articleRef);
  const uniforms = usePublicUniforms(card.slug);
  const headingId = `piece-card-${card.slug}`;

  return (
    <article
      className={`piece-card${entered ? ' is-entered' : ''}`}
      aria-labelledby={headingId}
      ref={articleRef}
      style={{ transitionDelay: `${Math.min(index, 5) * 100}ms` }}
    >
      <Link to={`/pieces/${card.slug}`} className="piece-card__link">
        <span className="piece-card__canvas">
          <LiveCanvas fragmentSource={PUBLIC_PIECE_SHADER} uniforms={uniforms} seed={0} />
        </span>
        <span className="piece-card__scrim" aria-hidden="true" />
        <span className="piece-card__chip">{card.remix_of ? 'Remix' : 'GLSL'}</span>
        <span className="piece-card__body">
          <h3 className="piece-card__title display" id={headingId}>
            {card.title}
          </h3>
          <span className="piece-card__caption muted tabular">
            {card.creator_display_name} · {card.editions_left} of {card.edition_count} left
          </span>
          <span className="piece-card__price tabular">${formatUsd(card.price_cents)}</span>
        </span>
      </Link>
    </article>
  );
}
