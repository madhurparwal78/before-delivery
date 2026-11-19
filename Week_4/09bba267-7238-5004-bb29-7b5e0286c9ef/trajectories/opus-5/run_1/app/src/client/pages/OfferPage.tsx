import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Offer, Order, Performance } from '../../shared/api';
import { COPY, receiptLine } from '../../shared/copy';
import { formatMoney } from '../../shared/money';
import { api, newIdempotencyKey } from '../lib/api';
import { useAnnouncer } from '../lib/announce';
import { rememberClosedHere, wasClosedHere } from '../lib/closedOffers';
import { formatCountdown, useServerCountdown } from '../lib/countdown';
import { useLiveUpdates } from '../lib/live';
import { Link } from '../lib/router';
import { NotFound } from './NotFound';

export function OfferPage({ token }: { readonly token: string }): ReactNode {
  const { announce } = useAnnouncer();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [performance, setPerformance] = useState<Performance | null>(null);
  const [missing, setMissing] = useState(false);
  const [confirmation, setConfirmation] = useState<Order | null>(null);
  const [paymentNotice, setPaymentNotice] = useState('');
  const [working, setWorking] = useState<'accept' | 'decline' | null>(null);
  const endAnnounced = useRef(false);

  const refresh = useCallback(async () => {
    const result = await api.offer(token);
    if (result.status === 404) {
      setMissing(true);
      return;
    }
    if (result.data === undefined) return;
    const fresh = result.data.offer;
    setOffer(fresh);
    if (performance === null || performance.id !== fresh.performanceId) {
      const show = await api.performance(fresh.performanceId);
      if (show.data !== undefined) setPerformance(show.data);
    }
    if (fresh.status !== 'open' && !endAnnounced.current && !wasClosedHere(token)) {
      endAnnounced.current = true;
      announce(COPY.offerEnded);
    }
  }, [token, announce, performance]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useLiveUpdates({ offerToken: token }, () => {
    void refresh();
  });

  const secondsLeft = useServerCountdown(offer === null || offer.status !== 'open' ? null : offer.secondsLeft, () => {
    void refresh();
  });

  const accept = async (): Promise<void> => {
    setWorking('accept');
    setPaymentNotice('');
    const result = await api.acceptOffer(token, newIdempotencyKey());
    setWorking(null);
    if (result.status === 201 && result.data !== undefined) {
      rememberClosedHere(token);
      endAnnounced.current = true;
      setConfirmation(result.data.order);
      announce(COPY.paymentConfirmed);
      void refresh();
      return;
    }
    if (result.status === 402) {
      rememberClosedHere(token);
      endAnnounced.current = true;
      announce(COPY.offerPaymentDeclined);
      setPaymentNotice(COPY.offerPaymentDeclined);
      void refresh();
      return;
    }
    if (result.status === 503) {
      announce(COPY.offerPaymentsPaused);
      setPaymentNotice(COPY.offerPaymentsPaused);
      void refresh();
      return;
    }
    endAnnounced.current = true;
    announce(COPY.offerEnded);
    void refresh();
  };

  const decline = async (): Promise<void> => {
    setWorking('decline');
    const result = await api.declineOffer(token);
    setWorking(null);
    if (result.status === 200) {
      rememberClosedHere(token);
      endAnnounced.current = true;
      announce(COPY.offerDeclined);
      void refresh();
      return;
    }
    endAnnounced.current = true;
    announce(COPY.offerEnded);
    void refresh();
  };

  if (missing) return <NotFound />;
  if (offer === null) return <section className="offer" />;

  if (confirmation !== null) {
    return (
      <section className="offer">
        <h1>{COPY.confirmationHeading}</h1>
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
          <dl className="ledger">
            <div>
              <dt>Face value</dt>
              <dd className="figures">{formatMoney(confirmation.faceCents)}</dd>
            </div>
            <div>
              <dt>Seat fees</dt>
              <dd className="figures">{formatMoney(confirmation.seatFeesCents)}</dd>
            </div>
            <div>
              <dt>Order fee</dt>
              <dd className="figures">{formatMoney(confirmation.orderFeeCents)}</dd>
            </div>
            <div className="ledger-total">
              <dt>Total</dt>
              <dd className="figures">{formatMoney(confirmation.totalCents)}</dd>
            </div>
          </dl>
        </div>
        <p>{receiptLine(confirmation.email)}</p>
        <p>
          <Link to="/tickets" className="action-link">
            View my tickets
          </Link>
        </p>
      </section>
    );
  }

  if (offer.status !== 'open') {
    return (
      <section className="offer">
        <h1>{COPY.offerEndedHeading}</h1>
        <p>{`${offer.label} is no longer offered to you.`}</p>
        <p>
          <Link to="/" className="action-link">
            Back to the programme
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section className="offer">
      <h1>A seat for you</h1>
      <h2>{performance?.title ?? ''}</h2>
      <p className="start-label figures">{performance?.startsAtVenue ?? ''}</p>
      <p className="offer-seat">{offer.label}</p>
      <dl className="ledger">
        <div>
          <dt>Face value</dt>
          <dd className="figures">{formatMoney(offer.faceCents)}</dd>
        </div>
        <div>
          <dt>Seat fees</dt>
          <dd className="figures">{formatMoney(offer.seatFeeCents)}</dd>
        </div>
        <div>
          <dt>Order fee</dt>
          <dd className="figures">{formatMoney(offer.orderFeeCents)}</dd>
        </div>
        <div className="ledger-total">
          <dt>Total</dt>
          <dd className="figures">{formatMoney(offer.totalCents)}</dd>
        </div>
      </dl>
      <p className="countdown figures" role="timer" aria-label="Offer time left">
        {formatCountdown(secondsLeft ?? offer.secondsLeft)}
      </p>
      <div className="payment-notice" role="region" aria-label="Payment notice">
        {paymentNotice}
      </div>
      <div className="dialog-actions">
        <button
          type="button"
          className="primary"
          disabled={working !== null}
          onClick={() => {
            void accept();
          }}
        >
          {working === 'accept' ? 'Confirming payment' : `Accept and pay ${formatMoney(offer.totalCents)}`}
        </button>
        <button
          type="button"
          disabled={working !== null}
          onClick={() => {
            void decline();
          }}
        >
          Decline offer
        </button>
      </div>
    </section>
  );
}
