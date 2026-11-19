import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { marketStatusText, ORDER_ENDED, priceLabel } from "../../shared/rules";
import { api, ApiError, type Balance, type Book, type Fill, type Market, type Order, type Positions } from "../api";
import { Dialog } from "../components/Dialog";
import { Shell } from "../components/Shell";
import { Skeleton, TableScroll } from "../components/ui";
import { COPY } from "../copy";
import { formatInZone } from "../format";
import { DepthLadder, LastTrade, Orbit, OrbitStage, ringLevels, useFlatBook } from "../orbit/Orbit";
import type { RingLevel } from "../orbit/scene";
import { NotFoundPage } from "../pages/Errors";
import { useMe } from "../session";
import { BookLevels } from "./BookLevels";
import { Ticket, type TicketHandle, type TicketOrder } from "./Ticket";

const MAX_LOG = 10;

function errorLine(error: unknown, market: Market): string {
  if (!(error instanceof ApiError)) return COPY.order.notTrading;
  if (error.code === "market_not_trading") return COPY.order.notTrading;
  const field = error.errors.price ?? error.errors.quantity;
  if (error.errors.price === "out_of_range") return market.kind === "event" ? COPY.order.eventPriceRange : COPY.order.pairPriceRange;
  if (field === "out_of_range") return COPY.order.quantityRange;
  if (field === "insufficient_funds") return COPY.order.insufficientFunds;
  if (field === "insufficient_holdings") return COPY.order.insufficientHoldings;
  if (field === "exceeds_position") return COPY.order.exceedsPosition;
  return market.kind === "event" ? COPY.order.eventPriceRange : COPY.order.pairPriceRange;
}

const orderLabel = (market: Market, order: Order) =>
  market.kind === "event" ? `Buy ${order.outcome === "yes" ? "Yes" : "No"}` : `${order.mode === "spot" ? "Spot" : "Margin"} ${order.side}`;

const STATUS_TEXT: Record<Order["status"], string> = {
  resting: "Resting",
  partially_filled: "Partially filled",
  filled: "Filled",
  cancelled: "Cancelled",
  liquidated: "Liquidated",
};

