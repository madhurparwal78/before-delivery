import { useEffect, useState } from 'react';
import type { Offer } from '../shared/api-types';
import { api } from './api';
import { announce } from './live';
import { TopBar, UpdatesRegion } from './shell';
import { formatCents, formatCountdown } from './seat-map-core';

export function OfferPage({ token }: { token: string }) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [pending, setPending] = useState<'accept' | 'decline' | null>(null);
  const [heading, setHeading] = useState('A seat for you');
  const [paymentNotice, setPaymentNotice] = useState('');
  const [confirmation, setConfirmation] = useState<{ orderId: string } | null>(null);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(interval);
  }, [token]);

  const load = async () => {
    const result = await api<{ offer: Offer }>(`/api/offers/${token}`);
    if (!result.ok) {
      if (result.status === 404) setNotFound(true);
      return;
    }
    const next = (result.value as { offer: Offer }).offer;
    setOffer((previous) => {
      if (previous && previous.status === 'open' && next.status !== 'open' && !confirmation) {
        setHeading('This offer has ended');
      }
      return next;
    });
  };

  const accept = async () => {
    setPending('accept');
    const result = await api<{ order: { id: string } }>(`/api/offers/${token}/accept`, {
      method: 'POST',
      body: {},
      idempotencyKey: `accept-${token}-${Math.random().toString(36).slice(2)}`,
    });
    setPending(null);
    if (result.ok) {
      const orderId = (result.value as { order: { id: string } }).order.id;
      setConfirmation({ orderId });
      announce('Payment confirmed. Your tickets are issued.');
      return;
    }
    if (result.status === 410 || result.status === 409) {
      announce('This offer has ended.');
      setHeading('This offer has ended');
      return;
    }
    if (result.error === 'payment_declined') {
      setPaymentNotice('Your payment was declined. The seat goes to the next person waiting.');
      announce('Your payment was declined. The seat goes to the next person waiting.');
      return;
    }
    if (result.error === 'payments_unavailable') {
      setPaymentNotice('Payments are paused right now. Your offer stays open until it ends. Please try again shortly.');
      announce('Payments are paused right now. Your offer stays open until it ends. Please try again shortly.');
    }
  };

  const decline = async () => {
    setPending('decline');
    const result = await api<{ offer: Offer }>(`/api/offers/${token}/decline`, {
      method: 'POST',
      body: {},
    });
    setPending(null);
    if (result.ok) {
      announce('Offer declined. The seat goes to the next person waiting.');
      setHeading('This offer has ended');
      return;
    }
    if (result.status === 410 || result.status === 409) {
      announce('This offer has ended.');
      setHeading('This offer has ended');
    }
  };

  if (notFound) {
    return (
      <div className="page">
        <TopBar active={null} />
        <UpdatesRegion />
        <main className="content">
          <h1>We couldn't find that page</h1>
        </main>
      </div>
    );
  }

  const open = offer !== null && offer.status === 'open' && confirmation === null;

  return (
    <div className="page">
      <TopBar active={null} />
      <UpdatesRegion />
      <main className="content offer-page">
        {confirmation ? (
          <>
            <h1>You're in</h1>
            <p>Order {confirmation.orderId}</p>
            <p>A receipt is on its way.</p>
            <a className="button-link" href="/tickets">View my tickets</a>
          </>
        ) : (
          <>
            <h1>{heading}</h1>
            {offer && (
              <>
                <p className="offer-seat">{offer.label}</p>
                <p className="offer-tier">{offer.tierName}</p>
                <dl className="ledger-totals">
                  <div><dt>Face value</dt><dd className="amount">{formatCents(offer.faceCents)}</dd></div>
                  <div><dt>Seat fee</dt><dd className="amount">{formatCents(offer.seatFeeCents)}</dd></div>
                  <div><dt>Order fee</dt><dd className="amount">{formatCents(offer.orderFeeCents)}</dd></div>
                  <div><dt>Total</dt><dd className="amount">{formatCents(offer.totalCents)}</dd></div>
                </dl>
                {open && offer.secondsLeft >= 0 && (
                  <p role="timer" aria-label="Offer time left" className="countdown">
                    {formatCountdown(offer.secondsLeft)}
                  </p>
                )}
                <div role="region" aria-label="Payment notice" className="payment-notice">
                  {paymentNotice}
                </div>
                {open ? (
                  <div className="dialog-actions">
                    <button className="pay-button" disabled={pending !== null} onClick={() => void accept()}>
                      {pending === 'accept' ? 'Confirming payment' : `Accept and pay ${formatCents(offer.totalCents)}`}
                    </button>
                    <button disabled={pending !== null} onClick={() => void decline()}>
                      Decline offer
                    </button>
                  </div>
                ) : (
                  <p className="offer-ended-line">This offer has ended.</p>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
