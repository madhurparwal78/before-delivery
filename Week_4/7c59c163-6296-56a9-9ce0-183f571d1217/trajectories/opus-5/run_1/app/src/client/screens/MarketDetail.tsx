import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COPY, marketStatusText } from '../copy.js';
import { RequestFailed, del, get, post } from '../api.js';
import { formatAmount, formatInteger, formatPrice, inZone, shortId } from '../format.js';
import { Shell } from '../components/Shell.js';
import { Dialog } from '../components/Dialog.js';
import { Orbit, ladderLevels } from '../components/Orbit.js';
import { BookLevels } from '../components/BookLevels.js';
import {
  OrderTicket,
  centsToPrice,
  emptyTicket,
  priceToCents,
} from '../components/OrderTicket.js';
import type { TicketValues } from '../components/OrderTicket.js';
import { useStream } from '../stream.js';
import { navigate } from '../main.js';
import type { Balance, Book, Market, Me, Order, Positions } from '../api.js';

const LOG_LIMIT = 10;

interface LogEntry {
  id: number;
  text: string;
  pending: boolean;
}

/** `Order updates` is a log: the newest 10 lines are kept and pending lines are removed on result. */
function useOrderLog(): {
  lines: LogEntry[];
  append: (text: string, pending?: boolean) => number;
  resolvePending: (id: number, lines: string[]) => void;
} {
  const [lines, setLines] = useState<LogEntry[]>([]);
  const nextId = useRef(1);

  const append = useCallback((text: string, pending = false): number => {
    const id = nextId.current;
    nextId.current += 1;
    setLines((current) => [...current, { id, text, pending }].slice(-LOG_LIMIT));
    return id;
  }, []);

  const resolvePending = useCallback((id: number, replacements: string[]): void => {
    setLines((current) => {
      const kept = current.filter((entry) => entry.id !== id);
      const added = replacements.map((text) => {
        const entryId = nextId.current;
        nextId.current += 1;
        return { id: entryId, text, pending: false };
      });
      return [...kept, ...added].slice(-LOG_LIMIT);
    });
  }, []);

  return { lines, append, resolvePending };
}

function fieldErrorText(market: Market, error: RequestFailed): string | null {
  const price = error.fields.price;
  if (price === 'out_of_range') {
    return market.kind === 'event' ? COPY.priceOutOfRangeEvent : COPY.priceOutOfRangePair;
  }
  switch (error.fields.quantity) {
    case 'out_of_range':
      return COPY.quantityOutOfRange;
    case 'insufficient_funds':
      return COPY.insufficientFunds;
    case 'insufficient_holdings':
      return COPY.insufficientHoldings;
    case 'exceeds_position':
      return COPY.exceedsPosition;
    default:
      return null;
  }
}

