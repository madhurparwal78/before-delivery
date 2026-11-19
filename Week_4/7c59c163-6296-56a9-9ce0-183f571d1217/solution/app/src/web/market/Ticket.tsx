import { forwardRef, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react";
import { collateralFor, fee, holdFor, holdKindOf, money, parseDollars, RANGES, type Mode, type Outcome, type Side } from "../../shared/rules";
import type { Market } from "../api";
import { Dialog } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { COPY } from "../copy";

export interface TicketOrder {
  mode: Mode | null;
  side: Side;
  outcome: Outcome | null;
  price: number;
  quantity: number;
}

export interface TicketHandle {
  prefill: (values: { outcome?: Outcome; side?: Side; price: number; quantity: number }) => void;
}

interface TicketProps {
  market: Market;
  openPosition: "long" | "short" | null;
  onSubmit: (order: TicketOrder) => void;
}

const dollars = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

/** The summary line from the shared hold rules: the most the order can spend at its limit price. */
function summarise(market: Market, order: TicketOrder, openPosition: "long" | "short" | null): string {
  const notional = order.price * order.quantity;
  const charge = fee(notional, market.taker_fee_bps);
  const kind = holdKindOf(market.kind, order.mode, order.side, openPosition);
  if (kind === "spot_sell") return `Proceeds ${money(notional)} − fee ${money(charge)} = ${money(notional - charge)}`;
  if (kind === "margin_open" || kind === "margin_reduce") {
    const collateral = kind === "margin_open" ? collateralFor(notional) : 0;
    return `Collateral ${money(collateral)} + fee ${money(charge)} = ${money(holdFor(kind, order.price, order.quantity, market.taker_fee_bps))}`;
  }
  return `Cost ${money(notional)} + fee ${money(charge)} = ${money(holdFor(kind, order.price, order.quantity, market.taker_fee_bps))}`;
}

export const Ticket = forwardRef<TicketHandle, TicketProps>(function Ticket({ market, openPosition, onSubmit }, ref) {
  const event = market.kind === "event";
  const [outcome, setOutcome] = useState<Outcome>("yes");
  const [mode, setMode] = useState<Mode>("spot");
  const [side, setSide] = useState<Side>("buy");
  const [price, setPrice] = useState(() => (event ? String(market.last_price ?? 50) : dollars(market.last_price ?? 100)));
  const [quantity, setQuantity] = useState("10");
  const [reviewing, setReviewing] = useState(false);
  const quantityInput = useRef<HTMLInputElement>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  useImperativeHandle(ref, () => ({
    prefill(values) {
      if (values.outcome) setOutcome(values.outcome);
      if (values.side) setSide(values.side);
      setPrice(event ? String(values.price) : dollars(values.price));
      setQuantity(String(values.quantity));
      quantityInput.current?.focus();
    },
  }));

  const priceCents = event ? (/^\d+$/.test(price.trim()) ? Number(price) : null) : parseDollars(price);
  const quantityValue = /^\d+$/.test(quantity.trim()) ? Number(quantity) : null;
  const range = event ? RANGES.eventPrice : RANGES.pairPrice;
  const priceOk = priceCents !== null && priceCents >= range.min && priceCents <= range.max;
  const quantityOk = quantityValue !== null && quantityValue >= RANGES.quantity.min && quantityValue <= RANGES.quantity.max;
  const order: TicketOrder = {
    mode: event ? null : mode,
    side: event ? "buy" : side,
    outcome: event ? outcome : null,
    price: priceCents ?? 0,
    quantity: quantityValue ?? 0,
  };
  const summary = !priceOk
    ? event
      ? COPY.order.eventPriceRange
      : COPY.order.pairPriceRange
    : !quantityOk
      ? COPY.order.quantityRange
      : summarise(market, order, openPosition);

  const stepPrice = (delta: number) => {
    const next = Math.max(range.min, Math.min(range.max, (priceCents ?? range.min) + delta));
    setPrice(event ? String(next) : dollars(next));
  };
  const stepQuantity = (delta: number) => {
    setQuantity(String(Math.max(RANGES.quantity.min, Math.min(RANGES.quantity.max, (quantityValue ?? 0) + delta))));
  };

  const onKeyDown = (keyEvent: KeyboardEvent<HTMLFormElement>) => {
    if (keyEvent.key === "Enter" && (keyEvent.ctrlKey || keyEvent.metaKey)) {
      keyEvent.preventDefault();
      setReviewing(true);
    }
  };

  const radio = (group: string, value: string, label: string, checked: boolean, set: () => void) => (
    <label className={`segment${checked ? " is-checked" : ""}`}>
      <input type="radio" name={`${market.id}-${group}`} value={value} checked={checked} onChange={set} />
      <span>{label}</span>
    </label>
  );

  return (
    <form
      className="card ticket"
      aria-label="Order ticket"
      id="order-ticket"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault();
        setReviewing(true);
      }}
    >
      <h2 className="card-title">Order ticket</h2>
      {event ? (
        <div role="radiogroup" aria-label="Outcome" className="segments">
          {radio("outcome", "yes", "Yes", outcome === "yes", () => setOutcome("yes"))}
          {radio("outcome", "no", "No", outcome === "no", () => setOutcome("no"))}
        </div>
      ) : (
        <>
          <div role="radiogroup" aria-label="Mode" className="segments">
            {radio("mode", "spot", "Spot", mode === "spot", () => setMode("spot"))}
            {radio("mode", "margin", "Margin", mode === "margin", () => setMode("margin"))}
          </div>
          <div role="radiogroup" aria-label="Side" className="segments">
            {radio("side", "buy", "Buy", side === "buy", () => setSide("buy"))}
            {radio("side", "sell", "Sell", side === "sell", () => setSide("sell"))}
          </div>
        </>
      )}
      <div className="stepper-field">
        <label htmlFor={`${market.id}-price`}>Price</label>
        <div className="stepper">
          <input
            id={`${market.id}-price`}
            type="number"
            inputMode={event ? "numeric" : "decimal"}
            min={event ? range.min : 0.01}
            max={event ? range.max : 10000}
            step={event ? 1 : 0.01}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="numeric"
          />
          <span className="unit">{event ? "¢" : "USD"}</span>
          <button type="button" className="step" aria-label="Decrease price" onClick={() => stepPrice(-1)}>
            <Icon name="minus" />
          </button>
          <button type="button" className="step" aria-label="Increase price" onClick={() => stepPrice(1)}>
            <Icon name="plus" />
          </button>
        </div>
      </div>
      <div className="stepper-field">
        <label htmlFor={`${market.id}-quantity`}>Quantity</label>
        <div className="stepper">
          <input
            ref={quantityInput}
            id={`${market.id}-quantity`}
            type="number"
            inputMode="numeric"
            min={RANGES.quantity.min}
            max={RANGES.quantity.max}
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="numeric"
          />
          <span className="unit">{event ? "contracts" : "units"}</span>
          <button type="button" className="step" aria-label="Decrease quantity" onClick={() => stepQuantity(-1)}>
            <Icon name="minus" />
          </button>
          <button type="button" className="step" aria-label="Increase quantity" onClick={() => stepQuantity(1)}>
            <Icon name="plus" />
          </button>
        </div>
      </div>
      <p className="ticket-summary numeric" role="status" aria-live="polite" aria-label="Ticket summary">
        {summary}
      </p>
      <button ref={reviewButton} type="submit" className="pill pill-wide">
        Review order
      </button>
      <p className="hint">Ctrl + Enter (⌘ + Enter on a Mac) reviews from any field.</p>
      <Dialog title="Review order" open={reviewing} onClose={() => setReviewing(false)} initialFocus={confirmButton} returnFocus={reviewButton}>
        <p className="review-line">
          {event ? `Buy ${outcome === "yes" ? "Yes" : "No"}` : `${mode === "spot" ? "Spot" : "Margin"} ${side}`} · {market.symbol}
        </p>
        <p className="review-summary numeric">{summary}</p>
        <div className="dialog-actions">
          <button
            ref={confirmButton}
            type="button"
            className="pill"
            onClick={() => {
              setReviewing(false);
              onSubmit(order);
            }}
          >
            Confirm order
          </button>
          <button type="button" className="pill pill-quiet" onClick={() => setReviewing(false)}>
            Back
          </button>
        </div>
      </Dialog>
    </form>
  );
});
