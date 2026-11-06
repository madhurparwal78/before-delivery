import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { dollars } from "../../shared/money";
import type { Order } from "../../shared/types";
import { EmptyDrawing } from "../components/Drawings";
import { Totals } from "../components/Totals";
import { request } from "../lib/api";
import { Link } from "../lib/router";
import { useSession } from "../lib/session";

const SAVE_DELAY_MS = 400;

export function Cart() {
  const { user, ready, refreshCart } = useSession();
  const [order, setOrder] = useState<Order | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    document.title = "Cart · Lightfall";
    if (!user) return;
    void request<{ order: Order }>("/api/cart").then((reply) => reply.ok && setOrder(reply.data.order));
  }, [user]);

  const save = async (code: string, quantity: number) => {
    const reply = await request<{ order: Order }>(`/api/cart/lines/${encodeURIComponent(code)}`, {
      method: "PATCH",
      body: { quantity },
    });
    if (reply.ok) {
      setOrder(reply.data.order);
      setDrafts(({ [code]: _, ...rest }) => rest);
      setStatus("");
      refreshCart();
    } else if (reply.error.error === "insufficient_stock") {
      setStatus(`Only ${reply.error.available ?? 0} left.`);
    }
  };

  const edit = (code: string, value: string) => {
    setDrafts((current) => ({ ...current, [code]: value }));
    clearTimeout(timers.current.get(code));
    const quantity = Number.parseInt(value, 10);
    if (!(quantity >= 1 && quantity <= 999)) return;
    timers.current.set(code, setTimeout(() => void save(code, quantity), SAVE_DELAY_MS));
  };

  if (ready && !user) {
    return (
      <div className="cart">
        <header className="page-head">
          <h1>Cart</h1>
        </header>
        <div className="empty-state">
          <EmptyDrawing />
          <p>Sign in to see your cart.</p>
          <Link href="/signin?next=/cart" className="button button--primary">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="cart">
      <header className="page-head">
        <p className="eyebrow">Your order</p>
        <h1>Cart</h1>
      </header>
      {order && order.lines.length === 0 && (
        <div className="empty-state">
          <EmptyDrawing />
          <p>Your cart is empty.</p>
          <Link href="/catalogue" className="button button--primary">
            Browse the catalogue
          </Link>
        </div>
      )}
      {order && order.lines.length > 0 && (
        <div className="cart__layout">
          <table aria-label="Cart" className="data-table cart__table">
            <thead>
              <tr>
                <th scope="col">Fitting</th>
                <th scope="col" className="numeric">Unit price</th>
                <th scope="col">Quantity</th>
                <th scope="col" className="numeric">Line total</th>
                <th scope="col"><span className="visually-hidden">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.variant_code}>
                  <td>
                    <span className="cart__name">{line.product_name}</span>
                    <span className="cart__code mono">{line.variant_code}</span>
                  </td>
                  <td className="numeric mono">{dollars(line.unit_price_cents)}</td>
                  <td>
                    <input
                      type="number"
                      className="quantity-input"
                      min={1}
                      max={999}
                      aria-label={`Quantity for ${line.variant_code}`}
                      value={drafts[line.variant_code] ?? String(line.quantity)}
                      onChange={(event) => edit(line.variant_code, event.target.value)}
                    />
                  </td>
                  <td className="numeric mono">{dollars(line.line_total_cents)}</td>
                  <td>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove ${line.variant_code}`}
                      onClick={() => void save(line.variant_code, 0)}
                    >
                      <X aria-hidden="true" size={18} strokeWidth={1.5} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <aside className="cart__summary">
            <p className="cart__tier">{order.price_tier === "trade" ? "Trade prices" : "Prices shown without GST"}</p>
            <Totals order={order} />
            <Link href="/checkout" className="button button--primary button--block">
              Checkout
            </Link>
          </aside>
        </div>
      )}
      <p role="status" className="page-notice">
        {status}
      </p>
    </div>
  );
}
