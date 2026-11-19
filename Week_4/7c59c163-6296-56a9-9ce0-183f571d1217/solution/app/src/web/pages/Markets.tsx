import { useEffect, useState } from "react";
import { marketStatusText, priceLabel } from "../../shared/rules";
import { api, type Market } from "../api";
import { Shell } from "../components/Shell";
import { Empty, Skeleton } from "../components/ui";
import { formatInZone } from "../format";
import { Link } from "../router";
import { useMe } from "../session";

export function MarketsPage() {
  const me = useMe();
  const [markets, setMarkets] = useState<Market[] | null>(null);
  useEffect(() => {
    api<{ markets: Market[] }>("/api/markets").then((r) => setMarkets(r.markets)).catch(() => setMarkets([]));
  }, []);
  return (
    <Shell field="sage">
      <div className="page-head">
        <h1>Markets</h1>
        <p className="muted">Every market of {me.venue?.name} on one shared book.</p>
      </div>
      {markets === null ? (
        <Skeleton rows={4} />
      ) : markets.length === 0 ? (
        <Empty text="No markets are listed yet." sticker="coin" />
      ) : (
        <ul className="market-grid" aria-label="Markets">
          {markets.map((market) => (
            <li key={market.id} className="card market-card">
              <span className="kind">{market.kind === "event" ? "Event" : "Spot and margin"}</span>
              <Link href={`/markets/${market.id}`} className="market-card-link">
                <span className="symbol">{market.symbol}</span>
                <span className="visually-hidden"> — </span>
                <span className="market-card-title">{market.title}</span>
              </Link>
              <span className="market-card-foot">
                <span className="status-text">{marketStatusText(market.status, market.outcome)}</span>
                <span className="numeric last">{market.last_price === null ? "No trades yet" : `Last ${priceLabel(market.kind, market.last_price)}`}</span>
              </span>
              {market.closes_at && me.venue && <span className="muted small">Closes {formatInZone(market.closes_at, me.venue.time_zone)}</span>}
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
