// Guided sessions (brief: Screens and layout › Sessions; Interactions › Booking). Status, seats
// left, times and prices are shown exactly as the server reports them, never from the device
// clock; the list refreshes every 30 seconds and after every booking attempt.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiFailure, fixedCurrency, LostReply, type Catalog, type Order, type Session } from "../api.js";
import { useApi, useStableKey } from "../hooks.js";
import { useApp } from "../state.js";
import { Dialog } from "../components/Dialog.js";
import { ChoiceGroup } from "../components/PlanDialog.js";
import { ErrorSummary, Field, Skeleton, type FieldErrors } from "../components/ui.js";
import { COPY, SESSION_STATUS_LABELS, copyFor } from "../../shared/copy.js";
import { CURRENCIES, formatPrice, type Currency } from "../../shared/money.js";

const REFRESH_MS = 30_000;
const MAX_SEATS = 4;

interface Booked {
  booking: { id: string; ticket_code: string; session_id: string; seats: number };
  order: Order;
  receipt_email: "sent" | "delayed";
}

function BookingDialog({ session, onClose, onAttempt }: { session: Session | null; onClose: () => void; onAttempt: () => void }) {
  const app = useApp();
  const [seats, setSeats] = useState("1");
  const [currency, setCurrency] = useState<Currency>("EUR");
  const [locked, setLocked] = useState<Currency | null>(null);
  const [card, setCard] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [booked, setBooked] = useState<Booked | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const catalog = useApi<Catalog>(session ? "/api/catalog" : null);
  const keyFor = useStableKey(JSON.stringify([session?.id, seats, currency, card]));
  const lastId = useRef<string | null>(null);
  if (session) lastId.current = session.id;

  useEffect(() => {
    if (!session) return;
    setSeats("1");
    setCard("");
    setErrors({});
    setMessage("");
    setBooked(null);
    setCurrency(session.currency ?? "EUR");
    setLocked(null);
    fixedCurrency().then(
      ({ currency: fixed }) => {
        setLocked(fixed);
        if (fixed) setCurrency(fixed);
      },
      () => undefined,
    );
    // A new dialog per opened session.
  }, [session?.id]);

  const seatCount = /^\d+$/.test(seats) ? Number(seats) : 0;
  const unit = catalog.data?.ticket.prices[currency];

  const pay = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !session) return;
    setBusy(true);
    setErrors({});
    setMessage("");
    app.announce(COPY.processing);
    try {
      const result = await api<Booked>(`/api/sessions/${session.id}/bookings`, { body: { seats: seatCount || seats, currency, card_number: card }, key: keyFor() });
      setBooked(result);
      setFocusKey((k) => k + 1);
      app.announce(copyFor.booked(result.booking.seats, session.title));
      if (result.receipt_email === "delayed") app.setServiceNotice(COPY.receiptDelayed);
    } catch (error) {
      if (error instanceof ApiFailure) {
        setErrors(error.error.fields ?? {});
        setMessage(error.error.fields ? COPY.validation : error.error.message);
        app.announce(error.error.message);
      } else if (error instanceof LostReply) setMessage("Connection lost. Press Pay and book again to finish safely.");
    } finally {
      setBusy(false);
      onAttempt();
    }
  };

  const ids = { seats: "booking-seats", currency: "booking-currency", card_number: "booking-card" };
  return (
    <Dialog
      open={session !== null}
      label="Book a guided session"
      onClose={onClose}
      focusKey={focusKey}
      returnFocus={() => document.getElementById(`book-${lastId.current}`) ?? document.getElementById(`session-${lastId.current}`)}
    >
      {session && booked ? (
        <div className="confirmation">
          <p className="catalogue">Ticket {booked.booking.ticket_code}</p>
          <h2 tabIndex={-1} data-dialog-focus>
            {COPY.booked}
          </h2>
          <p className="confirmation-line">{copyFor.confirmation(session.title, session.starts_at_display, booked.booking.ticket_code)}</p>
          <p className="hint">
            Receipt {booked.order.receipt_number}, {formatPrice(booked.order.amount_minor, booked.order.currency)}. Your ticket and receipt are on their way by email and in your account.
          </p>
          <div className="actions">
            <button type="button" className="button button-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        session && (
          <>
            <h2>Book a guided session</h2>
            <p className="dialog-lede">
              {session.title} · {session.starts_at_display}
            </p>
            <ErrorSummary errors={errors} message={message} ids={ids} />
            <form noValidate onSubmit={(e) => void pay(e)}>
              <Field id={ids.seats} label="Seats" type="number" min={1} max={MAX_SEATS} step={1} inputMode="numeric" value={seats} onChange={(e) => setSeats(e.currentTarget.value)} error={errors.seats} />
              <ChoiceGroup label="Currency" name="booking-currency" value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} disabled={(c) => locked !== null && c !== locked} />
              {locked && <p className="hint">{copyFor.currencyLocked(locked)}</p>}
              <div role="status" aria-label="Booking price" className="live-price">
                {catalog.failure ? COPY.pricesDown : unit !== undefined && seatCount >= 1 && seatCount <= MAX_SEATS ? copyFor.bookingPrice(formatPrice(unit * seatCount, currency), seatCount) : ""}
              </div>
              <Field id={ids.card_number} label="Card number" inputMode="numeric" autoComplete="cc-number" value={card} onChange={(e) => setCard(e.currentTarget.value)} error={errors.card_number} />
              <div className="actions">
                <button type="submit" className="button button-primary" disabled={busy}>
                  Pay and book
                </button>
              </div>
            </form>
          </>
        )
      )}
    </Dialog>
  );
}

