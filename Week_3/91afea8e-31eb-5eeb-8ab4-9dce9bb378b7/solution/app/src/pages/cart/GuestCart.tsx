import { Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { rupees } from "../../../shared/format";
import { Button } from "../../components/Button";
import { Empty } from "../../components/Empty";
import { Reel } from "../../components/Reel";
import { signInHref } from "../../lib/auth";
import { useCart } from "../../lib/cart";
import type { GuestLine } from "../../lib/types";
import { BillLine } from "./BillLine";
import { toneOf } from "./groups";

const MAX_QUANTITY = 10;

function GuestQuantity({ line, onChange }: { line: GuestLine; onChange: (quantity: number) => void }): ReactNode {
  const [draft, setDraft] = useState(String(line.quantity));
  const commit = (): void => {
    const quantity = Math.min(MAX_QUANTITY, Math.max(1, Math.trunc(Number(draft)) || line.quantity));
    setDraft(String(quantity));
    if (quantity !== line.quantity) onChange(quantity);
  };
  return (
    <div className="line__field">
      <label htmlFor={`guest-qty-${line.listing_id}`}>qty</label>
      <input
        id={`guest-qty-${line.listing_id}`}
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_QUANTITY}
        aria-label={`Quantity for ${line.title}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => event.key === "Enter" && commit()}
      />
    </div>
  );
}

/** A signed-out shopper's cart: the lines kept in the browser at their public prices; checking out leads to sign-in. */
export function GuestCart(): ReactNode {
  const { guest, setGuest } = useCart();

  if (guest.length === 0) {
    return (
      <Empty tone="pink" sign="basket" as="h1" actions={<Link className="btn" to="/">back to the bazaar</Link>}>
        your cart is empty. the bazaar isn't.
      </Empty>
    );
  }

  const sellers = [...new Set(guest.map((line) => line.seller_name))];
  const subtotal = guest.reduce((sum, line) => sum + line.price_paise * line.quantity, 0);
  const update = (listingId: string, quantity: number): void => setGuest(guest.map((line) => (line.listing_id === listingId ? { ...line, quantity } : line)));

  return (
    <div className="cart-page">
      <section className="panel panel--ground cart-head">
        <h1>your cart.</h1>
        <p className="muted">Sign in at checkout. Your cart comes with you.</p>
      </section>
      <div className="cart-grid">
        <div className="cart-main">
          {sellers.map((seller, index) => {
            const tone = toneOf(index);
            return (
              <section key={seller} aria-label={`${seller} parcel`} className={`panel panel--${tone} parcel parcel--${index % 4}`}>
                <h2 className="parcel__seller">{seller}</h2>
                <ul className="parcel__lines">
                  {guest
                    .filter((line) => line.seller_name === seller)
                    .map((line) => (
                      <li key={line.listing_id} className={`card line line--guest ${tone === "black" ? "" : "card--black"}`}>
                        <img className="line__art" src={line.image_url} alt={line.title} width={96} height={96} />
                        <div className="line__main">
                          <h3 className="line__title">
                            <Link to={`/p/${line.product_id}`}>{line.title}</Link>
                          </h3>
                          <p className="line__price">
                            <span className="amount">{rupees(line.price_paise)}</span> each
                          </p>
                        </div>
                        <div className="line__controls">
                          <GuestQuantity line={line} onChange={(quantity) => update(line.listing_id, quantity)} />
                        </div>
                        <BillLine label="line total" paise={line.price_paise * line.quantity} strong />
                        <div className="line__actions">
                          <Button small aria-label={`Remove ${line.title}`} onClick={() => setGuest(guest.filter((entry) => entry.listing_id !== line.listing_id))}>
                            <Trash2 size={18} aria-hidden="true" />
                            remove
                          </Button>
                        </div>
                      </li>
                    ))}
                </ul>
              </section>
            );
          })}
        </div>
        <aside className="cart-aside panel panel--ground">
          <div className="cart-strip">
            <Reel paise={subtotal} label="Subtotal" className="cart-strip__total" />
            <Link to={signInHref("/checkout/address")} className="btn btn--primary cart-strip__go">
              Checkout
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
