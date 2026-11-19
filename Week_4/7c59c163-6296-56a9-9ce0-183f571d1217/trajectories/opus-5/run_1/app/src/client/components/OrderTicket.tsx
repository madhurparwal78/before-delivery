import { useRef, useState } from 'react';
import { Dialog } from './Dialog.js';
import { formatAmount } from '../format.js';
import type { Market, OrderMode, OrderSide, Outcome } from '../api.js';

export interface TicketValues {
  outcome: Outcome;
  mode: OrderMode;
  side: OrderSide;
  /** Event price in whole cents; pair price in dollars with two decimals. */
  price: string;
  quantity: string;
}

export const emptyTicket = (kind: 'pair' | 'event'): TicketValues => ({
  outcome: 'yes',
  mode: 'spot',
  side: 'buy',
  price: kind === 'event' ? '50' : '25.00',
  quantity: '1',
});

export const priceToCents = (kind: 'pair' | 'event', price: string): number =>
  kind === 'event' ? Math.round(Number(price)) : Math.round(Number(price) * 100);

export const centsToPrice = (kind: 'pair' | 'event', cents: number): string =>
  kind === 'event' ? String(cents) : (cents / 100).toFixed(2);

const feeFor = (notionalCents: number, bps: number): number =>
  Math.floor((notionalCents * bps + 5000) / 10000);

/** The maximum the order can spend at its limit price, by the hold rules. */
export function summaryLine(market: Market, values: TicketValues, reduces: boolean): string {
  const price = priceToCents(market.kind, values.price);
  const quantity = Math.round(Number(values.quantity));
  if (!Number.isFinite(price) || !Number.isFinite(quantity) || price <= 0 || quantity <= 0) {
    return `Cost ${formatAmount(0)} + fee ${formatAmount(0)} = ${formatAmount(0)}`;
  }
  const notional = price * quantity;
  const fee = feeFor(notional, market.taker_fee_bps);
  if (market.kind === 'event' || (values.mode === 'spot' && values.side === 'buy')) {
    return `Cost ${formatAmount(notional)} + fee ${formatAmount(fee)} = ${formatAmount(notional + fee)}`;
  }
  if (values.mode === 'spot') {
    return `Proceeds ${formatAmount(notional)} − fee ${formatAmount(fee)} = ${formatAmount(notional - fee)}`;
  }
  const collateral = reduces ? 0 : Math.ceil(notional / 2);
  return `Collateral ${formatAmount(collateral)} + fee ${formatAmount(fee)} = ${formatAmount(collateral + fee)}`;
}

export interface OrderTicketProps {
  market: Market;
  values: TicketValues;
  onChange: (values: TicketValues) => void;
  reducesPosition: boolean;
  fieldError: string | null;
  onSubmit: () => void;
}

const EVENT_TICK = 1;
const PAIR_TICK = 1;

