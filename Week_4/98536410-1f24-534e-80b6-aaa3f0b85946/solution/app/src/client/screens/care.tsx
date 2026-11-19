// /care and /care/orders/<id>: find a customer's orders, read an order's history, verify it and download its document.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PausedButton, Status } from "../controls";
import { ApiFailure, api } from "../lib/api";
import { Figure } from "../lib/figure";
import { focusById, focusIdOf } from "../lib/focus";
import { formatEuro, lisbonStamp } from "../lib/format";
import { SEARCH_DEBOUNCE_MS, useDebounced, useLatestRequest } from "../lib/hooks";
import { Overlay } from "../lib/overlay";
import { loadScreen, saveScreen } from "../lib/persist";
import { Link } from "../lib/router";
import { useMe } from "../session";
import { PAUSE_COPY, useStorageDown } from "../storage";
import type { HistoryEntry, Order, OrderList } from "../types";
import { NotFound } from "./notfound";
import { downloadDocument } from "./order";

const ERROR_COPY = "Something went wrong. Try again.";

export function CareSearch() {
  const [term, setTerm] = useState("");
  const [list, setList] = useState<OrderList | null>(null);
  const [message, setMessage] = useState("");
  const [focusNew, setFocusNew] = useState<string | null>(null);
  const requests = useLatestRequest();
  const table = useRef<HTMLDivElement | null>(null);

  const run = useCallback((text: string) => {
    const token = requests.begin();
    setMessage("Searching...");
    api<OrderList>("GET", `/api/orders?q=${encodeURIComponent(text.trim())}`).then((answer) => {
      if (!requests.isLatest(token)) return;
      setList(answer);
      setMessage(answer.count === 0 ? "No orders match." : `${answer.count} orders found.`);
    }, () => {
      if (requests.isLatest(token)) setMessage(ERROR_COPY);
    });
  }, [requests]);

  const later = useDebounced(() => run(term), SEARCH_DEBOUNCE_MS);
  useEffect(() => run(""), [run]);

  async function more() {
    if (!list?.next_before) return;
    setMessage("Loading more orders.");
    try {
      const answer = await api<OrderList>("GET", `/api/orders?q=${encodeURIComponent(term.trim())}&before=${encodeURIComponent(list.next_before)}`);
      const merged = [...list.orders, ...answer.orders];
      setList({ count: answer.count, orders: merged, next_before: answer.next_before });
      setMessage(`Showing ${merged.length} of ${answer.count} orders.`);
      setFocusNew(answer.orders[0]?.id ?? null);
    } catch {
      setMessage(ERROR_COPY);
    }
  }

  useEffect(() => {
    if (focusNew) table.current?.querySelector<HTMLElement>(`[data-order-id="${focusNew}"] a`)?.focus();
    setFocusNew(null);
  }, [focusNew]);

  return (
    <main className="care-page">
      <h1>Orders</h1>
      <label className="field-label" htmlFor="find-order">Find order</label>
      <input id="find-order" type="search" className="field" value={term} onChange={(event) => { setTerm(event.target.value); later(); }} />
      <Status label="Care updates" text={message} />
      <div className={`charcoal-panel scroll-x${(list?.orders ?? []).length === 0 ? " table-empty" : ""}`} ref={table}>
        <table aria-label="Orders">
          <thead><tr><th scope="col">Order</th><th scope="col">Status</th><th scope="col">Shop</th><th scope="col">Customer</th><th scope="col">Total</th></tr></thead>
          <tbody>
            {(list?.orders ?? []).map((order) => (
              <tr key={order.id} data-order-id={order.id}>
                <td><Link to={`/care/orders/${order.id}`} aria-label={`Open order ${order.number}`}>{order.number}</Link></td>
                <td><span className="word">{order.status}</span></td>
                <td>{order.store_name}</td>
                <td className="break">{order.customer_email}</td>
                <td>{formatEuro(order.total_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list?.next_before ? <button type="button" className="btn" onClick={() => void more()}>Show more orders</button> : null}
    </main>
  );
}

interface Memory {
  focus: string | null;
  scroll: number;
  message: string;
}

export function CareOrder({ id }: { id: string }) {
  const me = useMe();
  const key = `care-order:${id}`;
  const saved = useMemo(() => loadScreen<Memory>(me.user.id, key), [me.user.id, key]);
  const memory = useRef<Memory>(saved ?? { focus: null, scroll: 0, message: "" });
  const [order, setOrder] = useState<Order | null>(null);
  const [events, setEvents] = useState<HistoryEntry[]>([]);
  const [missing, setMissing] = useState(false);
  const [message, setMessage] = useState(saved?.message ?? "");
  const [confirming, setConfirming] = useState(false);
  const down = useStorageDown();
  const root = useRef<HTMLElement | null>(null);
  const history = useRef<HTMLUListElement | null>(null);
  const cancelButton = useRef<HTMLButtonElement | null>(null);
  const restored = useRef(false);
  const scrolled = useRef(false);

  const remember = (patch: Partial<Memory>) => {
    memory.current = { ...memory.current, ...patch };
    saveScreen(me.user.id, key, memory.current);
  };
  const say = (text: string) => {
    setMessage(text);
    remember({ message: text });
  };

  useEffect(() => {
    api<Order>("GET", `/api/orders/${id}`).then(setOrder, (error: unknown) => {
      if (error instanceof ApiFailure && error.status === 404) setMissing(true);
    });
    api<{ events: HistoryEntry[] }>("GET", `/api/orders/${id}/events`).then((answer) => setEvents(answer.events), () => undefined);
  }, [id]);

  useEffect(() => {
    const record = () => remember({ scroll: history.current?.scrollTop ?? 0 });
    window.addEventListener("pagehide", record);
    return () => window.removeEventListener("pagehide", record);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (restored.current || !order || !root.current) return;
    restored.current = true;
    if (memory.current.focus) focusById(root.current, memory.current.focus);
  }, [order]);

  // the history list's scroll position is put back as soon as the list is long enough to hold it
  useLayoutEffect(() => {
    const list = history.current;
    if (scrolled.current || !list || memory.current.scroll <= 0) return;
    if (list.scrollHeight - list.clientHeight >= memory.current.scroll) {
      scrolled.current = true;
      list.scrollTop = memory.current.scroll;
    }
  });

  async function verify() {
    say("Checking history...");
    try {
      const replay = await api<{ last_seq: number }>("GET", `/api/orders/${id}/replay`);
      say(`History verified: ${replay.last_seq} entries.`);
    } catch (error) {
      say(error instanceof ApiFailure && error.code === "sequence_broken" ? `History is damaged from entry ${error.body.first_bad_seq}.` : ERROR_COPY);
    }
  }

  async function download() {
    if (!order) return;
    say("Preparing document...");
    try {
      await downloadDocument(order);
      say("");
    } catch {
      say(ERROR_COPY);
    }
  }

  async function cancel() {
    setConfirming(false);
    say("Saving...");
    try {
      const updated = await api<Order>("POST", `/api/orders/${id}/transitions`, { to: "cancelled" });
      setOrder(updated);
      say(`Order ${updated.number} is now ${updated.status}.`);
      api<{ events: HistoryEntry[] }>("GET", `/api/orders/${id}/events`).then((answer) => setEvents(answer.events), () => undefined);
    } catch (error) {
      say(error instanceof ApiFailure && error.code === "invalid_transition" ? `That step is not possible for order ${order?.number} now.` : ERROR_COPY);
    }
  }

  if (missing) return <NotFound />;
  const cancellable = order !== null && ["placed", "picking", "ready"].includes(order.status);
  return (
    <main className="care-order" ref={root} onFocusCapture={(event) => remember({ focus: focusIdOf(event) })}>
      <div className="care-facts">
        <h1>{order ? `Order ${order.number}` : ""}</h1>
        {order ? (
          <>
            <p><span className="word">{order.status}</span></p>
            <p>{`${order.store_name}, collect on ${order.slot_local_date} at ${order.slot_local_time}`}</p>
            <p>{order.customer.name} · <span className="break">{order.customer.email}</span></p>
            <p className="total-line">Total <Figure kind="order-total" value={order.total_cents} unit="euro" className="big" /></p>
            <div className="charcoal-panel scroll-x">
              <table aria-label="Order lines">
                <thead><tr><th scope="col">Item</th><th scope="col">Quantity</th><th scope="col">Line total</th><th scope="col">VAT</th><th scope="col">Returned</th></tr></thead>
                <tbody>
                  {order.lines.map((line) => (
                    <tr key={line.sku}>
                      <td>{line.sku} {line.name}</td><td>{line.quantity}</td><td>{formatEuro(line.line_total_cents)}</td>
                      <td>{formatEuro(line.vat_cents)}</td><td>{line.returned_quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
      <div className="care-history">
        <ul
          aria-label="Order history" className="history" ref={history} tabIndex={-1}
          onScroll={(event) => remember({ scroll: event.currentTarget.scrollTop })}
        >
          {events.map((entry) => <li key={entry.seq}>{`#${entry.seq} ${entry.type} ${lisbonStamp(entry.at)}`}</li>)}
        </ul>
        <div className="dialog-actions">
          <button type="button" className="btn" data-focus-id="verify" onClick={() => void verify()}>Verify history</button>
          <PausedButton className="btn" data-focus-id="download" paused={down} pauseCopy={PAUSE_COPY.document} onPaused={say} onPress={() => void download()}>
            Download order document
          </PausedButton>
          {cancellable ? (
            <button ref={cancelButton} type="button" className="btn" data-focus-id="cancel" onClick={() => setConfirming(true)}>Cancel order</button>
          ) : null}
        </div>
        <Status label="Care updates" text={message} />
      </div>
      <Overlay open={confirming} role="alertdialog" label="Cancel order" onClose={() => setConfirming(false)} opener={cancelButton} className="dialog" initialFocus="[data-first]">
        <h2>Cancel order</h2>
        <p>{order ? `Cancel order ${order.number}? Its place in the collection slot is freed.` : ""}</p>
        <div className="dialog-actions">
          <button type="button" className="btn" data-first="" onClick={() => setConfirming(false)}>Keep order</button>
          <button type="button" className="btn" onClick={() => void cancel()}>Cancel order</button>
        </div>
      </Overlay>
    </main>
  );
}
