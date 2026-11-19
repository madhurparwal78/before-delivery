import type { ReactNode } from 'react';
import type { Cart as CartData } from '../../shared/api';
import { formatMoney } from '../../shared/money';
import { formatCountdown } from '../lib/countdown';

interface CartProps {
  readonly cart: CartData | null;
  readonly secondsLeft: number | null;
  readonly onRelease: (seatId: string) => void;
  readonly onCheckout: () => void;
}

export function Cart({ cart, secondsLeft, onRelease, onCheckout }: CartProps): ReactNode {
  const held = cart !== null && cart.seats.length > 0;
  return (
    <section className="cart" aria-label="Cart">
      <h2 tabIndex={-1} data-focus-fallback="true">
        Cart
      </h2>
      {held && cart !== null ? (
        <>
          <ul className="cart-lines">
            {cart.seats.map((line) => (
              <li key={line.seatId}>
                <span className="cart-seat">{line.label}</span>
                <span className="cart-tier">{line.tierName}</span>
                <span className="figures">{formatMoney(line.faceCents)}</span>
                <span className="figures">{formatMoney(line.seatFeeCents)}</span>
                <button type="button" aria-label={`Release ${line.label}`} onClick={() => onRelease(line.seatId)}>
                  Release
                </button>
              </li>
            ))}
          </ul>
          <dl className="ledger">
            <div>
              <dt>Face value</dt>
              <dd className="figures">{formatMoney(cart.faceCents)}</dd>
            </div>
            <div>
              <dt>Seat fees</dt>
              <dd className="figures">{formatMoney(cart.seatFeesCents)}</dd>
            </div>
            <div>
              <dt>Order fee</dt>
              <dd className="figures">{formatMoney(cart.orderFeeCents)}</dd>
            </div>
            <div className="ledger-total">
              <dt>Total</dt>
              <dd className="figures">{formatMoney(cart.totalCents)}</dd>
            </div>
          </dl>
          <p className="countdown figures" role="timer" aria-label="Hold time left">
            {formatCountdown(secondsLeft ?? cart.secondsLeft ?? 0)}
          </p>
          <button type="button" className="primary" onClick={onCheckout}>
            Checkout
          </button>
        </>
      ) : (
        <p>No seats held.</p>
      )}
    </section>
  );
}
