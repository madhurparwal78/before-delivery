import { useRef, useState, type ReactNode } from 'react';
import type { Cart as CartData, Order } from '../../shared/api';
import { COPY, receiptLine } from '../../shared/copy';
import { formatMoney } from '../../shared/money';
import { Dialog } from './Dialog';
import { formatCountdown } from '../lib/countdown';

interface CheckoutDialogProps {
  readonly cart: CartData | null;
  readonly secondsLeft: number | null;
  readonly confirmation: Order | null;
  readonly paymentNotice: string;
  readonly fieldErrors: Record<string, string>;
  readonly pending: boolean;
  readonly onPay: (name: string, email: string) => void;
  readonly onClose: () => void;
  readonly onViewTickets: () => void;
}

function Ledger({
  faceCents,
  seatFeesCents,
  orderFeeCents,
  totalCents,
}: {
  readonly faceCents: number;
  readonly seatFeesCents: number;
  readonly orderFeeCents: number;
  readonly totalCents: number;
}): ReactNode {
  return (
    <dl className="ledger">
      <div>
        <dt>Face value</dt>
        <dd className="figures">{formatMoney(faceCents)}</dd>
      </div>
      <div>
        <dt>Seat fees</dt>
        <dd className="figures">{formatMoney(seatFeesCents)}</dd>
      </div>
      <div>
        <dt>Order fee</dt>
        <dd className="figures">{formatMoney(orderFeeCents)}</dd>
      </div>
      <div className="ledger-total">
        <dt>Total</dt>
        <dd className="figures">{formatMoney(totalCents)}</dd>
      </div>
    </dl>
  );
}

export function CheckoutDialog({
  cart,
  secondsLeft,
  confirmation,
  paymentNotice,
  fieldErrors,
  pending,
  onPay,
  onClose,
  onViewTickets,
}: CheckoutDialogProps): ReactNode {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const nameField = useRef<HTMLInputElement>(null);
  const emailField = useRef<HTMLInputElement>(null);
  const messages = Object.entries(fieldErrors);

  return (
    <Dialog title="Checkout" closable={!pending} onClose={onClose}>
      {confirmation === null ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!pending) onPay(name, email);
          }}
        >
          <h2>Checkout</h2>
          {cart === null ? null : (
            <Ledger
              faceCents={cart.faceCents}
              seatFeesCents={cart.seatFeesCents}
              orderFeeCents={cart.orderFeeCents}
              totalCents={cart.totalCents}
            />
          )}
          <p className="countdown figures" role="timer" aria-label="Hold time left">
            {formatCountdown(secondsLeft ?? cart?.secondsLeft ?? 0)}
          </p>
          {messages.length > 0 ? (
            <div className="error-summary">
              <h3>Check these details</h3>
              <ul>
                {messages.map(([fieldName, message]) => (
                  <li key={fieldName}>
                    <a
                      href={`#checkout-${fieldName}`}
                      onClick={(event) => {
                        event.preventDefault();
                        if (fieldName === 'name') nameField.current?.focus();
                        else emailField.current?.focus();
                      }}
                    >
                      {message}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="checkout-name">Full name</label>
            <input
              id="checkout-name"
              name="name"
              ref={nameField}
              value={name}
              autoComplete="name"
              onChange={(event) => setName(event.target.value)}
            />
            {fieldErrors.name === undefined ? null : <p className="field-error">{fieldErrors.name}</p>}
          </div>
          <div className="field">
            <label htmlFor="checkout-email">Email</label>
            <input
              id="checkout-email"
              name="email"
              ref={emailField}
              value={email}
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
            />
            {fieldErrors.email === undefined ? null : <p className="field-error">{fieldErrors.email}</p>}
          </div>
          <div className="payment-notice" role="region" aria-label="Payment notice">
            {paymentNotice}
          </div>
          <div className="dialog-actions">
            <button type="submit" className="primary" disabled={pending}>
              {pending ? 'Confirming payment' : `Pay ${formatMoney(cart?.totalCents ?? 0)}`}
            </button>
            <button type="button" onClick={onClose} disabled={pending}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="confirmation">
          <h2>{COPY.confirmationHeading}</h2>
          <p className="figures">{`Order ${confirmation.id}`}</p>
          <div role="region" aria-label="Receipt" className="receipt">
            <ul className="cart-lines">
              {confirmation.tickets.map((ticket) => (
                <li key={ticket.id}>
                  <span className="cart-seat">{ticket.label}</span>
                  <span className="cart-tier">{ticket.tierName}</span>
                  <span className="figures">{formatMoney(ticket.faceCents)}</span>
                  <span className="figures">{formatMoney(ticket.seatFeeCents)}</span>
                </li>
              ))}
            </ul>
            <Ledger
              faceCents={confirmation.faceCents}
              seatFeesCents={confirmation.seatFeesCents}
              orderFeeCents={confirmation.orderFeeCents}
              totalCents={confirmation.totalCents}
            />
          </div>
          <p>{receiptLine(confirmation.email)}</p>
          <div className="dialog-actions">
            <button type="button" className="primary" onClick={onViewTickets}>
              View my tickets
            </button>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
