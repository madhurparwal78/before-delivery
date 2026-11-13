import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { rupees } from "../../shared/format";
import { Button } from "../components/Button";
import { Empty } from "../components/Empty";
import { failureMessage, get } from "../lib/api";
import { useTitle } from "../lib/hooks";
import { ShopperOnly } from "./orders/Gate";
import { dayOf } from "./orders/format";
import "../styles/orders.css";

interface OrderRow {
  order_id: string;
  placed_at: string;
  payable_paise: number;
  shipment_count: number;
  shipment_states: string[];
}

interface Page {
  orders: OrderRow[];
  next_cursor: string | null;
}

const TONES = ["pink", "yellow", "black", "raised"] as const;

function History(): ReactNode {
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstNew = useRef<number | null>(null);
  const list = useRef<HTMLUListElement>(null);
  useTitle("your orders");

  useEffect(() => {
    get<Page>("/api/orders").then(
      (page) => {
        setRows(page.orders);
        setCursor(page.next_cursor);
      },
      (failure: unknown) => setProblem(failureMessage(failure)),
    );
  }, []);

  useEffect(() => {
    if (firstNew.current === null) return;
    list.current?.querySelectorAll<HTMLElement>("article a")[firstNew.current]?.focus();
    firstNew.current = null;
  }, [rows]);

  const more = async (): Promise<void> => {
    if (!cursor || !rows) return;
    setBusy(true);
    setProblem(null);
    try {
      const page = await get<Page>(`/api/orders?cursor=${encodeURIComponent(cursor)}`);
      firstNew.current = rows.length;
      setRows([...rows, ...page.orders]);
      setCursor(page.next_cursor);
    } catch (failure) {
      setProblem(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  if (rows && rows.length === 0) {
    return (
      <Empty tone="black" sign="box" as="h1" actions={<Link className="btn btn--yellow" to="/">back to the bazaar</Link>}>
        no orders yet. the shelves are waiting.
      </Empty>
    );
  }

  return (
    <div className="ord">
      <section className="panel panel--ground ord__head">
        <h1>your orders.</h1>
      </section>
      {rows === null && !problem && (
        <section className="panel panel--ground" aria-busy="true">
          <div className="skeleton" style={{ minHeight: 200 }} />
        </section>
      )}
      {rows && (
        <ul role="list" aria-label="Orders" className="ord__list">
          {rows.map((order, index) => {
            const tone = TONES[index % TONES.length];
            return (
              <li key={order.order_id}>
                <article aria-label={`Order ${order.order_id}`} className={`panel panel--${tone} ord__row ord__row--${index % 4}`}>
                  <h2 className="ord__id">
                    <Link to={`/orders/${order.order_id}`}>{order.order_id}</Link>
                  </h2>
                  <p className="bill">
                    {dayOf(order.placed_at)}, <span className="amount">{rupees(order.payable_paise)}</span>
                  </p>
                  <p className="ord__states">
                    {order.shipment_count === 1 ? "1 shipment" : `${order.shipment_count} shipments`}
                    {order.shipment_states.map((state, at) => (
                      <span key={`${state}-${at}`} className="chip">
                        {state}
                      </span>
                    ))}
                  </p>
                </article>
              </li>
            );
          })}
        </ul>
      )}
      <section className="panel panel--ground ord__more">
        {problem && <p className="field-error">{problem}</p>}
        {cursor && (
          <Button variant="primary" busy={busy} onClick={() => void more()}>
            Load more
          </Button>
        )}
      </section>
    </div>
  );
}

export default function Orders(): ReactNode {
  return (
    <ShopperOnly>
      <History />
    </ShopperOnly>
  );
}
