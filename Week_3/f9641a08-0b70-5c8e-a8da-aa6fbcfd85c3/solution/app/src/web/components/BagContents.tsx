import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Cart, CartLine, Checkout } from "../../shared/api";
import { inr } from "../../shared/format";
import { ApiFail, api } from "../lib/api";
import { Link, navigate } from "../lib/router";
import { announce, applyCart, refreshCart, useApp } from "../lib/store";
import { TotalsRegion } from "./TotalsRegion";
import "../styles/shop.css";

/** Announces what a bag change said: the clamp or removal notices win over the routine message. */
function announceCart(cart: Cart, routine: string): void {
  const notice = cart.notices[cart.notices.length - 1];
  announce(notice ?? routine);
}

export function variantName(line: { product: string; colour: string; size: string }): string {
  return `${line.product} — ${line.colour}, ${line.size}`;
}

function QuantityInput({ line }: { line: CartLine }) {
  const [text, setText] = useState(String(line.quantity));
  const [error, setError] = useState<string | null>(null);
  const newest = useRef(0);
  useEffect(() => setText(String(line.quantity)), [line.quantity]);

  const commit = async (value: string) => {
    setText(value);
    const quantity = Number(value);
    if (value === "" || !Number.isInteger(quantity) || quantity === line.quantity) return;
    newest.current += 1;
    const mine = newest.current;
    try {
      const cart = await api.patch<Cart>(`/api/cart/lines/${line.id}`, { quantity });
      if (mine !== newest.current) return;
      applyCart(cart);
      setError(null);
      const updated = cart.lines.find((l) => l.id === line.id);
      announceCart(cart, `Quantity updated to ${updated?.quantity ?? quantity}.`);
    } catch (failure) {
      if (mine !== newest.current || !(failure instanceof ApiFail)) return;
      setError(failure.fields.quantity ?? failure.message);
    }
  };

  const errorId = `qty-error-${line.id}`;
  return (
    <div className="qty">
      <label className="sr-only" htmlFor={`qty-${line.id}`}>
        Quantity
      </label>
      <input
        id={`qty-${line.id}`}
        type="number"
        min={1}
        max={10}
        inputMode="numeric"
        value={text}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        onChange={(event) => void commit(event.target.value)}
      />
      {error && (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

export function BagLines({ cart }: { cart: Cart }) {
  const { config } = useApp();
  const remove = async (line: CartLine) => {
    const updated = await api.delete<Cart>(`/api/cart/lines/${line.id}`);
    applyCart(updated);
    announce(`Removed ${line.product}. Undo available for ${config?.cart_undo_seconds ?? 0} seconds.`, {
      sku: line.sku,
      quantity: line.quantity,
      product: line.product,
    });
  };

  return (
    <ul className="bag-lines">
      {cart.lines.map((line) => (
        <li key={line.id}>
          <div role="group" aria-label={variantName(line)} className="bag-line">
            <div className="bag-line-info">
              <p className="bag-line-name">{line.product}</p>
              <p className="muted">
                {line.colour}, {line.size} · SKU {line.sku}
              </p>
              {line.badge !== "In stock" && <span className={`block ${line.badge === "Out of stock" ? "tone-red" : "tone-yellow"}`}>{line.badge}</span>}
            </div>
            <QuantityInput line={line} />
            <div className="bag-line-price">
              <p>{inr(line.line_subtotal)}</p>
              {line.line_discount > 0 && <p className="muted">-{inr(line.line_discount)}</p>}
            </div>
            <button type="button" className="btn" onClick={() => void remove(line)}>
              Remove {line.product}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function CodeForm({ cart }: { cart: Cart }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const apply = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      const updated = await api.post<Cart>("/api/cart/codes", { code });
      applyCart(updated);
      setError(null);
      setCode("");
      if (/^\s*RHGC-/i.test(code) && updated.gift_card) {
        announce(`Gift card ending ${updated.gift_card.last4} applied. Balance ${inr(updated.gift_card.balance)}.`);
      } else if (updated.discount) {
        announce(`Code ${updated.discount.code} applied.`);
      }
    } catch (failure) {
      if (failure instanceof ApiFail) setError(failure.fields.code ?? failure.message);
    } finally {
      setPending(false);
      input.current?.focus();
    }
  };

  const drop = async (path: string) => {
    applyCart(await api.delete<Cart>(path));
  };

  return (
    <div className="code-box">
      <form onSubmit={(event) => void apply(event)} className="code-form" noValidate>
        <div className="field">
          <label htmlFor="bag-code">Discount or gift card code</label>
          <div className="code-row">
            <input
              ref={input}
              id="bag-code"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={code}
              aria-describedby={error ? "bag-code-error" : undefined}
              aria-invalid={error ? true : undefined}
              onChange={(event) => setCode(event.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Applying" : "Apply"}
            </button>
          </div>
          {error && (
            <p className="field-error" id="bag-code-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </form>
      <div className="applied">
        {cart.discount && (
          <button type="button" className="btn" onClick={() => void drop("/api/cart/discount")}>
            Remove code {cart.discount.code}
          </button>
        )}
        {cart.gift_card && (
          <button type="button" className="btn" onClick={() => void drop("/api/cart/gift-card")}>
            Remove gift card
          </button>
        )}
      </div>
    </div>
  );
}

export function BagSummary({ cart, onNavigate }: { cart: Cart; onNavigate?: () => void }) {
  const { me } = useApp();

  const checkOut = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (!me) {
      onNavigate?.();
      navigate("/sign-in?next=/bag");
      return;
    }
    const checkout = await api.post<Checkout>("/api/checkout");
    onNavigate?.();
    navigate(`/checkout/${checkout.id}`);
  };

  return (
    <div className="bag-summary">
      <TotalsRegion totals={cart.totals} giftCard={cart.gift_card} />
      <CodeForm cart={cart} />
      <a href="/bag" className="btn btn-primary" onClick={(event) => void checkOut(event)}>
        Check out
      </a>
    </div>
  );
}

export function EmptyBag({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="bag-empty">
      <p>Your bag is empty.</p>
      <Link href="/collections/all" className="btn btn-primary" onClick={onNavigate}>
        Browse collections
      </Link>
    </div>
  );
}

/** The drawer body: lines, then the summary. Mounts only while the drawer is open. */
export function BagContents({ onNavigate }: { onNavigate: () => void }) {
  const { cart } = useApp();
  useEffect(() => {
    void refreshCart().then((fresh) => {
      const notice = fresh.notices[fresh.notices.length - 1];
      if (notice) announce(notice);
    });
  }, []);
  if (!cart || cart.lines.length === 0) return <EmptyBag onNavigate={onNavigate} />;
  return (
    <div className="bag-drawer">
      <BagLines cart={cart} />
      <BagSummary cart={cart} onNavigate={onNavigate} />
    </div>
  );
}
