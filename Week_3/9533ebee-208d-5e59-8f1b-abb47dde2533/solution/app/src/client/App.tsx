import { useEffect, type ReactNode } from "react";
import { api } from "./api.ts";
import { FeedbackProvider, HOME, NavProvider, SessionProvider, useFeedback, useLive, useNav, useSession } from "./state.tsx";
import { Fig, Labelled, Link, Mono, Price } from "./ui.tsx";
import { ROLE_LABEL, type Pool, type Position, type Role } from "./types.ts";
import { bpsPercent, displayDuration, displaySharePrice, secondsOfIso } from "../shared/format.ts";
import { TradeView } from "./views/Trade.tsx";
import { BorrowView } from "./views/Borrow.tsx";
import { PositionView } from "./views/Position.tsx";
import { SupplyView } from "./views/Supply.tsx";
import { LiquidationsView } from "./views/Liquidations.tsx";
import { StewardView } from "./views/Steward.tsx";
import { LedgerView } from "./views/Ledger.tsx";
import { SettlementView } from "./views/Settlement.tsx";
import { BANNER, NOT_FOUND_PAGE, ORACLE_LINES } from "../shared/copy.ts";

const SECTIONS: { label: string; href: string; roles: Role[] }[] = [
  { label: "Steward", href: "/steward", roles: ["risk_steward"] },
  { label: "Ledger", href: "/ledger", roles: ["risk_steward"] },
  { label: "Liquidations", href: "/liquidations", roles: ["risk_steward", "liquidator"] },
  { label: "Supply", href: "/supply", roles: ["liquidity_provider"] },
  { label: "Trade", href: "/trade", roles: ["trader"] },
  { label: "Borrow", href: "/borrow", roles: ["borrower"] },
];

/** The size of the liquidation queue, shown as a badge beside the Liquidations link and kept out of its name. */
function QueueBadge() {
  const { data } = useLive(() => api<{ positions: Position[] }>("GET", "/api/liquidations/queue").then((b) => b.positions.length), 5000, []);
  return (
    <span className={`badge${data === undefined ? " badge-pending" : ""}`} aria-hidden="true">
      {data ?? 0}
    </span>
  );
}

