/** One product panel: art that ripples, the poster price and the delivery line. */

import type { ReactNode } from 'react';
import { Link } from '../router.tsx';
import { ProductImage } from '../effects/visuals.tsx';
import { Amount } from './ui.tsx';
import { formatPromiseDate } from '../../shared/format.js';
import { pincodeNotServiceable } from '../../shared/messages.js';
import type { SearchHit } from '../../shared/types.js';

export function ProductCard({
  hit,
  compare,
  pincode,
}: {
  hit: SearchHit;
  compare?: { checked: boolean; onToggle: () => void };
  pincode?: string | null;
}): ReactNode {
  return (
    <article className="panel" aria-label={hit.title}>
      <Link to={`/p/${hit.product_id}`}>
        <ProductImage src={hit.image_url} alt={hit.title} />
      </Link>
      <h4>
        <Link to={`/p/${hit.product_id}`}>{hit.title}</Link>
      </h4>
      <p className="price">
        <Amount paise={hit.price_paise} />
      </p>
      <p className="muted">{`${hit.brand} · ${hit.seller_name} · ${hit.rating.toFixed(1)}★`}</p>
      {hit.delivers === null ? null : hit.delivers && hit.promise_date !== null ? (
        <p>{`arrives by ${formatPromiseDate(hit.promise_date)}`}</p>
      ) : (
        <p className="panel panel-pink">
          {pincodeNotServiceable(pincode ?? '')}
        </p>
      )}
      {compare === undefined ? null : (
        <div className="check-row">
          <input
            id={`compare-${hit.listing_id}`}
            type="checkbox"
            aria-label={`Compare ${hit.title}`}
            checked={compare.checked}
            onChange={compare.onToggle}
          />
          <label htmlFor={`compare-${hit.listing_id}`}>compare</label>
        </div>
      )}
    </article>
  );
}
