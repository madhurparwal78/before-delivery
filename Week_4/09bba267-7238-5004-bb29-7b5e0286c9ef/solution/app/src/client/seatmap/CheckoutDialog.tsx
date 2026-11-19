// Checkout: the itemised ledger, the hold countdown, name and email, then the confirmation and receipt.
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { formatMoney } from "../../shared/rules.js";
import type { Cart, Order } from "../../shared/types.js";
import { announce } from "../announce.js";
import { CHECK_DETAILS, PAID } from "../copy.js";
import { newKey, request } from "../api.js";
import { clockText, Dialog, ErrorSummary, Field, Ledger, NoticeRegion, totalsLines } from "../components.js";
import { navigate } from "../router.js";

const DECLINED = "Your payment was declined. Your seats were released.";
const PAUSED = "Payments are paused right now. Your seats stay held until your hold ends. Please try again shortly.";

/** How a checkout attempt ended, so the seat map can refresh, end the hold or show that sales closed. */
type CheckoutResult = "paid" | "declined" | "paused" | "ended" | "closed" | "invalid";

interface Props {
  open: boolean;
  cart: Cart;
  performanceId: string;
  secondsLeft: number | null;
  onClose: () => void;
  onResult: (result: CheckoutResult) => void;
  cartHeading: () => HTMLElement | null;
}

const FIELD_IDS = { name: "checkout-name", email: "checkout-email" };

/** The seat lines and totals of a cart or an order, as a ruled ledger. */
export function SeatLedger({ lines, totals }: {
  lines: { key: string; label: string; tierName: string; faceCents: number; seatFeeCents: number }[];
  totals: { faceCents: number; seatFeesCents: number; orderFeeCents: number; totalCents: number };
}): JSX.Element {
  return (
    <>
      <ul class="seat-lines">
        {lines.map((line) => (
          <li class="seat-line" key={line.key}>
            <div>
              <p class="seat-name">{line.label}</p>
              <p class="seat-tier">{line.tierName}</p>
            </div>
            <div class="seat-amounts">
              <span>Face</span> <span class="amount">{formatMoney(line.faceCents)}</span>
              <span>Seat fee</span> <span class="amount">{formatMoney(line.seatFeeCents)}</span>
            </div>
          </li>
        ))}
      </ul>
      <Ledger lines={totalsLines(totals)} />
    </>
  );
}

export function CheckoutDialog({ open, cart, performanceId, secondsLeft, onClose, onResult, cartHeading }: Props): JSX.Element {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [paymentNotice, setPaymentNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setPaymentNotice("");
    setOrder(null);
  }, [open]);

  const pay = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setPaymentNotice("");
    const result = await request<{ order: Order }>("POST", `/api/performances/${encodeURIComponent(performanceId)}/checkout`, { name, email }, newKey());
    setPending(false);
    if (result.ok) {
      setErrors({});
      setOrder(result.data.order);
      announce(PAID);
      onResult("paid");
      return;
    }
    const { error, fields } = result.error;
    if (error === "validation" && fields) {
      setErrors(fields);
      announce(CHECK_DETAILS);
      onResult("invalid");
    } else if (error === "payment_declined") {
      setPaymentNotice(DECLINED);
      announce(DECLINED);
      onResult("declined");
    } else if (error === "payments_unavailable") {
      setPaymentNotice(PAUSED);
      announce(PAUSED);
      onResult("paused");
    } else if (error === "sales_closed") {
      onClose();
      onResult("closed");
    } else if (error === "cart_empty") {
      onClose();
      onResult("ended");
    }
  };

  const shownCart = cart.seats.length ? cart : null;
  return (
    <Dialog label="Checkout" open={open} busy={pending} onClose={onClose} fallbackFocus={cartHeading}>
      {order ? (
        <div class="dialog-body">
          <h2>You're in</h2>
          <p class="order-number">Order {order.id}</p>
          <section aria-label="Receipt" class="receipt">
            <p class="kicker">Receipt · {order.performanceTitle} · {order.startsAtVenue}</p>
            <SeatLedger totals={order} lines={order.tickets.map((t) => ({ key: t.id, ...t }))} />
          </section>
          <p class="receipt-line">A receipt is on its way to <span class="address">{order.email}.</span></p>
          <div class="dialog-actions">
            <button type="button" onClick={() => navigate("/tickets")}>View my tickets</button>
            <button type="button" class="quiet" onClick={onClose}>Close</button>
          </div>
        </div>
      ) : (
        <form class="dialog-body" noValidate onSubmit={(event) => void pay(event)}>
          <h2>Checkout</h2>
          {shownCart ? (
            <>
              <SeatLedger totals={shownCart} lines={shownCart.seats.map((s) => ({ key: s.seatId, ...s }))} />
              {secondsLeft !== null ? (
                <p class="hold-clock"><span class="kicker">Hold time left</span>
                  <span role="timer" aria-label="Hold time left">{clockText(secondsLeft)}</span></p>
              ) : null}
            </>
          ) : <p class="empty-line">No seats held.</p>}
          <ErrorSummary errors={errors} fieldIds={FIELD_IDS} />
          <Field id={FIELD_IDS.name} label="Full name" value={name} error={errors.name} autoComplete="name" autofocus onInput={setName} />
          <Field id={FIELD_IDS.email} label="Email" value={email} error={errors.email} type="email" autoComplete="email" onInput={setEmail} />
          <NoticeRegion label="Payment notice" text={paymentNotice} />
          <div class="dialog-actions">
            <button type="submit" disabled={pending || !shownCart}>{pending ? "Confirming payment" : `Pay ${formatMoney(cart.totalCents)}`}</button>
            <button type="button" class="quiet" onClick={onClose}>Cancel</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