export function MarketDetail({ id }: { id: string }) {
  const me = useMe();
  const flat = useFlatBook();
  const [missing, setMissing] = useState(false);
  const [market, setMarket] = useState<Market | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [fills, setFills] = useState<Fill[]>([]);
  const [positions, setPositions] = useState<Positions | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [settled, setSettled] = useState(true);
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const ticket = useRef<TicketHandle>(null);
  const ordersHeading = useRef<HTMLHeadingElement>(null);
  const cancelFocus = useRef<HTMLElement | null>(null);
  const announced = useRef(new Set<string>());
  const ownCancels = useRef(new Set<string>());
  const placing = useRef(0);
  const buffered = useRef<Fill[]>([]);
  const marketRef = useRef<Market | null>(null);
  marketRef.current = market;

  const append = useCallback((...lines: string[]) => setLog((current) => [...current, ...lines].slice(-MAX_LOG)), []);
  const drop = useCallback((line: string) => setLog((current) => current.filter((l) => l !== line)), []);

  const announceFill = useCallback(
    (fill: Fill) => {
      const current = marketRef.current;
      if (!current || announced.current.has(fill.id)) return;
      announced.current.add(fill.id);
      append(COPY.order.fill(fill.quantity, priceLabel(current.kind, fill.price)));
    },
    [append],
  );

  const refreshPositions = useCallback(() => {
    api<Positions>("/api/positions").then(setPositions).catch(() => undefined);
  }, []);

  useEffect(() => {
    let closed = false;
    Promise.all([
      api<Market>(`/api/markets/${id}`),
      api<Book>(`/api/markets/${id}/book`),
      api<Balance>("/api/balance"),
      me.roles.some((r) => r === "trader" || r === "builder") ? api<{ orders: Order[] }>(`/api/orders?status=all&market_id=${id}`) : Promise.resolve({ orders: [] }),
      me.roles.some((r) => r === "trader" || r === "builder") ? api<{ fills: Fill[] }>(`/api/fills?market_id=${id}`) : Promise.resolve({ fills: [] }),
    ])
      .then(([m, b, bal, o, f]) => {
        if (closed) return;
        setMarket(m);
        setBook(b);
        setBalance(bal);
        setOrders(o.orders);
        setFills(f.fills);
        for (const fill of f.fills) announced.current.add(fill.id);
      })
      .catch(() => !closed && setMissing(true));
    refreshPositions();
    const source = new EventSource(`/api/stream?market_id=${id}`);
    const on = <T,>(name: string, handle: (data: T) => void) => source.addEventListener(name, (e) => handle(JSON.parse((e as MessageEvent<string>).data) as T));
    on<Market>("market", setMarket);
    on<Book>("book", setBook);
    on<Balance>("balance", setBalance);
    on<Order>("order", (order) => {
      if (order.market_id !== id) return;
      setOrders((current) => [order, ...current.filter((o) => o.id !== order.id)].sort((a, b) => b.created_at.localeCompare(a.created_at)));
      if (order.status === "cancelled" && !ownCancels.current.has(order.id)) {
        ownCancels.current.add(order.id);
        append(COPY.order.cancelled);
      }
    });
    on<Fill>("fill", (fill) => {
      if (fill.market_id !== id) return;
      setFills((current) => [fill, ...current.filter((f) => f.id !== fill.id)].slice(0, 50));
      if (placing.current > 0) buffered.current.push(fill);
      else announceFill(fill);
      refreshPositions();
    });
    on<{ position_id: string; market_id: string; mark_price: number }>("liquidation", (liquidation) => {
      const current = marketRef.current;
      if (current && liquidation.market_id === current.id) append(COPY.order.liquidated(current.symbol, priceLabel(current.kind, liquidation.mark_price)));
      refreshPositions();
    });
    return () => {
      closed = true;
      source.close();
    };
  }, [id]);

  const levels = useMemo(() => ringLevels(book), [book]);

  if (missing) return <NotFoundPage />;

  const select = (level: RingLevel) => {
    if (!market) return;
    setSelected(level.key);
    if (market.kind === "event") {
      ticket.current?.prefill(
        level.side === "ask" ? { outcome: "yes", price: level.price, quantity: level.quantity } : { outcome: "no", price: 100 - level.price, quantity: level.quantity },
      );
    } else {
      ticket.current?.prefill({ side: level.side === "ask" ? "buy" : "sell", price: level.price, quantity: level.quantity });
    }
  };
  const pick = (key: string) => {
    const level = levels.find((l) => l.key === key);
    if (level) select(level);
  };

  const place = async (order: TicketOrder) => {
    if (!market) return;
    placing.current += 1;
    append(COPY.order.sending);
    try {
      const body =
        market.kind === "event"
          ? { market_id: market.id, outcome: order.outcome, price: order.price, quantity: order.quantity }
          : { market_id: market.id, mode: order.mode, side: order.side, price: order.price, quantity: order.quantity };
      const placed = await api<Order>("/api/orders", { body });
      drop(COPY.order.sending);
      const summary =
        placed.filled_quantity === 0
          ? COPY.order.resting
          : placed.filled_quantity === placed.quantity
            ? COPY.order.filledInFull
            : COPY.order.partial(placed.filled_quantity, placed.quantity);
      append(summary);
      for (const fill of placed.fills) announceFill(fill);
      setOrders((current) => [placed, ...current.filter((o) => o.id !== placed.id)]);
    } catch (error) {
      drop(COPY.order.sending);
      append(errorLine(error, market));
    } finally {
      placing.current -= 1;
      if (placing.current === 0) {
        const pending = buffered.current;
        buffered.current = [];
        pending.forEach(announceFill);
      }
    }
  };

  const confirmCancel = async () => {
    const order = cancelling;
    if (!order) return;
    cancelFocus.current = ordersHeading.current;
    setCancelling(null);
    append(COPY.order.cancelling);
    ownCancels.current.add(order.id);
    try {
      const updated = await api<Order>(`/api/orders/${order.id}`, { method: "DELETE" });
      setOrders((current) => current.map((o) => (o.id === updated.id ? updated : o)));
      drop(COPY.order.cancelling);
      append(COPY.order.cancelled);
    } catch {
      drop(COPY.order.cancelling);
      append(COPY.order.alreadyEnded);
    }
  };

  if (!market) {
    return (
      <Shell field="blush">
        <Skeleton rows={4} />
      </Shell>
    );
  }

  const highlight = active ?? selected;
  const empty = levels.length === 0;
  const openPosition = positions?.margin.find((p) => p.market_id === market.id && p.status === "open")?.side ?? null;
  const resting = orders.filter((o) => !ORDER_ENDED.includes(o.status));
  const recent = orders.filter((o) => ORDER_ENDED.includes(o.status)).slice(0, 8);

  return (
    <Shell field="blush">
      <a className="skip-link" href="#order-ticket" onClick={(e) => { e.preventDefault(); document.getElementById("order-ticket")?.focus(); }}>
        Skip to order ticket
      </a>
      <header className="market-header">
        <div className="market-heading">
          <p className="eyebrow">{market.symbol} · {market.kind === "event" ? "Event" : "Spot and margin"}</p>
          <h1>{market.title}</h1>
          <div className="market-meta">
            <p className="badge" role="status" aria-label="Market status">{marketStatusText(market.status, market.outcome)}</p>
            {market.closes_at && me.venue && <p className="muted">Closes {formatInZone(market.closes_at, me.venue.time_zone)}</p>}
          </div>
        </div>
        <div className="market-figures">
          <div className="figure">
            <span className="figure-label">Open interest</span>
            <span className="numeral figure-value" role="region" aria-label="Open interest">{market.open_interest.toLocaleString("en-US")}</span>
          </div>
          <div className="figure" role="region" aria-label="Your balance">
            <span className="figure-label">Available</span> <span className="numeric figure-money">{balance ? priceLabel("pair", balance.available_cents) : "—"}</span>
          </div>
        </div>
      </header>
      <div className="market-stage">
        <div className="book-col">
          <div className="pane pane-orbit">
            <p className="caption">Last trade</p>
            <LastTrade kind={market.kind} price={market.last_price} settled={settled} animate={!flat} />
            <OrbitStage caption={empty ? <p className="empty-line small orbit-empty">{COPY.emptyBook}</p> : null}>
              {flat ? (
                <DepthLadder kind={market.kind} levels={levels} highlight={highlight} onPick={pick} />
              ) : (
                <Orbit levels={levels} camera="scroll" highlight={highlight} onPick={pick} onSettled={setSettled} />
              )}
            </OrbitStage>
          </div>
          <div className="pane pane-levels card">
            <h2 className="card-title">Book levels</h2>
            <BookLevels kind={market.kind} levels={levels} selected={selected} onActive={setActive} onSelect={select} />
          </div>
        </div>
        <div className="pane pane-ticket">
          <Ticket ref={ticket} market={market} openPosition={openPosition} onSubmit={(order) => void place(order)} />
          <div className="card log-card">
            <h2 className="card-title">Order updates</h2>
            <div className="order-log" role="status" aria-live="polite" aria-label="Order updates">
              {log.map((line, i) => (
                <p key={`${i}-${line}`}>{line}</p>
              ))}
            </div>
          </div>
        </div>
        <section className="pane pane-orders card" aria-labelledby="your-orders-heading">
          <h2 id="your-orders-heading" ref={ordersHeading} tabIndex={-1} className="card-title">Your orders</h2>
          {resting.length === 0 && recent.length === 0 ? (
            <p className="muted">No orders on this market yet.</p>
          ) : (
            <TableScroll label="Orders on this market">
              <table className="table" aria-label="Orders on this market">
                <thead>
                  <tr><th scope="col">Order</th><th scope="col">Price</th><th scope="col">Filled</th><th scope="col">Status</th><th scope="col"><span className="visually-hidden">Action</span></th></tr>
                </thead>
                <tbody>
                  {[...resting, ...recent].map((order) => (
                    <tr key={order.id}>
                      <td>{orderLabel(market, order)} <span className="muted mono-free">#{order.id.slice(0, 8)}</span></td>
                      <td className="numeric">{priceLabel(market.kind, order.price)}</td>
                      <td className="numeric">{order.filled_quantity} of {order.quantity}</td>
                      <td>{STATUS_TEXT[order.status]}</td>
                      <td>
                        {!ORDER_ENDED.includes(order.status) && (
                          <button
                            type="button"
                            className="pill pill-small"
                            aria-label={`Cancel order ${order.id.slice(0, 8)}`}
                            onClick={(e) => {
                              cancelFocus.current = e.currentTarget;
                              setCancelling(order);
                            }}
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
          <h3 className="subhead">Recent fills</h3>
          {fills.length === 0 ? (
            <p className="muted">No fills yet.</p>
          ) : (
            <TableScroll label="Recent fills">
              <table className="table" aria-label="Recent fills">
                <thead>
                  <tr><th scope="col">When</th><th scope="col">Quantity</th><th scope="col">Price</th><th scope="col">Fee</th><th scope="col">Liquidity</th></tr>
                </thead>
                <tbody>
                  {fills.slice(0, 10).map((fill) => (
                    <tr key={fill.id}>
                      <td>{me.venue ? formatInZone(fill.filled_at, me.venue.time_zone) : fill.filled_at}</td>
                      <td className="numeric">{fill.quantity}</td>
                      <td className="numeric">{priceLabel(market.kind, fill.price)}</td>
                      <td className="numeric">{priceLabel("pair", fill.fee_cents)}</td>
                      <td>{fill.liquidity === "maker" ? "Maker" : "Taker"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </section>
      </div>
      <Dialog
        title="Cancel order"
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        returnFocus={cancelFocus}
      >
        <p>Cancel order #{cancelling?.id.slice(0, 8)}? Its hold returns to your available balance.</p>
        <div className="dialog-actions">
          <button type="button" className="pill" onClick={() => void confirmCancel()}>Yes, cancel</button>
          <button type="button" className="pill pill-quiet" onClick={() => setCancelling(null)}>Keep order</button>
        </div>
      </Dialog>
    </Shell>
  );
}
