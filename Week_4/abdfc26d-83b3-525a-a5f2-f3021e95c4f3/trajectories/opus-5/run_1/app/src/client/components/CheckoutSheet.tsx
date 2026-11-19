import { useEffect, useRef, useState } from 'react';
import type { Order } from '../../shared/api.js';
import {
  BILLING_COUNTRY_OPTIONS,
  CHECKOUT_VAT_RATES,
  checkoutStatus,
} from '../../shared/copy.js';
import { formatClock, formatUsd } from '../../shared/money.js';
import { useDialogFocus, useReducedMotion } from '../lib/hooks.js';
import { Link } from '../lib/router.js';
import { ErrorSummary } from './ErrorSummary.js';
import { Icon } from './Icon.js';

const FIELD_LABELS: Readonly<Record<string, string>> = {
  billing_name: 'Billing name',
  email: 'Email',
  billing_country: 'Billing country',
};

export interface CheckoutSheetProps {
  readonly open: boolean;
  readonly order: Order;
  readonly secondsLeft: number;
  readonly paying: boolean;
  readonly fieldErrors: Readonly<Record<string, string>>;
  readonly defaultEmail: string;
  readonly defaultName: string;
  readonly returnFocusTo: React.RefObject<HTMLElement | null>;
  onClose(): void;
  onRelease(): void;
  onPay(values: { billingName: string; email: string; billingCountry: string }): void;
}

/** VAT = net x rate, rounded half up to the cent, as the published table says. */
function vatOf(netCents: number, ratePercent: number): number {
  return Math.floor((netCents * ratePercent + 50) / 100);
}

/**
 * The checkout sheet: a dialog that keeps Tab inside, closes on Escape and
 * returns focus to the lens, with a server-timed countdown.
 */
export function CheckoutSheet({
  open,
  order,
  secondsLeft,
  paying,
  fieldErrors,
  defaultEmail,
  defaultName,
  returnFocusTo,
  onClose,
  onRelease,
  onPay,
}: CheckoutSheetProps): JSX.Element | null {
  const reducedMotion = useReducedMotion();
  const dialogRef = useDialogFocus(open, onClose, returnFocusTo);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [billingName, setBillingName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [billingCountry, setBillingCountry] = useState('US');

  useEffect(() => {
    if (!open) return;
    nameRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const settled = ['paid', 'invoiced', 'receipted'].includes(order.state);
  const ratePercent = CHECKOUT_VAT_RATES[billingCountry] ?? 0;
  const vatCents = vatOf(order.net_cents, ratePercent);
  const grossCents = order.net_cents + vatCents;

  return (
    <div
      className={`checkout-sheet${reducedMotion ? ' checkout-sheet--still' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Checkout"
      ref={dialogRef}
    >
      <div className="checkout-sheet__inner">
        <div className="checkout-sheet__head">
          <h2 className="checkout-sheet__title display">
            Edition {order.edition} of {order.edition_count}.
          </h2>
          <p className="checkout-sheet__piece muted">{order.piece_title}</p>
          {!settled && (
            <p className="checkout-sheet__timer tabular" aria-hidden="true">
              {checkoutStatus.heldFor(secondsLeft)}
            </p>
          )}
        </div>

        {settled ? (
          <div className="checkout-sheet__done">
            <p>
              {order.invoice_status === 'ready'
                ? checkoutStatus.confirmed(order.edition, order.edition_count)
                : checkoutStatus.invoicePending(order.invoice_number ?? '')}
            </p>
            <Link to="/library" className="next-action">
              Open library
              <Icon name="arrow-right" className="next-action__arrow" />
            </Link>
            <button type="button" className="ghost-button" onClick={onClose}>
              Close checkout
            </button>
          </div>
        ) : (
          <form
            className="checkout-sheet__form"
            onSubmit={(event) => {
              event.preventDefault();
              if (paying) return;
              onPay({ billingName, email, billingCountry });
            }}
          >
            <ErrorSummary errors={fieldErrors} labels={FIELD_LABELS} />

            <label className="field" htmlFor="billing_name">
              <span className="field__label">Billing name</span>
              <input
                id="billing_name"
                ref={nameRef}
                type="text"
                value={billingName}
                maxLength={120}
                {...(fieldErrors.billing_name ? { 'aria-invalid': true } : {})}
                onChange={(event) => setBillingName(event.target.value)}
              />
              {fieldErrors.billing_name && <span className="field-error">{fieldErrors.billing_name}</span>}
            </label>

            <label className="field" htmlFor="email">
              <span className="field__label">Email</span>
              <input
                id="email"
                type="email"
                value={email}
                {...(fieldErrors.email ? { 'aria-invalid': true } : {})}
                onChange={(event) => setEmail(event.target.value)}
              />
              {fieldErrors.email && <span className="field-error">{fieldErrors.email}</span>}
            </label>

            <label className="field" htmlFor="billing_country">
              <span className="field__label">Billing country</span>
              <select
                id="billing_country"
                value={billingCountry}
                {...(fieldErrors.billing_country ? { 'aria-invalid': true } : {})}
                onChange={(event) => setBillingCountry(event.target.value)}
              >
                {BILLING_COUNTRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {fieldErrors.billing_country && (
                <span className="field-error">{fieldErrors.billing_country}</span>
              )}
            </label>

            <dl className="checkout-sheet__totals tabular">
              <div>
                <dt>Net</dt>
                <dd>${formatUsd(order.net_cents)}</dd>
              </div>
              <div>
                <dt>VAT {ratePercent}%</dt>
                <dd>${formatUsd(vatCents)}</dd>
              </div>
              <div className="checkout-sheet__grand">
                <dt>Total USD</dt>
                <dd>${formatUsd(grossCents)}</dd>
              </div>
            </dl>

            <div className="checkout-sheet__actions">
              <button type="submit" className="next-action" disabled={paying}>
                Pay ${formatUsd(grossCents)}
              </button>
              <button type="button" className="ghost-button" onClick={onRelease}>
                Release hold
              </button>
              <button type="button" className="ghost-button" onClick={onClose}>
                Close checkout
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
