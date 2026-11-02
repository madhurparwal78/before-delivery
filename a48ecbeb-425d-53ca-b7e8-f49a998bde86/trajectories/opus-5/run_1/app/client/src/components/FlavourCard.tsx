import { useRef, type ReactElement } from 'react';
import { CircleSlash } from 'lucide-react';
import type { FlavourSlug } from '../../../shared/catalogue.js';
import { flavourCardCopy } from '../../../shared/copy.js';
import { formatDollars } from '../../../shared/money.js';
import { Link } from '../router.js';
import { registerCardToken } from '../state/flights.js';
import { useShop } from '../state/shop.js';
import { canPalette } from './canArt.js';
import { CanThumbnail } from './CanThumbnail.js';

export function FlavourCard({ slug }: { slug: FlavourSlug }): ReactElement | null {
  const { flavours, stockLeft, soldOut, addCan, fillCrate } = useShop();
  const token = useRef<HTMLSpanElement | null>(null);
  const flavour = flavours.find((candidate) => candidate.slug === slug);
  if (flavour === undefined) return null;

  const palette = canPalette(slug);
  const left = stockLeft === null ? null : (stockLeft[slug] ?? 0);
  const isSoldOut = soldOut[slug] === true || left === 0;

  return (
    <article
      className="flavour-card"
      style={
        { '--card-colour': palette.base, '--card-band': palette.band ?? palette.base } as React.CSSProperties
      }
    >
      <span className="flavour-card__stripe" aria-hidden="true" />
      <div className="flavour-card__art">
        <span
          className="flavour-card__token"
          ref={(element) => {
            token.current = element;
            registerCardToken(slug, element);
          }}
          aria-hidden="true"
        >
          <CanThumbnail flavour={slug} />
        </span>
      </div>

      <div className="flavour-card__body">
        <h3>
          <Link to={`/flavours/${slug}`}>{flavour.name}</Link>
        </h3>
        <p className="mono flavour-card__price">{formatDollars(flavour.can_price_cents)}</p>
        <p className="mono flavour-card__stock">
          {left === null ? flavourCardCopy.stockUnavailable : `${left} left`}
        </p>
        {isSoldOut ? (
          <p className="badge badge--sold-out">
            <CircleSlash aria-hidden="true" size={14} />
            Sold out
          </p>
        ) : null}

        <div className="flavour-card__actions">
          <button
            type="button"
            data-add-flavour={slug}
            className="button button--primary"
            aria-label={`Add ${flavour.name}`}
            onClick={() => void addCan(slug)}
          >
            Add
          </button>
          <button
            type="button"
            className="button button--quiet"
            aria-label={`Fill crate with ${flavour.name}`}
            onClick={() => void fillCrate(slug)}
          >
            Fill crate
          </button>
        </div>
      </div>
    </article>
  );
}