function TopBar() {
  const { members, member, choose } = useSession();
  const { path } = useNav();
  return (
    <header className="topbar">
      <p className="brand">
        Quillmoor <span>Reserve</span>
      </p>
      <div className="acting">
        <label htmlFor="acting-as">Acting as</label>
        <select id="acting-as" value={member?.actor_id ?? ""} onChange={(event) => choose(event.target.value)}>
          {member ? null : <option value="">Choose a member</option>}
          {(members.length === 0 && member ? [member] : members).map((m) => (
            <option key={m.actor_id} value={m.actor_id}>
              {`${m.name} (${ROLE_LABEL[m.role]})`}
            </option>
          ))}
        </select>
      </div>
      <nav aria-label="Sections" className="sections">
        <ul>
          {SECTIONS.filter((s) => member && s.roles.includes(member.role)).map((s) => (
            <li key={s.label}>
              <Link href={s.href} className={path === s.href ? "current" : undefined}>
                {s.label}
              </Link>
              {s.label === "Liquidations" ? <QueueBadge /> : null}
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

function PoolCard({ pool }: { pool: Pool }) {
  return (
    <article className="pool-card" aria-label={`${pool.asset} pool`}>
      <h3>
        {pool.asset} <span className="pool-name">{pool.name}</span>
      </h3>
      <dl>
        <Labelled label="Available liquidity">
          <Fig minor={pool.available_liquidity} decimals={pool.decimals} />
        </Labelled>
        <Labelled label="Total borrowed">
          <Fig minor={pool.total_borrowed} decimals={pool.decimals} />
        </Labelled>
        <Labelled label="Utilization">
          <Mono>{bpsPercent(pool.utilization_bps)}%</Mono>
        </Labelled>
        <Labelled label="Share price">
          <Mono className={pool.share_price > "1.000000000000" ? "accrual" : undefined}>{displaySharePrice(pool.share_price)}</Mono>
        </Labelled>
        <Labelled label="Borrow rate">
          <Mono>{bpsPercent(pool.borrow_rate_bps)}%</Mono>
        </Labelled>
        <Labelled label="Supply rate">
          <Mono className="accrual">{bpsPercent(pool.supply_rate_bps)}%</Mono>
        </Labelled>
      </dl>
    </article>
  );
}

function PoolColumn() {
  const { market } = useSession();
  return (
    <section className="zone-pools" aria-label="Pools">
      {market?.pools.map((pool) => <PoolCard key={pool.asset} pool={pool} />)}
    </section>
  );
}

/** The acting member's wallet, at the top of every worksheet. */
function WalletRegion() {
  const { wallet, market, member } = useSession();
  if (!member) return null;
  const decimals = (asset: string) => market?.pools.find((p) => p.asset === asset)?.decimals ?? 0;
  return (
    <section aria-label="Wallet" className="wallet">
      <h2 className="wallet-title">Wallet</h2>
      <dl className="wallet-figures">
        {(wallet?.balances ?? []).map((b) => (
          <Labelled key={b.asset} label={b.asset}>
            <Fig minor={b.amount} decimals={decimals(b.asset)} />
          </Labelled>
        ))}
      </dl>
    </section>
  );
}

function PriceRail() {
  const { market } = useSession();
  const stale = market?.pools.filter((p) => p.market_state === "stale_feed") ?? [];
  return (
    <aside className="zone-rail" aria-label="Posted prices">
      <h2 className="rail-title">Posted prices</h2>
      {stale.length > 0 ? (
        <div role="alert" aria-label="Price feed" className="feed-banner">
          <p>{BANNER}</p>
          {stale.map((p) => (
            <p key={p.asset} className="feed-line">
              {`${p.asset} price is ${p.price_age_seconds} seconds old.`}
            </p>
          ))}
        </div>
      ) : null}
      <ul className="rail-prices">
        {market?.pools.map((p) => {
          const line = ORACLE_LINES[p.oracle_status];
          return (
            <li key={p.asset} className={p.market_state === "stale_feed" ? "rail-stale" : undefined}>
              <div role="group" aria-label={`${p.asset} price`} className="rail-group">
                <span className="rail-asset">{p.asset}</span>
                <Price value={p.price} className="rail-price" />
                <span className="rail-source">{p.price_source === "oracle" ? `Oracle round ${p.oracle_round}` : "Manual post"}</span>
                <span className="rail-age">{`Posted ${p.price_age_seconds} seconds ago`}</span>
                {line ? <span className="rail-oracle">{line}</span> : null}
              </div>
            </li>
          );
        })}
      </ul>
      {market ? (
        <dl className="rail-durations">
          <Labelled label="Grace period">
            <Mono>{displayDuration(secondsOfIso(market.grace_period))}</Mono>
          </Labelled>
          <Labelled label="Quote lifetime">
            <Mono>{displayDuration(secondsOfIso(market.quote_lifetime))}</Mono>
          </Labelled>
          <Labelled label="Staleness limit">
            <Mono>{displayDuration(secondsOfIso(market.staleness_limit))}</Mono>
          </Labelled>
        </dl>
      ) : null}
    </aside>
  );
}

function FeedbackRegions() {
  const { announcement, problem } = useFeedback();
  return (
    <div className="feedback">
      <div role="status" aria-live="polite" aria-label="Announcements" className={`announcements${announcement ? " has-copy" : ""}`}>
        {announcement ? (
          <p>
            {announcement.text}
            {announcement.link ? (
              <>
                {" "}
                <Link href={announcement.link.href} className="inline-link">
                  {announcement.link.label}
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
      <div role="alert" aria-label="Problems" className={`problems${problem ? " has-copy" : ""}`}>
        {problem && "text" in problem ? <p>{problem.text}</p> : null}
        {problem && "fields" in problem ? (
          <>
            <p>Check the highlighted fields.</p>
            <ul>
              {problem.fields.map((field) => (
                <li key={field.id}>
                  <a
                    href={`#${field.id}`}
                    className="inline-link"
                    onClick={(event) => {
                      event.preventDefault();
                      document.getElementById(field.id)?.focus();
                    }}
                  >
                    {field.label}
                  </a>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <section className="sheet-section">
      <h1>{NOT_FOUND_PAGE}</h1>
      <p>
        <Link href="/" className="inline-link">
          Back to the ledger
        </Link>
      </p>
    </section>
  );
}

function Home() {
  const { member } = useSession();
  const { navigate } = useNav();
  useEffect(() => {
    if (member) navigate(HOME[member.role]);
  }, [member, navigate]);
  return (
    <section className="sheet-section">
      <h1>Quillmoor Reserve</h1>
      <p>Choose who you are acting as to open your view of the books.</p>
    </section>
  );
}

function CurrentView(): ReactNode {
  const { path } = useNav();
  const { member, ready } = useSession();
  const segments = path.split("/").filter(Boolean);
  const [first, second] = segments;
  const known =
    segments.length === 0 ||
    (segments.length === 2 && (first === "positions" || first === "settlements") && second !== undefined) ||
    (segments.length === 1 && ["trade", "borrow", "supply", "liquidations", "steward", "ledger"].includes(first ?? ""));
  if (!known) return <NotFound />;
  if (!ready) return null;
  if (!member) return <Home />;
  if (segments.length === 0) return <Home />;
  if (first === "positions" && second) return <PositionView positionId={decodeURIComponent(second)} />;
  if (first === "settlements" && second) return <SettlementView settlementId={decodeURIComponent(second)} />;
  switch (first) {
    case "trade":
      return <TradeView />;
    case "borrow":
      return <BorrowView />;
    case "supply":
      return <SupplyView />;
    case "liquidations":
      return <LiquidationsView />;
    case "steward":
      return <StewardView />;
    default:
      return <LedgerView />;
  }
}

function Shell() {
  const { path } = useNav();
  const { report, announce } = useFeedback();
  const { ready, member, loaded } = useSession();
  // The sheet is painted once, whole: nothing in it is drawn before the session is known and, for a member, the pools,
  // prices and wallet have answered, so nothing already on screen is pushed down when they arrive.
  const settled = ready && (member === null || loaded);
  // A new view starts with clean feedback regions, except an announcement that links into it.
  useEffect(() => {
    report(null);
  }, [path, report]);
  useEffect(() => {
    if (!path.startsWith("/settlements/")) announce(null);
  }, [path, announce]);
  return (
    <>
      <TopBar />
      <div className={member ? "sheet" : "sheet sheet-solo"}>
        {settled ? (
          <>
            <main className="zone-work" id="worksheet">
              <WalletRegion />
              <FeedbackRegions />
              <CurrentView key={path} />
            </main>
            {member ? (
              <>
                <PoolColumn />
                <PriceRail />
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}

export function App() {
  return (
    <NavProvider>
      <FeedbackProvider>
        <SessionProvider>
          <Shell />
        </SessionProvider>
      </FeedbackProvider>
    </NavProvider>
  );
}
