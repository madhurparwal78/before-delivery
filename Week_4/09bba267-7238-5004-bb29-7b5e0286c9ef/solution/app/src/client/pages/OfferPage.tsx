// A waitlist offer: the seat, its total and the time left, accepted and paid, or declined.
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { formatMoney } from "../../shared/rules.js";
import type { Offer, Order, Performance } from "../../shared/types.js";
import { announce } from "../announce.js";
import { get, newKey, request } from "../api.js";
import { clockText, Ledger, Link, NoticeRegion, useCountdown } from "../components.js";
import { OFFER_ENDED, OFFER_ENDED_HEADING, PAID } from "../copy.js";
import { useLive, useLoader } from "../live.js";
import { SeatLedger } from "../seatmap/CheckoutDialog.js";
import { NotFound } from "./NotFound.js";

const DECLINED_PAYMENT = "Your payment was declined. The seat goes to the next person waiting.";
const PAUSED = "Payments are paused right now. Your offer stays open until it ends. Please try again shortly.";
const OFFER_DECLINED = "Offer declined. The seat goes to the next person waiting.";

export function OfferPage({ token }: { token: string }): JSX.Element {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [show, setShow] = useState<Performance | null>(null);
  const [missing, setMissing] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [paymentNotice, setPaymentNotice] = useState("");
  const [answer, setAnswer] = useState<{ seconds: number | null; at: number }>({ seconds: null, at: 0 });
  const seq = useRef(0);
  /** Set once this page has announced (or caused) the offer's end, so it is never announced twice. */
  const settled = useRef(false);

  const applyOffer = (next: Offer): void => {
    setOffer(next);
    seq.current += 1;
    setAnswer({ seconds: next.status === "open" ? next.secondsLeft : null, at: seq.current });
  };

  const endedFromOutside = (): void => {
    if (settled.current) return;
    settled.current = true;
    announce(OFFER_ENDED);
  };

  const refresh = useLoader(async () => {
    const found = await get<{ offer: Offer }>(`/api/offers/${encodeURIComponent(token)}`);
    if (!found.ok) {
      if (found.status === 404) setMissing(true);
      return;
    }
    if (found.data.offer.status !== "open") settled.current = true;
    applyOffer(found.data.offer);
    const performance = await get<Performance>(`/api/performances/${encodeURIComponent(found.data.offer.performanceId)}`);
    if (performance.ok) setShow(performance.data);
  });
  useEffect(refresh, [token]);

  /** The offer closed while this page showed it open: announce unless this browser closed it. */
  const recheck = async (closedHere: boolean): Promise<void> => {
    const found = await get<{ offer: Offer }>(`/api/offers/${encodeURIComponent(token)}`);
    if (!found.ok) return;
    if (found.data.offer.status !== "open" && !busy) {
      if (closedHere) settled.current = true;
      else endedFromOutside();
    }
    applyOffer(found.data.offer);
  };

  useLive((event) => {
    if (event.type === "offer_closed" && event.token === token) void recheck(event.byThisBrowser);
    if (event.type === "resync") void recheck(false);
  });

  const secondsLeft = useCountdown(answer, () => void recheck(false));

  if (missing) return <NotFound />;

  const accept = async (): Promise<void> => {
    setBusy("accept");
    setPaymentNotice("");
    const result = await request<{ order: Order }>("POST", `/api/offers/${encodeURIComponent(token)}/accept`, {}, newKey());
    setBusy(null);
    if (result.ok) {
      settled.current = true;
      setOrder(result.data.order);
      announce(PAID);
    } else if (result.error.error === "payment_declined") {
      settled.current = true;
      setPaymentNotice(DECLINED_PAYMENT);
      announce(DECLINED_PAYMENT);
    } else if (result.error.error === "payments_unavailable") {
      setPaymentNotice(PAUSED);
      announce(PAUSED);
    } else {
      endedFromOutside();
    }
    refresh();
  };

  const decline = async (): Promise<void> => {
    setBusy("decline");
    const result = await request<{ offer: Offer }>("POST", `/api/offers/${encodeURIComponent(token)}/decline`, {});
    setBusy(null);
    if (result.ok) {
      settled.current = true;
      announce(OFFER_DECLINED);
      applyOffer(result.data.offer);
    } else {
      endedFromOutside();
      refresh();
    }
  };

  if (order) {
    return (
      <div class="offer-page">
        <div class="page-head">
          <p class="kicker">Waitlist offer</p>
          <h1>You're in</h1>
        </div>
        <p class="order-number">Order {order.id}</p>
        <section aria-label="Receipt" class="receipt">
          <p class="kicker">Receipt · {order.performanceTitle} · {order.startsAtVenue}</p>
          <SeatLedger totals={order} lines={order.tickets.map((t) => ({ key: t.id, ...t }))} />
        </section>
        <p class="receipt-line">A receipt is on its way to <span class="address">{order.email}.</span></p>
        <p><Link href="/tickets" class="button">View my tickets</Link></p>
      </div>
    );
  }

  if (!offer) {
    return <div class="offer-page" aria-busy="true"><div class="skeleton-line" /><div class="skeleton-line" /></div>;
  }

  const open = offer.status === "open";
  return (
    <div class="offer-page">
      <div class="page-head">
        <p class="kicker">Waitlist offer</p>
        <h1>{open ? "A seat for you" : OFFER_ENDED_HEADING}</h1>
        {show ? <p class="show-when"><strong>{show.title}</strong> · {show.startsAtVenue}</p> : null}
      </div>
      <p class="seat-name">{offer.label} · {offer.tierName}</p>
      <Ledger lines={[
        { label: "Face value", cents: offer.faceCents },
        { label: "Seat fee", cents: offer.seatFeeCents },
        { label: "Order fee", cents: offer.orderFeeCents },
        { label: "Total", cents: offer.totalCents, total: true },
      ]} />
      {open && secondsLeft !== null ? (
        <p class="offer-clock"><span class="kicker">Time left to accept </span>
          <span role="timer" aria-label="Offer time left">{clockText(secondsLeft)}</span></p>
      ) : null}
      <NoticeRegion label="Payment notice" text={paymentNotice} />
      {open ? (
        <div class="dialog-actions">
          <button type="button" disabled={busy !== null} onClick={() => void accept()}>
            {busy === "accept" ? "Confirming payment" : `Accept and pay ${formatMoney(offer.totalCents)}`}
          </button>
          <button type="button" class="quiet" disabled={busy !== null} onClick={() => void decline()}>Decline offer</button>
        </div>
      ) : (
        <p><Link href="/tickets" class="button quiet">Go to My tickets</Link></p>
      )}
    </div>
  );
}