export function MarketDetail(props: { me: Me; marketId: string }): React.JSX.Element {
  const [market, setMarket] = useState<Market | null>(null);
  const [missing, setMissing] = useState(false);
  const [book, setBook] = useState<Book | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [positions, setPositions] = useState<Positions | null>(null);
  const [ticket, setTicket] = useState<TicketValues>(emptyTicket('event'));
  const [active, setActive] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const log = useOrderLog();
  const ordersHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const quantityFocus = useRef(false);
  /** Fills of a placement in flight are held so the summary line is appended before them. */
  const loggedFills = useRef(new Set<string>());
  const bufferedFills = useRef<{ quantity: number; price: number; id: string }[] | null>(null);

  useEffect(() => {
    void get<Market>(`/api/markets/${props.marketId}`)
      .then((value) => {
        setMarket(value);
        setTicket(emptyTicket(value.kind));
      })
      .catch(() => setMissing(true));
    void get<Book>(`/api/markets/${props.marketId}/book`).then(setBook).catch(() => undefined);
    void get<Balance>('/api/balance').then(setBalance).catch(() => undefined);
    void get<{ orders: Order[] }>(`/api/orders?status=all&market_id=${props.marketId}`)
      .then((value) => setOrders(value.orders))
      .catch(() => undefined);
    void get<Positions>('/api/positions').then(setPositions).catch(() => undefined);
  }, [props.marketId]);

  useEffect(() => {
    if (!quantityFocus.current) return;
    quantityFocus.current = false;
    document.getElementById('ticket-quantity')?.focus();
  }, [ticket]);

  const upsertOrder = useCallback((incoming: Order): void => {
    setOrders((current) => {
      const index = current.findIndex((order) => order.id === incoming.id);
      if (index === -1) return [incoming, ...current];
      const next = [...current];
      next[index] = incoming;
      return next;
    });
  }, []);

  useStream(props.marketId, {
    book: setBook,
    market: setMarket,
    trade: (trade) =>
      setMarket((current) => (current === null ? current : { ...current, last_price: trade.price })),
    balance: setBalance,
    order: (incoming) => {
      upsertOrder(incoming);
      if (incoming.status === 'liquidated' && market !== null) {
        log.append(COPY.liquidated(market.symbol, market.kind, market.last_price ?? 0));
      }
    },
    fill: (fill) => {
      if (market === null || loggedFills.current.has(fill.id)) return;
      if (bufferedFills.current !== null) {
        bufferedFills.current.push({ id: fill.id, quantity: fill.quantity, price: fill.price });
        return;
      }
      loggedFills.current.add(fill.id);
      log.append(COPY.filledAt(market.kind, fill.quantity, fill.price));
      void get<Positions>('/api/positions').then(setPositions).catch(() => undefined);
    },
    liquidation: (liquidated) => {
      if (market === null) return;
      log.append(COPY.liquidated(market.symbol, market.kind, liquidated.mark_price));
      void get<Positions>('/api/positions').then(setPositions).catch(() => undefined);
    },
  });

  const levels = useMemo(() => ladderLevels(book), [book]);

  /** An ask at p sets Outcome Yes and Price p; a bid at p sets Outcome No and Price 100 − p. */
  const choose = useCallback(
    (key: string): void => {
      if (market === null) return;
      const [side, rawPrice] = key.split(':');
      const price = Number.parseInt(rawPrice ?? '0', 10);
      const level = levels.find((item) => item.key === key);
      setActive(key);
      quantityFocus.current = true;
      setTicket((current) => {
        if (market.kind === 'event') {
          return side === 'ask'
            ? { ...current, outcome: 'yes', price: String(price), quantity: String(level?.quantity ?? current.quantity) }
            : { ...current, outcome: 'no', price: String(100 - price), quantity: String(level?.quantity ?? current.quantity) };
        }
        return {
          ...current,
          side: side === 'ask' ? 'buy' : 'sell',
          price: centsToPrice('pair', price),
          quantity: String(level?.quantity ?? current.quantity),
        };
      });
    },
    [levels, market],
  );

  const reducesPosition = useMemo(() => {
    if (market === null || market.kind !== 'pair' || ticket.mode !== 'margin') return false;
    const position = positions?.margin.find(
      (item) => item.market_id === market.id && item.status === 'open',
    );
    if (position === undefined) return false;
    return (
      (position.side === 'long' && ticket.side === 'sell') ||
      (position.side === 'short' && ticket.side === 'buy')
    );
  }, [market, positions, ticket.mode, ticket.side]);

  const place = async (): Promise<void> => {
    if (market === null) return;
    setFieldError(null);
    const pendingId = log.append(COPY.sendingOrder, true);
    bufferedFills.current = [];
    const body =
      market.kind === 'event'
        ? {
            market_id: market.id,
            outcome: ticket.outcome,
            price: priceToCents('event', ticket.price),
            quantity: Math.round(Number(ticket.quantity)),
          }
        : {
            market_id: market.id,
            mode: ticket.mode,
            side: ticket.side,
            price: priceToCents('pair', ticket.price),
            quantity: Math.round(Number(ticket.quantity)),
          };
    try {
      const order = await post<Order>('/api/orders', body);
      const summary =
        order.filled_quantity === 0
          ? COPY.orderResting
          : order.filled_quantity === order.quantity
            ? COPY.filledInFull
            : COPY.partiallyFilled(order.filled_quantity, order.quantity);
      for (const fill of order.fills) loggedFills.current.add(fill.id);
      const held = (bufferedFills.current ?? []).filter((fill) => !loggedFills.current.has(fill.id));
      for (const fill of held) loggedFills.current.add(fill.id);
      bufferedFills.current = null;
      log.resolvePending(pendingId, [
        summary,
        ...order.fills.map((fill) => COPY.filledAt(market.kind, fill.quantity, fill.price)),
        ...held.map((fill) => COPY.filledAt(market.kind, fill.quantity, fill.price)),
      ]);
      upsertOrder(order);
      setBalance(await get<Balance>('/api/balance'));
      setPositions(await get<Positions>('/api/positions'));
    } catch (error) {
      bufferedFills.current = null;
      if (!(error instanceof RequestFailed)) throw error;
      const text = fieldErrorText(market, error);
      setFieldError(text);
      log.resolvePending(
        pendingId,
        error.code === 'market_not_trading' ? [COPY.marketNotTrading] : text === null ? [] : [text],
      );
    }
  };

  const cancel = async (order: Order): Promise<void> => {
    const pendingId = log.append(COPY.cancelling, true);
    try {
      const cancelled = await del<Order>(`/api/orders/${order.id}`);
      upsertOrder(cancelled);
      log.resolvePending(pendingId, [COPY.orderCancelled]);
      setBalance(await get<Balance>('/api/balance'));
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      log.resolvePending(
        pendingId,
        error.code === 'invalid_transition' ? [COPY.orderAlreadyEnded] : [],
      );
    }
  };

  if (missing) {
    return (
      <Shell me={props.me} path="/markets" field="blush">
        <h1>{COPY.notFoundHeading}</h1>
      </Shell>
    );
  }
  if (market === null) {
    return (
      <Shell me={props.me} path="/markets" field="blush">
        <div className="skeleton" />
      </Shell>
    );
  }

  const resting = orders.filter(
    (order) => order.status === 'resting' || order.status === 'partially_filled',
  );
  const recent = orders.slice(0, 20);
  const fills = orders.flatMap((order) => order.fills).slice(0, 20);

  return (
    <Shell me={props.me} path="/markets" field="blush">
      <a className="skip-link" href="#order-ticket-heading">
        Skip to order ticket
      </a>
      <div className="market-detail">
        <header className="market-detail__header card">
          <h1>{market.title}</h1>
          <p>
            <span className="status" role="status" aria-label="Market status">
              {marketStatusText(market.status, market.outcome)}
            </span>
          </p>
          {market.closes_at !== null ? (
            <p className="label">
              Closes {inZone(props.me.venue?.time_zone ?? 'UTC', market.closes_at)}
            </p>
          ) : null}
          <div className="grid grid--two">
            <div>
              <span className="label">Open interest</span>
              <span className="numeral" role="region" aria-label="Open interest">
                {formatInteger(market.open_interest)}
              </span>
            </div>
            <div>
              <span className="label">
                Your balance
              </span>
              <span className="numeral" role="region" aria-label="Your balance">
                Available {formatAmount(balance?.available_cents ?? 0)}
              </span>
            </div>
          </div>
        </header>

        <div className="market-detail__orbit">
          <Orbit
            kind={market.kind}
            levels={levels}
            lastPrice={market.last_price}
            highlight={active}
            onSelect={choose}
            scrollCamera
          />
        </div>

        <div className="market-detail__levels card">
          <h3>Book levels</h3>
          {levels.length === 0 ? (
            <p className="empty-line">{COPY.emptyBook}</p>
          ) : (
            <BookLevels
              kind={market.kind}
              levels={levels}
              active={active}
              onActive={setActive}
              onChoose={choose}
            />
          )}
        </div>

        <div className="market-detail__ticket">
          <OrderTicket
            market={market}
            values={ticket}
            onChange={setTicket}
            reducesPosition={reducesPosition}
            fieldError={fieldError}
            onSubmit={() => void place()}
          />
          <div className="card">
            <h3>Order updates</h3>
            <div className="status" role="status" aria-live="polite" aria-label="Order updates">
              <ul className="log">
                {log.lines.map((entry) => (
                  <li key={entry.id}>{entry.text}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <section className="market-detail__orders card" role="region" aria-label="Your orders">
          <h3 tabIndex={-1} ref={ordersHeadingRef}>
            Your orders
          </h3>
          <div className="table-scroll">
            <table>
              <caption className="label">Resting and recent orders</caption>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Side</th>
                  <th scope="col">Price</th>
                  <th scope="col">Filled</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <a href={`/orders/${order.id}`} onClick={(click) => { click.preventDefault(); navigate(`/orders/${order.id}`); }}>
                        {shortId(order.id)}
                      </a>
                    </td>
                    <td>
                      {market.kind === 'event'
                        ? order.outcome === 'yes'
                          ? 'Buy Yes'
                          : 'Buy No'
                        : `${order.mode === 'margin' ? 'Margin' : 'Spot'} ${order.side}`}
                    </td>
                    <td>{formatPrice(market.kind, order.price)}</td>
                    <td>
                      {order.filled_quantity} / {order.quantity}
                    </td>
                    <td>{order.status.replace('_', ' ')}</td>
                    <td>
                      {resting.some((item) => item.id === order.id) ? (
                        <button
                          type="button"
                          className="pill"
                          onClick={() => setCancelling(order)}
                        >
                          Cancel order {shortId(order.id)}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h4>Recent fills</h4>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Price</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">Fee</th>
                </tr>
              </thead>
              <tbody>
                {fills.map((fill) => (
                  <tr key={fill.id}>
                    <td>{inZone(props.me.venue?.time_zone ?? 'UTC', fill.filled_at)}</td>
                    <td>{formatPrice(market.kind, fill.price)}</td>
                    <td>{fill.quantity}</td>
                    <td>{formatAmount(fill.fee_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <div className="market-detail__tail" aria-hidden="true" />

      {cancelling !== null ? (
        <CancelDialog
          order={cancelling}
          ordersHeading={ordersHeadingRef}
          onClose={() => setCancelling(null)}
          onConfirm={(order) => {
            setCancelling(null);
            void cancel(order);
          }}
        />
      ) : null}
    </Shell>
  );
}

/** Yes, cancel moves focus to the Your orders heading; Escape and Keep order return it to the row. */
function CancelDialog(props: {
  order: Order;
  ordersHeading: React.RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
  onConfirm: (order: Order) => void;
}): React.JSX.Element {
  const yesRef = useRef<HTMLButtonElement | null>(null);
  const confirmed = useRef(false);
  return (
    <Dialog
      label="Cancel order"
      initialFocus={yesRef}
      returnFocus={() => (confirmed.current ? props.ordersHeading.current : null)}
      onClose={props.onClose}
    >
      <h2>Cancel order</h2>
      <p>Cancel order {shortId(props.order.id)}?</p>
      <div className="dialog__actions">
        <button
          type="button"
          className="pill"
          ref={yesRef}
          onClick={() => {
            confirmed.current = true;
            props.onConfirm(props.order);
          }}
        >
          Yes, cancel
        </button>
        <button type="button" className="pill pill--quiet" onClick={props.onClose}>
          Keep order
        </button>
      </div>
    </Dialog>
  );
}
