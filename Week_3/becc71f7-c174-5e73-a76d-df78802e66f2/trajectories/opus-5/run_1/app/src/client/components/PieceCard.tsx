import type { RailPiece } from '../lib/types.js';
import { conditionLabel, sizeLabel } from '../../shared/options.js';
import { Garment } from './Garment.js';
import { Tag } from './Tag.js';
import { Link } from './layout.js';

export function PieceCard({ piece }: { piece: RailPiece }) {
  const badge =
    piece.status === 'on_hold' ? 'On hold' : piece.status === 'sold' ? 'Sold' : null;
  return (
    <article class="card piece-card">
      <div class="piece-card__image">
        {piece.photoUrls[0] === undefined ? (
          <Garment category={piece.category} seed={piece.tagCode} />
        ) : (
          <img src={piece.photoUrls[0]} alt="" />
        )}
        {badge === null ? null : <span class="badge">{badge}</span>}
      </div>
      <Tag priceCents={piece.currentPriceCents} previousPriceCents={piece.previousPriceCents} />
      <h3 class="piece-card__description">
        <Link href={`/pieces/${piece.id}`}>{piece.description}</Link>
      </h3>
      <p class="piece-card__meta">
        <span class="piece-card__brand">{piece.brand}</span>
        <span aria-hidden="true"> · </span>
        <span>{sizeLabel(piece.size)}</span>
        <span aria-hidden="true"> · </span>
        <span>{conditionLabel(piece.condition)}</span>
      </p>
    </article>
  );
}
