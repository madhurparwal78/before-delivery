/** The home page: hero shout, deals rail, category banners. */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api.ts';
import { Link } from '../router.tsx';
import { usePincode } from '../state.tsx';
import { Amount, PendingButton } from '../components/ui.tsx';
import { ProductCard } from '../components/ProductCard.tsx';
import {
  CylinderLabel,
  KineticHeading,
  ParallaxBanner,
  ParticleWordmark,
  PinnedDealsRail,
  ScrollTiffin,
} from '../effects/decor.tsx';
import { CATEGORIES } from '../../shared/catalogue.js';
import { COPY, FIELD, pincodeNotServiceable } from '../../shared/messages.js';
import { formatPromiseDate } from '../../shared/format.js';
import type { PincodeInfo, SearchResponse } from '../../shared/types.js';

export function HomePage(): ReactNode {
  const [pincode, setPincode] = usePincode();
  const [entry, setEntry] = useState(pincode ?? '');
  const [message, setMessage] = useState('');
  const [deals, setDeals] = useState<SearchResponse | null>(null);

  useEffect(() => {
    const suffix = pincode === null ? '' : `&pin=${pincode}`;
    void api<SearchResponse>(`/api/search?limit=8&sort=newest${suffix}`)
      .then(setDeals)
      .catch(() => setDeals(null));
  }, [pincode]);

  const check = async (): Promise<void> => {
    if (!/^[1-9][0-9]{5}$/.test(entry)) {
      setMessage(FIELD.badPincode);
      return;
    }
    const info = await api<PincodeInfo>(`/api/pincodes/${entry}`);
    setPincode(info.pincode);
    setMessage(info.serviceable ? '' : pincodeNotServiceable(info.pincode));
  };

  const hits = deals?.hits ?? [];

  return (
    <>
      <section className="hero panel-flat">
        <div className="row" style={{ alignItems: 'flex-end', gap: 24 }}>
          <h1>{COPY.heroHeading}</h1>
          <ParticleWordmark text="chauraha" />
        </div>
        <ScrollTiffin />
        <div className="hero-band">
          <div
            className="marquee"
            role="region"
            aria-label="Delivery promises"
            tabIndex={0}
          >
            <span className="marquee-track">
              {hits.length === 0
                ? 'one cart. every seller. one promise per parcel.'
                : hits
                    .map((hit) =>
                      hit.promise_date === null
                        ? `${hit.title} from ${hit.seller_name}`
                        : `${hit.title} arrives by ${formatPromiseDate(hit.promise_date)}`,
                    )
                    .join('  •  ')}
            </span>
          </div>
          <div className="hero-fields">
            <div>
              <label htmlFor="home-pincode">Your pincode</label>
              <input
                id="home-pincode"
                type="text"
                aria-label="Your pincode"
                inputMode="numeric"
                value={entry}
                onChange={(event) => setEntry(event.target.value)}
              />
            </div>
            <PendingButton label="Check" className="btn btn-yellow" onPress={check} />
          </div>
          {message === '' ? null : <p className="panel panel-pink">{message}</p>}
        </div>
      </section>

      <section role="region" aria-label="Today's Deals">
        <div className="row">
          <KineticHeading text="today's deals" />
          <CylinderLabel text="today only" />
        </div>
        <PinnedDealsRail>
          {hits.map((hit) => (
            <li key={hit.listing_id}>
              <ProductCard hit={hit} pincode={pincode} />
            </li>
          ))}
        </PinnedDealsRail>
      </section>

      <section className="grid grid-2">
        {CATEGORIES.map((category) => (
          <ParallaxBanner key={category.slug} title={category.name}>
            <p className="muted">
              {hits.filter((hit) => hit.category === category.slug).length} live listings now
            </p>
            <Link to={`/search?category=${category.slug}`} className="btn btn-yellow">
              {`shop ${category.name.toLowerCase()}`}
            </Link>
          </ParallaxBanner>
        ))}
      </section>

      {hits.length === 0 ? null : (
        <section className="panel">
          <h3>cheapest right now</h3>
          <p className="price">
            <Amount paise={Math.min(...hits.map((hit) => hit.price_paise))} />
          </p>
        </section>
      )}
    </>
  );
}
