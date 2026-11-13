import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { store, useStore, type Cart } from '../lib/store.js';
import { announce } from '../app.js';
import { showToast } from './toast.js';
import { rupees, CONFIG } from '../lib/format.js';
import { navigate } from '../lib/router.js';
import { api, ApiFailure } from '../lib/api.js';

type Removal = { id: number; sku: string; quantity: number } | null;

/** Bag lines, quantities, code entry and totals, updating in place. */
export function BagLines(props: { inDrawer?: boolean }): JSX.Element {
  useStore();
  const cart = store.cart;
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  const [removal, setRemoval] = useState<Removal>(null);
  const [undoTimer, setUndoTimer] = useState<number | null>(null);

  useEffect(() => {
    if (removal === null) return;
    if (undoTimer !== null) clearTimeout(undoTimer);
    setUndoTimer(window.setTimeout(() => setRemoval(null), CONFIG.cart_undo_seconds * 1000));
  }, [removal]);

  const undo = async (): Promise<void> => {
    if (removal === null) return;
    if (undoTimer !== null) clearTimeout(undoTimer);
    setUndoTimer(null);
    const target = removal;
    setRemoval(null);
    try {
      const updated = await api.post<Cart>('/api/cart/lines', { sku: target.sku, quantity: target.quantity });
      store.cart = updated;
      store.emit();
      announce('cart-updates', `Restored ${updated.lines.find((l) => l.sku === target.sku)?.product ?? ''}.`);
    } catch (err) {
      if (err instanceof ApiFailure) announce('cart-updates', err.body.message);
    }
  };

  if (cart === null) {
    return <p class="muted">Your bag is empty.</p>;
  }
  // The undo row stays visible for its published time even on an empty bag.
  if (cart.lines.length === 0 && removal === null) {
    return (
      <div>
        <p class="muted">Your bag is empty.</p>
        <p><a href="/collections/all" onClick={(e) => { e.preventDefault(); navigate('/collections/all'); }}>Browse collections</a></p>
      </div>
    );
  }

  const changeQuantity = async (id: number, quantity: number): Promise<void> => {
    try {
      const updated = await api.patch<Cart>(`/api/cart/lines/${id}`, { quantity });
      store.cart = updated;
      store.emit();
      announce('cart-updates', `Quantity updated to ${quantity}.`);
    } catch (err) {
      if (err instanceof ApiFailure) announce('cart-updates', err.body.message);
    }
  };

  const removeLine = async (id: number): Promise<void> => {
    const line = cart.lines.find((l) => l.id === id);
    setRemoving(id);
    try {
      const updated = await api.delete<Cart>(`/api/cart/lines/${id}`);
      store.cart = updated;
      store.emit();
      if (line !== undefined) {
        announce('cart-updates', `Removed ${line.product}. Undo available for ${CONFIG.cart_undo_seconds} seconds.`);
        showToast(`Removed ${line.product}. Undo available for ${CONFIG.cart_undo_seconds} seconds.`, () => { void undo(); });
        setRemoval({ id: line.id, sku: line.sku, quantity: line.quantity });
      }
    } catch (err) {
      if (err instanceof ApiFailure) announce('cart-updates', err.body.message);
    } finally {
      setRemoving(null);
    }
  };

  const applyCode = async (): Promise<void> => {
    const value = code.trim();
    if (value === '') {
      setCodeError('Enter a code.');
      return;
    }
    setBusy(true);
    try {
      const updated = await api.post<Cart>('/api/cart/codes', { code: value });
      store.cart = updated;
      store.emit();
      setCode('');
      setCodeError(null);
      if (value.toUpperCase().startsWith('RHGC-')) {
        const gc = updated.gift_card;
        announce('cart-updates', `Gift card ending ${gc?.last4} applied. Balance ${rupees(gc?.balance ?? 0)}.`);
      } else {
        announce('cart-updates', `Code ${value.toUpperCase()} applied.`);
      }
    } catch (err) {
      if (err instanceof ApiFailure) {
        setCodeError(err.body.message);
        announce('cart-updates', err.body.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const removeDiscount = async (): Promise<void> => {
    const updated = await api.delete<Cart>('/api/cart/discount');
    store.cart = updated;
    store.emit();
  };

  const removeGiftCard = async (): Promise<void> => {
    const updated = await api.delete<Cart>('/api/cart/gift-card');
    store.cart = updated;
    store.emit();
  };

  return (
    <div class="bag-body">
      <ul class="bag-lines">
        {cart.lines.map((line) => (
          <li key={line.id}>
            <div class="line-group" role="group" aria-label={`${line.product} — ${line.colour}, ${line.size}`}>
              <div class="line-main">
                <p class="line-title">{line.product} — {line.colour}, {line.size}</p>
                <p class="muted">{line.sku} · {rupees(line.unit_price)}</p>
                {line.badge === 'Out of stock' ? <p class="badge out">{line.badge}</p> : null}
              </div>
              <label class="quantity-label">
                <span>Quantity</span>
                <input
                  type="number"
                  role="spinbutton"
                  aria-label="Quantity"
                  min={1}
                  max={10}
                  value={line.quantity}
                  disabled={removing === line.id}
                  onChange={(e) => { void changeQuantity(line.id, Number((e.target as HTMLInputElement).value)); }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                      const delta = e.key === 'ArrowUp' ? 1 : -1;
                      const next = Math.min(10, Math.max(1, line.quantity + delta));
                      void changeQuantity(line.id, next);
                      e.preventDefault();
                    }
                  }}
                />
              </label>
              <p class="line-total">{rupees(line.line_subtotal)}</p>
              <button class="remove-button" aria-label={`Remove ${line.product}`} onClick={() => { void removeLine(line.id); }} disabled={removing === line.id}>
                {removing === line.id ? 'Removing' : 'Remove'}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {removal !== null ? (
        <p class="undo-row">
          <span>Removed.</span>
          <button class="undo-button" onClick={() => { void undo(); }}>Undo</button>
        </p>
      ) : null}

      <div class="code-row">
        <label>
          <span>Discount or gift card code</span>
          <input
            type="text"
            value={code}
            aria-label="Discount or gift card code"
            aria-describedby={codeError !== null ? 'code-error' : undefined}
            onInput={(e) => setCode((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void applyCode(); } }}
          />
        </label>
        <button class="secondary" onClick={() => { void applyCode(); }} disabled={busy}>{busy ? 'Applying' : 'Apply'}</button>
        {codeError !== null ? <p id="code-error" class="field-error">{codeError}</p> : null}
        {cart.discount !== null ? (
          <p class="applied-code">
            {cart.discount.code}
            <button aria-label={`Remove code ${cart.discount.code}`} onClick={() => { void removeDiscount(); }}>Remove</button>
          </p>
        ) : null}
        {cart.gift_card !== null ? (
          <p class="applied-code">
            Gift card ending {cart.gift_card.last4}
            <button aria-label="Remove gift card" onClick={() => { void removeGiftCard(); }}>Remove</button>
          </p>
        ) : null}
      </div>

      {props.inDrawer ? <Totals /> : null}

      {!props.inDrawer ? (
        <p class="bag-actions">
          <a class="primary button-link" href="/checkout" onClick={async (e) => {
            e.preventDefault();
            if (store.user === null) {
              // Signed-out shoppers go to /sign-in first, then return.
              navigate('/sign-in?next=/bag');
              return;
            }
            try {
              const checkout = await api.post<{ id: number }>('/api/checkout');
              navigate(`/checkout/${checkout.id}`);
            } catch {
              navigate('/sign-in?next=/bag');
            }
          }}>Check out</a>
        </p>
      ) : null}
    </div>
  );
}

export function Totals(): JSX.Element {
  useStore();
  const cart = store.cart;
  if (cart === null) return <></>;
  return (
    <div class="bag-totals" role="region" aria-label="Bag totals" data-motion-ms={document.documentElement.dataset.motion === 'reduced' ? '0' : '180'} data-state="idle">
      <dl>
        <div><dt>Subtotal</dt><dd>{rupees(cart.totals.subtotal)}</dd></div>
        <div><dt>Discount</dt><dd>{cart.totals.discount > 0 ? `-${rupees(cart.totals.discount)}` : rupees(0)}</dd></div>
        <div><dt>Shipping</dt><dd>{cart.totals.shipping === 0 ? 'Free' : rupees(cart.totals.shipping)}</dd></div>
        <div><dt>Tax</dt><dd>{rupees(cart.totals.tax)}</dd></div>
        {cart.gift_card !== null ? <div><dt>Gift card</dt><dd>{cart.totals.gift_card > 0 ? `-${rupees(cart.totals.gift_card)}` : rupees(0)}</dd></div> : null}
        <div class="grand"><dt>Total</dt><dd>{rupees(cart.totals.total)}</dd></div>
      </dl>
      {cart.gift_card !== null ? (
        <p class="gift-remainder">Gift card balance after this order: {rupees(cart.gift_card.balance - cart.totals.gift_card)}</p>
      ) : null}
    </div>
  );
}
