import { useEffect, useRef, useState } from "react";
import { Status } from "../controls";
import { api } from "../lib/api";
import { Figure } from "../lib/figure";
import { formatEuro } from "../lib/format";
import { navigate, useLocation } from "../lib/router";
import { useCart } from "../cartState";
import type { Cart } from "../types";
import { Checkout } from "./checkout";

export function CartScreen() {
  const { search } = useLocation();
  const checkoutOpen = new URLSearchParams(search).get("checkout") === "open";
  const [updates, setUpdates] = useState("");
  const [typed, setTyped] = useState<Record<string, string>>({});
  const cartState = useCart(setUpdates);
  const { cart, latest, change } = cartState;
  const opener = useRef<HTMLButtonElement | null>(null);
  const restored = useRef(checkoutOpen);

  useEffect(() => {
    cartState.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!cart) return;
    setTyped(Object.fromEntries(cart.lines.map((line) => [line.sku, String(line.quantity)])));
    if (cart.lines.length === 0) setUpdates((current) => current || "Your cart is empty.");
  }, [cart]);

  async function commitQuantity(sku: string) {
    const server = latest.current?.lines.find((line) => line.sku === sku)?.quantity;
    const text = (typed[sku] ?? "").trim();
    if (String(server) === text) return;
    const quantity = /^\d+$/.test(text) ? Number(text) : -1;
    const applied = await change(() => api<Cart>("PUT", `/api/cart/lines/${sku}`, { quantity }));
    if (!applied) setTyped((current) => ({ ...current, [sku]: String(latest.current?.lines.find((line) => line.sku === sku)?.quantity ?? "") }));
  }

  const lines = cart?.lines ?? [];
  return (
    <main className="storefront cart-page">
      <h1>Cart</h1>
      <div className="cart-layout">
        {lines.length > 0 ? (
          <div className="charcoal-panel scroll-x cart-table">
            <table aria-label="Cart lines">
              <thead>
                <tr><th scope="col">Item</th><th scope="col">Quantity</th><th scope="col">Line total</th><th scope="col">Remove</th></tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.sku}>
                    <td>
                      <strong>{line.name}</strong>
                      <span className="sku"> {line.sku}</span>
                      {line.status === "short" ? <p className="short">{`Only ${line.available ?? 0} left at ${cart?.store_name}.`}</p> : null}
                    </td>
                    <td>
                      <input
                        className="field stepper" type="number" min={0} max={999} aria-label={`Quantity of ${line.sku}`} value={typed[line.sku] ?? ""}
                        onChange={(event) => setTyped((current) => ({ ...current, [line.sku]: event.target.value }))}
                        onBlur={() => void commitQuantity(line.sku)}
                        onKeyDown={(event) => { if (event.key === "Enter") void commitQuantity(line.sku); }}
                      />
                    </td>
                    <td>{formatEuro(line.line_total_cents)}</td>
                    <td>
                      <button type="button" className="btn" aria-label={`Remove ${line.sku}`} onClick={() => void change(() => api<Cart>("PUT", `/api/cart/lines/${line.sku}`, { quantity: 0 }))}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {lines.length > 0 ? (
          <aside className="totals charcoal-panel">
            <p className="total-line">Cart total {cart ? <Figure kind="cart-total" value={cart.total_cents} unit="euro" className="big" /> : null}</p>
            {cart?.vat_cents !== null && cart?.vat_cents !== undefined ? <p>Includes VAT {formatEuro(cart.vat_cents)}</p> : null}
            <button ref={opener} type="button" className="btn" onClick={() => navigate("/cart?checkout=open", { replace: true })}>Checkout</button>
          </aside>
        ) : null}
      </div>
      <Status label="Cart updates" text={updates} className={lines.length === 0 && cart ? "blunt-line" : "status-line"} />
      <Checkout
        open={checkoutOpen} restored={restored.current} opener={opener} cartState={cartState} onClose={() => navigate("/cart", { replace: true })}
      />
    </main>
  );
}