export function SessionsPage() {
  const app = useApp();
  const list = useApi<{ server_time: string; sessions: Session[] }>(`/api/sessions?for=${app.user?.id ?? ""}`);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const { reload } = list;

  useEffect(() => {
    const timer = window.setInterval(reload, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [reload]);

  const sessions = list.data?.sessions ?? null;
  const booking = sessions?.find((s) => s.id === bookingId) ?? null;
  const pricesDown = sessions !== null && sessions.some((s) => s.price_minor === undefined);

  return (
    <div className="page sessions-page">
      <header className="page-intro">
        <p className="eyebrow">In the reading room</p>
        <h1>Guided sessions</h1>
        <p className="lede">A curator walks a small group through one room of the exhibition, live. Every time is Lisbon time, and booking closes 30 minutes before the start.</p>
      </header>
      {pricesDown && <p className="banner-inline">{COPY.pricesDown}</p>}
      {sessions ? (
        <ol className="session-grid">
          {sessions.map((s) => (
            <li key={s.id}>
              <article id={`session-${s.id}`} tabIndex={-1} className={`session-card museum-card status-${s.status}`} aria-label={s.title}>
                <div className="card-head">
                  <span className="catalogue">{s.id.toUpperCase()}</span>
                  <span className="badge">{SESSION_STATUS_LABELS[s.status]}</span>
                </div>
                <h2 className="card-title">{s.title}</h2>
                <p className="session-time">{s.starts_at_display}</p>
                <dl className="session-facts">
                  <div>
                    <dt>Duration</dt>
                    <dd>{s.duration_minutes} minutes</dd>
                  </div>
                  <div>
                    <dt>Seats</dt>
                    <dd>{copyFor.seatsLeft(s.seats_left)}</dd>
                  </div>
                  <div>
                    <dt>Price</dt>
                    <dd>{s.price_minor !== undefined && s.currency ? copyFor.seatPrice(formatPrice(s.price_minor, s.currency)) : COPY.pricesDown}</dd>
                  </div>
                </dl>
                {s.status === "on_sale" && (
                  <button
                    type="button"
                    id={`book-${s.id}`}
                    className="button button-primary"
                    aria-label={`Book ${s.title}`}
                    onClick={(e) => (app.user ? setBookingId(s.id) : app.openSignIn(e.currentTarget))}
                  >
                    Book
                  </button>
                )}
              </article>
            </li>
          ))}
        </ol>
      ) : (
        <Skeleton lines={6} />
      )}
      <BookingDialog session={booking} onClose={() => setBookingId(null)} onAttempt={reload} />
    </div>
  );
}
