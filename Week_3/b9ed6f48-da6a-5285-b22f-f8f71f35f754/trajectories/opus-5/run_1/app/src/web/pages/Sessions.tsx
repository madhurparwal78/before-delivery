import { useEffect, useRef, useState } from 'react';
import { api, ApiError, LostReplyError, newIdempotencyKey } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { useLockedCurrency } from '../lib/account.js';
import { useCatalog } from '../lib/hooks.js';
import { ConfirmationHeading, Dialog, ErrorSummary } from '../components/Dialog.js';
import {
  SESSION_STATUS_LABELS,
  bookedNotice,
  bookingConfirmationLine,
  bookingPriceLine,
  copy,
  seatPriceLine,
  seatsLeftLine,
} from '../../shared/copy.js';
import { CURRENCIES, type Currency } from '../../shared/money.js';
import type { Booking, GuidedSession, Order } from '../../shared/types.js';

const REFRESH_MS = 30_000;

interface SessionsResponse {
  server_time: string;
  sessions: GuidedSession[];
}

interface BookingResponse {
  booking: Booking;
  order: Order;
  receipt_email: 'sent' | 'delayed';
}

function BookingDialog({
  session,
  onClose,
  onBooked,
  restoreFocus,
}: {
  session: GuidedSession;
  onClose: () => void;
  onBooked: () => void;
  restoreFocus: () => void;
}): JSX.Element {
  const { announce, setServiceNotice } = useStore();
  const locked = useLockedCurrency();
  const catalog = useCatalog();
  const [seats, setSeats] = useState(1);
  const [currency, setCurrency] = useState<Currency>(locked ?? session.currency ?? 'EUR');
  const [card, setCard] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<BookingResponse | null>(null);

  const seatPrice = catalog.data?.ticket.prices[currency] ?? null;
  const priceMinor = seatPrice === null ? null : seatPrice * seats;

  async function submit(): Promise<void> {
    setPending(true);
    setMessage(null);
    setFields({});
    announce(copy.paymentPending);
    try {
      const result = await api<BookingResponse>(`/api/sessions/${session.id}/bookings`, {
        method: 'POST',
        body: { seats, currency, card_number: card },
        idempotencyKey: newIdempotencyKey(),
      });
      setConfirmed(result);
      announce(bookedNotice(seats, session.title));
      if (result.receipt_email === 'delayed') setServiceNotice(copy.receiptEmailDelayed);
      onBooked();
    } catch (error) {
      if (error instanceof ApiError) {
        setMessage(error.message);
        setFields(error.fields);
        if (error.code === 'billing_unavailable' || error.code === 'storage_unavailable') {
          setServiceNotice(error.message);
        }
      } else if (error instanceof LostReplyError) {
        setMessage(copy.donationLostReply);
      }
      announce('');
      onBooked();
      setPending(false);
    }
  }

  if (confirmed) {
    return (
      <Dialog title="Book a guided session" onClose={onClose} restoreFocus={restoreFocus} showTitle={false}>
        <ConfirmationHeading>{copy.bookingSuccessHeading}</ConfirmationHeading>
        <p>
          {bookingConfirmationLine(session.title, session.starts_at_display, confirmed.booking.ticket_code)}
        </p>
        <div className="inline-actions">
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Book a guided session" onClose={onClose} restoreFocus={restoreFocus}>
      <ErrorSummary
        message={message}
        fields={fields}
        fieldIds={{ seats: 'booking-seats', card_number: 'booking-card' }}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending) void submit();
        }}
      >
        <div className="field">
          <label htmlFor="booking-seats">Seats</label>
          <input
            id="booking-seats"
            type="number"
            aria-label="Seats"
            min={1}
            max={4}
            value={seats}
            onChange={(event) => setSeats(Number(event.target.value))}
          />
          {fields.seats ? <span className="field-error">{fields.seats}</span> : null}
        </div>
        <fieldset className="field" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="catalogue">Currency</legend>
          <div className="radio-row" role="radiogroup" aria-label="Currency">
            {CURRENCIES.map((entry) => (
              <label key={entry}>
                <input
                  type="radio"
                  name="booking-currency"
                  aria-label={entry}
                  checked={currency === entry}
                  disabled={locked !== null && locked !== entry}
                  onChange={() => setCurrency(entry)}
                />
                {entry}
              </label>
            ))}
          </div>
          {locked ? (
            <p className="secondary">
              Your supporter account pays in {locked}. Choose {locked} to continue.
            </p>
          ) : null}
        </fieldset>
        <p role="status" aria-label="Booking price" className="readout">
          {priceMinor !== null
            ? bookingPriceLine(priceMinor, currency, seats)
            : catalog.error
              ? copy.pricesUnavailable
              : ''}
        </p>
        <div className="field">
          <label htmlFor="booking-card">Card number</label>
          <input
            id="booking-card"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-label="Card number"
            value={card}
            onChange={(event) => setCard(event.target.value)}
          />
          {fields.card_number ? <span className="field-error">{fields.card_number}</span> : null}
        </div>
        <div className="inline-actions">
          <button type="submit" disabled={pending}>
            Pay and book
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function Sessions(): JSX.Element {
  const [sessions, setSessions] = useState<GuidedSession[]>([]);
  const [booking, setBooking] = useState<GuidedSession | null>(null);
  const cards = useRef(new Map<string, HTMLElement | null>());
  const bookButtons = useRef(new Map<string, HTMLButtonElement | null>());

  function reload(): void {
    void api<SessionsResponse>('/api/sessions')
      .then((result) => setSessions(result.sessions))
      .catch(() => undefined);
  }

  useEffect(() => {
    reload();
    const timer = window.setInterval(reload, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <>
      <h1>Guided sessions</h1>
      <p>Every time below is Lisbon time, as the reading room keeps it.</p>
      <ul className="card-grid">
        {sessions.map((session) => (
          <li key={session.id}>
            <article
              className="museum-card"
              tabIndex={-1}
              ref={(element) => cards.current.set(session.id, element)}
            >
              <h2 style={{ fontSize: 'var(--step-2)' }}>{session.title}</h2>
              <p className="readout">{session.starts_at_display}</p>
              <p className="secondary">{`${session.duration_minutes} minutes`}</p>
              <p>{SESSION_STATUS_LABELS[session.status]}</p>
              <p>{seatsLeftLine(session.seats_left)}</p>
              <p className="figure">
                {session.price_minor === undefined || session.currency === undefined
                  ? copy.pricesUnavailable
                  : seatPriceLine(session.price_minor, session.currency)}
              </p>
              {session.status === 'on_sale' ? (
                <button
                  type="button"
                  ref={(element) => bookButtons.current.set(session.id, element)}
                  onClick={() => setBooking(session)}
                >
                  {`Book ${session.title}`}
                </button>
              ) : null}
            </article>
          </li>
        ))}
      </ul>
      {booking ? (
        <BookingDialog
          session={booking}
          onClose={() => setBooking(null)}
          onBooked={reload}
          restoreFocus={() => {
            const identifier = booking.id;
            const button = bookButtons.current.get(identifier);
            if (button && button.isConnected) button.focus();
            else cards.current.get(identifier)?.focus();
          }}
        />
      ) : null}
    </>
  );
}