export function OrderTicket(props: OrderTicketProps): React.JSX.Element {
  const [reviewing, setReviewing] = useState(false);
  const reviewRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const quantityRef = useRef<HTMLInputElement | null>(null);
  const event = props.market.kind === 'event';

  const set = (patch: Partial<TicketValues>): void => props.onChange({ ...props.values, ...patch });

  const stepPrice = (direction: 1 | -1): void => {
    const cents = priceToCents(props.market.kind, props.values.price);
    const next = Math.max(1, cents + direction * (event ? EVENT_TICK : PAIR_TICK));
    set({ price: centsToPrice(props.market.kind, next) });
  };

  const stepQuantity = (direction: 1 | -1): void => {
    const next = Math.max(1, Math.round(Number(props.values.quantity) || 0) + direction);
    set({ quantity: String(next) });
  };

  const openReview = (): void => setReviewing(true);

  /** Ctrl+Enter, or Cmd+Enter on a Mac, opens the review from any control in the ticket. */
  const onKeyDown = (keyEvent: React.KeyboardEvent<HTMLFormElement>): void => {
    if (keyEvent.key === 'Enter' && (keyEvent.ctrlKey || keyEvent.metaKey)) {
      keyEvent.preventDefault();
      openReview();
    }
  };

  const summary = summaryLine(props.market, props.values, props.reducesPosition);

  return (
    <form
      className="card"
      aria-label="Order ticket"
      onSubmit={(formEvent) => {
        formEvent.preventDefault();
        openReview();
      }}
      onKeyDown={onKeyDown}
    >
      <h3 id="order-ticket-heading">Order ticket</h3>
      {event ? (
        <fieldset>
          <legend>Outcome</legend>
          <div className="radio-row" role="radiogroup" aria-label="Outcome">
            {(['yes', 'no'] as const).map((outcome) => (
              <label key={outcome}>
                <input
                  type="radio"
                  name="outcome"
                  value={outcome}
                  checked={props.values.outcome === outcome}
                  onChange={() => set({ outcome })}
                />
                {outcome === 'yes' ? 'Yes' : 'No'}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <>
          <fieldset>
            <legend>Mode</legend>
            <div className="radio-row" role="radiogroup" aria-label="Mode">
              {(['spot', 'margin'] as const).map((mode) => (
                <label key={mode}>
                  <input
                    type="radio"
                    name="mode"
                    value={mode}
                    checked={props.values.mode === mode}
                    onChange={() => set({ mode })}
                  />
                  {mode === 'spot' ? 'Spot' : 'Margin'}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Side</legend>
            <div className="radio-row" role="radiogroup" aria-label="Side">
              {(['buy', 'sell'] as const).map((side) => (
                <label key={side}>
                  <input
                    type="radio"
                    name="side"
                    value={side}
                    checked={props.values.side === side}
                    onChange={() => set({ side })}
                  />
                  {side === 'buy' ? 'Buy' : 'Sell'}
                </label>
              ))}
            </div>
          </fieldset>
        </>
      )}

      <div className="form-row">
        <label htmlFor="ticket-price">Price</label>
        <div className="price-row">
          <button type="button" className="stepper" aria-label="Decrease price" onClick={() => stepPrice(-1)}>
            −
          </button>
          <input
            id="ticket-price"
            type="number"
            inputMode="decimal"
            step={event ? 1 : 0.01}
            min={event ? 1 : 0.01}
            value={props.values.price}
            onChange={(changeEvent) => set({ price: changeEvent.target.value })}
          />
          <button type="button" className="stepper" aria-label="Increase price" onClick={() => stepPrice(1)}>
            +
          </button>
        </div>
      </div>

      <div className="form-row">
        <label htmlFor="ticket-quantity">Quantity</label>
        <div className="price-row">
          <button
            type="button"
            className="stepper"
            aria-label="Decrease quantity"
            onClick={() => stepQuantity(-1)}
          >
            −
          </button>
          <input
            id="ticket-quantity"
            ref={quantityRef}
            type="number"
            inputMode="numeric"
            step={1}
            min={1}
            value={props.values.quantity}
            onChange={(changeEvent) => set({ quantity: changeEvent.target.value })}
          />
          <button
            type="button"
            className="stepper"
            aria-label="Increase quantity"
            onClick={() => stepQuantity(1)}
          >
            +
          </button>
        </div>
      </div>

      <span className="status ticket__summary" role="status" aria-label="Ticket summary">
        {summary}
      </span>
      {props.fieldError !== null ? <p className="banner">{props.fieldError}</p> : null}

      <button type="button" className="pill" ref={reviewRef} onClick={openReview}>
        Review order
      </button>

      {reviewing ? (
        <Dialog
          label="Review order"
          initialFocus={confirmRef}
          returnFocus={() => reviewRef.current}
          onClose={() => setReviewing(false)}
        >
          <h2>Review order</h2>
          <p>{summary}</p>
          <div className="dialog__actions">
            <button
              type="button"
              className="pill"
              ref={confirmRef}
              onClick={() => {
                setReviewing(false);
                props.onSubmit();
              }}
            >
              Confirm order
            </button>
            <button type="button" className="pill pill--quiet" onClick={() => setReviewing(false)}>
              Back
            </button>
          </div>
        </Dialog>
      ) : null}
    </form>
  );
}
