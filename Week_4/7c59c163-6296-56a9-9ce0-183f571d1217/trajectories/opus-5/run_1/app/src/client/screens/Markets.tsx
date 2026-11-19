import { useEffect, useState } from 'react';
import { marketStatusText } from '../copy.js';
import { get } from '../api.js';
import { formatPrice, inZone } from '../format.js';
import { Shell } from '../components/Shell.js';
import { navigate } from '../main.js';
import type { Market, Me } from '../api.js';

export function Markets(props: { me: Me }): React.JSX.Element {
  const [markets, setMarkets] = useState<Market[] | null>(null);

  useEffect(() => {
    void get<{ markets: Market[] }>('/api/markets')
      .then((value) => setMarkets(value.markets))
      .catch(() => setMarkets([]));
  }, []);

  return (
    <Shell me={props.me} path="/markets" field="sage" stickers={['coin']}>
      <h1>Markets</h1>
      {markets === null ? (
        <div className="skeleton" />
      ) : (
        <ul className="grid grid--two grid--three" style={{ listStyle: 'none', padding: 0 }} aria-label="Markets">
          {markets.map((market) => (
            <li key={market.id} className="card">
              <h3>
                <a
                  href={`/markets/${market.id}`}
                  onClick={(click) => {
                    click.preventDefault();
                    navigate(`/markets/${market.id}`);
                  }}
                >
                  {market.symbol} — {market.title}
                </a>
              </h3>
              <p className="label">{market.kind === 'pair' ? 'Spot and margin' : 'Event'}</p>
              <p>{marketStatusText(market.status, market.outcome)}</p>
              <p className="label">
                Last price{' '}
                {market.last_price === null ? '—' : formatPrice(market.kind, market.last_price)}
              </p>
              {market.closes_at !== null ? (
                <p className="label">
                  Closes {inZone(props.me.venue?.time_zone ?? 'UTC', market.closes_at)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
