import { useEffect, useMemo, useState } from "react";
import { money } from "../../shared/rules";
import { api, type Book, type Market } from "../api";
import { Shell } from "../components/Shell";
import { Sticker } from "../components/Sticker";
import { DepthLadder, LastTrade, Orbit, OrbitStage, ringLevels, useFlatBook } from "../orbit/Orbit";
import { useSession } from "../session";

/** An invented sample book for signed-out visitors. */
const SAMPLE_BOOK: Book = {
  market_id: "sample",
  sequence: 0,
  last_price: 50,
  asks: [
    { price: 52, quantity: 140 },
    { price: 55, quantity: 90 },
    { price: 58, quantity: 60 },
  ],
  bids: [
    { price: 48, quantity: 120 },
    { price: 45, quantity: 200 },
    { price: 41, quantity: 80 },
  ],
};

interface Summary {
  volume_cents_today: number;
  open_interest_contracts: number;
  flagship_market_id: string | null;
}

/** The flagship market's book and last price, kept live from the server stream. */
function useFlagship(id: string | null): { market: Market | null; book: Book | null } {
  const [market, setMarket] = useState<Market | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  useEffect(() => {
    if (!id) return;
    const source = new EventSource(`/api/stream?market_id=${id}`);
    source.addEventListener("market", (e) => setMarket(JSON.parse((e as MessageEvent<string>).data) as Market));
    source.addEventListener("book", (e) => setBook(JSON.parse((e as MessageEvent<string>).data) as Book));
    return () => source.close();
  }, [id]);
  return { market, book };
}

function HomeBody({ signedIn }: { signedIn: boolean }) {
  const flat = useFlatBook();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [settled, setSettled] = useState(true);
  const { session } = useSession();
  const isMember = session.status === "signed-in" && session.me.venue !== null;
  useEffect(() => {
    if (isMember) api<Summary>("/api/venue/summary").then(setSummary).catch(() => undefined);
  }, [isMember]);
  const live = useFlagship(summary?.flagship_market_id ?? null);
  const book = isMember ? live.book : SAMPLE_BOOK;
  const levels = useMemo(() => ringLevels(book), [book]);
  const kind = live.market?.kind ?? "event";
  const lastPrice = isMember ? (live.market?.last_price ?? null) : SAMPLE_BOOK.last_price;
  const openHref = !signedIn ? "/auth/login?next=/markets" : summary?.flagship_market_id ? `/markets/${summary.flagship_market_id}` : session.status === "signed-in" && session.me.venue === null ? "/platform" : "/markets";
  const volume = isMember ? (summary?.volume_cents_today ?? 0) : 4440;
  const openInterest = isMember ? (summary?.open_interest_contracts ?? 0) : 120;

  return (
    <div className="home">
      <section className="hero" aria-labelledby="hero-title">
        <Sticker kind="coin" tilt={-7} className="hero-sticker at-left" />
        <Sticker kind="dial" tilt={9} className="hero-sticker at-top" />
        <Sticker kind="cube" tilt={-5} className="hero-sticker at-right" />
        <Sticker kind="envelope" tilt={11} className="hero-sticker at-bottom" />
        <h1 id="hero-title" className="hero-title">Plumtide Venue</h1>
        <div className="hero-orbit">
          <LastTrade kind={kind} price={lastPrice} settled={settled} animate={!flat} />
          <OrbitStage caption={!isMember ? <p className="sample-label">Sample book</p> : null}>
            {flat ? <DepthLadder kind={kind} levels={levels} highlight={null} /> : <Orbit levels={levels} camera="fixed" highlight={null} onSettled={setSettled} />}
          </OrbitStage>
        </div>
        <a className="pill pill-hero" href={openHref}>Open the book</a>
      </section>
      <section className="chapter chapter-sage" aria-labelledby="chapter-book">
        <div className="chapter-inner">
          <h2 id="chapter-book">One book for every kind of order</h2>
          <p className="lede">Spot, margin and yes/no event orders rest on the same price-time book, so a margin buy meets a spot sell and YES interest meets NO interest at 100 minus its price.</p>
          <ul className="explainer">
            <li>
              <Sticker kind="cube" tilt={-4} className="explainer-sticker" />
              <h3>Spot</h3>
              <p>Buy units into your holdings and sell what you hold.</p>
            </li>
            <li>
              <Sticker kind="dial" tilt={6} className="explainer-sticker" />
              <h3>Margin</h3>
              <p>Post half the notional as collateral and hold one long or short position per pair.</p>
            </li>
            <li>
              <Sticker kind="coin" tilt={-8} className="explainer-sticker" />
              <h3>Events</h3>
              <p>Buy YES or NO; every winning contract pays 100 cents at settlement.</p>
            </li>
          </ul>
        </div>
      </section>
      <section className="chapter chapter-blush" aria-labelledby="chapter-today">
        <div className="chapter-inner">
          <h2 id="chapter-today">Your venue today</h2>
          <p className="numeral numeral-hero">{money(volume)}</p>
          <p className="numeral-caption">traded today{isMember ? "" : " in the sample book"}</p>
          <p className="numeral numeral-mid">{openInterest.toLocaleString("en-US")}</p>
          <p className="numeral-caption">contracts of open interest</p>
        </div>
      </section>
      <section className="chapter chapter-olive" aria-labelledby="chapter-close">
        <div className="chapter-inner">
          <h2 id="chapter-close">Your members are already on the book</h2>
          <a className="pill pill-inverse pill-hero" href={openHref}>Open the book</a>
        </div>
      </section>
    </div>
  );
}

export function HomePage() {
  const { session } = useSession();
  if (session.status === "signed-in") {
    return (
      <Shell field="slate" bare>
        <HomeBody signedIn />
      </Shell>
    );
  }
  return (
    <div className="field field-slate">
      <header className="topbar">
        <span className="venue-name">Plumtide Venue</span>
        <a className="pill pill-quiet" href="/auth/login?next=/">Sign in</a>
      </header>
      <main id="main" className="page page-home">
        <HomeBody signedIn={false} />
      </main>
    </div>
  );
}
