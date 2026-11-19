import { useEffect, useMemo, useState } from 'react';
import { COPY } from '../copy.js';
import { get } from '../api.js';
import { formatAmount, formatInteger } from '../format.js';
import { Orbit, ladderLevels } from '../components/Orbit.js';
import { Sticker } from '../components/Stickers.js';
import { Shell } from '../components/Shell.js';
import { useStream } from '../stream.js';
import type { Book, Market, Me, VenueSummary } from '../api.js';

/** A bundled, invented sample book for the signed-out hero. */
const SAMPLE_BOOK: Book = {
  market_id: 'sample',
  sequence: 0,
  last_price: 42,
  bids: [
    { price: 41, quantity: 180 },
    { price: 38, quantity: 260 },
    { price: 34, quantity: 120 },
  ],
  asks: [
    { price: 44, quantity: 210 },
    { price: 48, quantity: 140 },
    { price: 53, quantity: 90 },
  ],
};

const STICKERS = [
  { kind: 'coin' as const, place: 'top' },
  { kind: 'dial' as const, place: 'right' },
  { kind: 'cube' as const, place: 'bottom' },
  { kind: 'envelope' as const, place: 'left' },
];

function Hero(props: {
  book: Book;
  kind: 'pair' | 'event';
  href: string;
  label?: string;
}): React.JSX.Element {
  const levels = useMemo(() => ladderLevels(props.book), [props.book]);
  const [highlight, setHighlight] = useState('');
  return (
    <section className="hero field field--slate">
      {STICKERS.map((sticker) => (
        <Sticker
          key={sticker.kind}
          kind={sticker.kind}
          size={170}
          animate
          className={`hero__sticker hero__sticker--${sticker.place}`}
        />
      ))}
      <h1>{COPY.productName}</h1>
      <div className="hero__orbit">
        <Orbit
          kind={props.kind}
          levels={levels}
          lastPrice={props.book.last_price}
          highlight={highlight}
          onSelect={setHighlight}
          scrollCamera={false}
          label={props.label}
        />
      </div>
      <a className="pill pill--big" href={props.href}>
        {COPY.openTheBook}
      </a>
    </section>
  );
}

function Chapters(props: {
  volumeCents: number;
  openInterest: number;
  href: string;
}): React.JSX.Element {
  return (
    <>
      <section className="field field--sage">
        <div className="wrap">
          <h2>One shared book</h2>
          <p>
            Spot, margin and yes/no event contracts rest on one price-time-priority book, so YES and
            NO interest meets without a second venue.
          </p>
          <div className="grid grid--three">
            <div className="card">
              <Sticker kind="cube" size={110} />
              <h3>Spot</h3>
              <p>Buy and sell units outright; holdings settle into your balance.</p>
            </div>
            <div className="card">
              <Sticker kind="dial" size={110} />
              <h3>Margin</h3>
              <p>Open one long or short per pair with collateral and a maintenance check.</p>
            </div>
            <div className="card">
              <Sticker kind="coin" size={110} />
              <h3>Event</h3>
              <p>A YES buy at a price meets a NO buy at 100 minus that price.</p>
            </div>
          </div>
        </div>
      </section>
      <section className="field field--blush">
        <div className="wrap">
          <h2>Your venue today</h2>
          <div className="grid grid--two">
            <div className="card">
              <span className="label">Volume today</span>
              <span className="numeral numeral--huge">{formatAmount(props.volumeCents)}</span>
            </div>
            <div className="card">
              <span className="label">Open interest</span>
              <span className="numeral">{formatInteger(props.openInterest)}</span>
            </div>
          </div>
        </div>
      </section>
      <section className="field field--olive">
        <div className="wrap" style={{ textAlign: 'center' }}>
          <h2>Members-only, balanced to the cent</h2>
          <a className="pill pill--big" href={props.href} style={{ background: 'var(--stone)', color: 'var(--ink)' }}>
            {COPY.openTheBook}
          </a>
        </div>
      </section>
    </>
  );
}

export function Home(props: { me: Me | null }): React.JSX.Element {
  const [summary, setSummary] = useState<VenueSummary | null>(null);
  const [market, setMarket] = useState<Market | null>(null);
  const [book, setBook] = useState<Book | null>(null);

  useEffect(() => {
    if (props.me === null || props.me.venue === null) return;
    void get<VenueSummary>('/api/venue/summary')
      .then(async (value) => {
        setSummary(value);
        if (value.flagship_market_id === null) return;
        setMarket(await get<Market>(`/api/markets/${value.flagship_market_id}`));
        setBook(await get<Book>(`/api/markets/${value.flagship_market_id}/book`));
      })
      .catch(() => undefined);
  }, [props.me]);

  useStream(market?.id ?? null, {
    book: setBook,
    market: setMarket,
    trade: () => undefined,
  });

  if (props.me === null) {
    return (
      <>
        <header className="topbar">
          <span className="topbar__venue">{COPY.productName}</span>
          <div className="topbar__right">
            <a className="pill" href="/auth/login">
              Sign in
            </a>
          </div>
        </header>
        <Hero book={SAMPLE_BOOK} kind="event" href="/auth/login" label={COPY.sampleBook} />
        <Chapters volumeCents={0} openInterest={0} href="/auth/login" />
      </>
    );
  }

  const href = market === null ? '/markets' : `/markets/${market.id}`;
  return (
    <Shell me={props.me} path="/" field="slate" bare>
      <Hero book={book ?? { ...SAMPLE_BOOK, bids: [], asks: [], last_price: null }} kind={market?.kind ?? 'event'} href={href} />
      <Chapters
        volumeCents={summary?.volume_cents_today ?? 0}
        openInterest={summary?.open_interest_contracts ?? 0}
        href={href}
      />
    </Shell>
  );
}
