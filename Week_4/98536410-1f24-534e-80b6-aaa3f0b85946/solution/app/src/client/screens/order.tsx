import { useEffect, useRef, useState } from "react";
import { PausedButton, Status } from "../controls";
import { ApiFailure, api, apiBlob } from "../lib/api";
import { Figure } from "../lib/figure";
import { formatMilli } from "../lib/format";
import { useMe } from "../session";
import { PAUSE_COPY, useStorageDown } from "../storage";
import type { Order } from "../types";
import { NotFound } from "./notfound";

const ERROR_COPY = "Something went wrong. Try again.";

export function orderMessageKey(id: string): string {
  return `tramela:order-message:${id}`;
}

export function placedCopy(order: Order): string {
  return `Order ${order.number} placed. Collect at ${order.store_name} on ${order.slot_local_date} at ${order.slot_local_time}.`;
}

/** Saves a browser download of the stored order document; used on the order page and the care order page. */
export async function downloadDocument(order: Order): Promise<void> {
  const blob = await apiBlob(`/api/orders/${order.id}/document`);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${order.number}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

export function OrderPage({ id }: { id: string }) {
  useMe();
  const [order, setOrder] = useState<Order | null>(null);
  const [missing, setMissing] = useState(false);
  const [message, setMessage] = useState(sessionStorage.getItem(orderMessageKey(id)) ?? "");
  const heading = useRef<HTMLHeadingElement | null>(null);
  const down = useStorageDown();

  useEffect(() => {
    api<Order>("GET", `/api/orders/${id}`).then(setOrder, (error: unknown) => {
      if (error instanceof ApiFailure && error.status === 404) setMissing(true);
    });
  }, [id]);

  useEffect(() => {
    if (order) heading.current?.focus();
  }, [order]);

  async function download() {
    if (!order) return;
    setMessage("Preparing document...");
    try {
      await downloadDocument(order);
      setMessage("");
    } catch {
      setMessage(ERROR_COPY);
    }
  }

  if (missing) return <NotFound />;
  return (
    <main className="order-page">
      <h1 ref={heading} tabIndex={-1}>{order ? `Order ${order.number}` : ""}</h1>
      {order ? (
        <>
          <p><span className="word">{order.status}</span></p>
          <p>Collect at {order.store_name} on {order.slot_local_date} at {order.slot_local_time}.</p>
          <div className="charcoal-panel scroll-x">
            <table aria-label="Order lines">
              <thead><tr><th scope="col">Item</th><th scope="col">Quantity</th><th scope="col">Unit price</th></tr></thead>
              <tbody>
                {order.lines.map((line) => (
                  <tr key={line.sku}><td>{line.name}</td><td>{line.quantity}</td><td>{formatMilli(line.unit_price_milli)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="total-line">Total <Figure kind="order-total" value={order.total_cents} unit="euro" className="big" /></p>
          <PausedButton className="btn" paused={down} pauseCopy={PAUSE_COPY.document} onPaused={setMessage} onPress={() => void download()}>
            Download order document
          </PausedButton>
        </>
      ) : null}
      <Status label="Order messages" text={message} />
    </main>
  );
}
