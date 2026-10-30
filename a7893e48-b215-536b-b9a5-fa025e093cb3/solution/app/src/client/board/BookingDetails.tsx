import { useEffect, useState } from "react";
import { api, ApiFailure, idempotencyKey } from "../api.js";
import { Delayed, Live, useApp, type Message } from "../app.js";
import { Modal, useClose } from "../dialog.js";
import { hours, money, stampParts, STATUS_STAMPS } from "../format.js";
import type { AuditEvent, Booking, Invoice, Refund } from "../types.js";
import { paymentLabel } from "./Tickets.js";

const REFUND_DELAYED = "Refunds are delayed while billing is unreachable. Your booking is unchanged.";

interface DetailsProps {
  bookingId: string;
  zone: string;
  announce: (message: Message) => void;
  onChanged: () => void;
  onClose: () => void;
}

/** The cancel alertdialog: the server's refund tier decides the copy; Escape or Keep booking keeps it. */
function CancelDialog({ booking, announce, onDone }: { booking: Booking; announce: (message: Message) => void; onDone: () => void }) {
  const close = useClose();
  const [key] = useState(idempotencyKey);
  const notice = booking.policy.notice_hours;
  const cancel = async (): Promise<void> => {
    announce({ text: "Cancelling…", tone: "pending" });
    try {
      const { refund } = await api<{ booking: Booking; refund: Refund }>("POST", `/api/bookings/${booking.id}/cancel`, {}, key);
      announce({
        text: refund.tier === "full"
          ? `Cancelled. Refunded ${money(refund.card_refund_cents)} to card, ${hours(refund.pack_minutes_returned)} h to your pack and the ${money(refund.deposit_refund_cents)} deposit.`
          : `Cancelled under your booking's ${notice}-hour terms. Nothing was refunded.`,
        tone: "success",
      });
      onDone();
    } catch (error) {
      const delayed = error instanceof ApiFailure && error.code === "billing_unavailable";
      announce({ text: delayed ? REFUND_DELAYED : error instanceof ApiFailure ? error.detail : "Cancelling failed.", tone: "error" });
    }
    close();
  };
  return (
    <>
      <p className="alert-outcome">{booking.cancel_tier === "full" ? "You'll get a full refund." : `You're inside the ${notice}-hour notice. Nothing will be refunded.`}</p>
      <p className="terms">{booking.terms}</p>
      <div className="actions">
        <button type="button" className="button button-primary" onClick={() => void cancel()}>Yes, cancel</button>
        <button type="button" className="button" onClick={close}>Keep booking</button>
      </div>
    </>
  );
}

/** Booking details: fields, invoice lines, the booking's own terms, its history and its actions. */
export function BookingDetails({ bookingId, zone, announce, onChanged, onClose }: DetailsProps) {
  const { user } = useApp();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [managerMessage, setManagerMessage] = useState<Message | null>(null);
  const [payKey, setPayKey] = useState(idempotencyKey);

  const load = async (): Promise<void> => {
    const [one, bill, history] = await Promise.all([
      api<{ booking: Booking }>("GET", `/api/bookings/${bookingId}`),
      api<Invoice>("GET", `/api/bookings/${bookingId}/invoice`),
      api<{ events: AuditEvent[] }>("GET", `/api/bookings/${bookingId}/audit`),
    ]);
    setBooking(one.booking);
    setInvoice(bill);
    setEvents(history.events);
  };
  useEffect(() => { void load(); }, [bookingId]);

  const pay = async (): Promise<void> => {
    announce({ text: "Paying…", tone: "pending" });
    try {
      const result = await api<{ booking: Booking }>("POST", `/api/bookings/${bookingId}/pay`, {}, payKey);
      announce({ text: `Balance paid: ${money(result.booking.card_cents)}.`, tone: "success" });
      setPayKey(idempotencyKey());
      await load();
      onChanged();
    } catch (error) {
      announce({ text: error instanceof ApiFailure && error.code === "billing_unavailable" ? "Card payments are delayed while billing is unreachable. Nothing was charged." : error instanceof ApiFailure ? error.detail : "Paying failed.", tone: "error" });
    }
  };

  const override = async (): Promise<void> => {
    setManagerMessage({ text: "Cancelling…", tone: "pending" });
    try {
      await api("POST", `/api/bookings/${bookingId}/override`, { action: "cancel_refunded", reason });
      setManagerMessage({ text: "Cancelled with full refund. Reason recorded.", tone: "success" });
      await load();
      onChanged();
    } catch (error) {
      const code = error instanceof ApiFailure ? error.code : "";
      setManagerMessage({ text: code === "validation" ? "Give a reason of at least 5 characters." : code === "billing_unavailable" ? REFUND_DELAYED : error instanceof ApiFailure ? error.detail : "Cancelling failed.", tone: "error" });
    }
  };

  const start = booking ? stampParts(booking.local_start) : null;
  const end = booking ? stampParts(booking.local_end) : null;
  const isOwner = user.role === "renter";
  return (
    <Modal title="Booking details" className="details" onClose={onClose}>
      {booking && invoice && start && end ? (
        <>
          <div className="details-head">
            <p className="details-station">{booking.station_name} · <span>{booking.renter_business}</span></p>
            <span className={`stamp stamp-${booking.status}`}>{STATUS_STAMPS[booking.status]}</span>
          </div>
          <dl className="facts">
            <div><dt>Date</dt><dd className="mono">{start.date}</dd></div>
            <div><dt>Start</dt><dd className="mono">{start.time}</dd></div>
            <div><dt>End</dt><dd className="mono">{end.date === start.date ? end.time : `${end.date} ${end.time}`}</dd></div>
            <div><dt>Hours</dt><dd className="mono">{hours(booking.minutes)} h</dd></div>
            <div><dt>Payment</dt><dd>{paymentLabel(booking, zone).label} <span className="mono">{paymentLabel(booking, zone).amount}</span></dd></div>
          </dl>
          <table className="invoice" aria-label="Invoice">
            <thead><tr><th scope="col">Line</th><th scope="col">Hours</th><th scope="col">Amount</th></tr></thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.description}><td>{line.description}</td><td className="mono">{line.minutes === null ? "—" : hours(line.minutes)}</td><td className="mono">{money(line.amount_cents)}</td></tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th scope="row" colSpan={2}>Total</th><td className="mono">{money(invoice.total_cents)}</td></tr>
              <tr><th scope="row" colSpan={2}>Paid</th><td className="mono">{money(invoice.paid_cents)}</td></tr>
              <tr><th scope="row" colSpan={2}>Refunded</th><td className="mono">{money(invoice.refunded_cents)}</td></tr>
              <tr><th scope="row" colSpan={2}>Balance due</th><td className="mono">{money(invoice.balance_due_cents)}</td></tr>
            </tfoot>
          </table>
          <p className="terms">{booking.terms}</p>
          <details className="history">
            <summary>History</summary>
            <ol>
              {events.map((event, index) => (
                <li key={`${event.at}-${index}`}><span className="mono">{event.at.slice(0, 16).replace("T", " ")} UTC</span> {event.actor_name} · {event.action.replace(/_/g, " ")}{event.reason ? ` — “${event.reason}”` : ""}</li>
              ))}
            </ol>
          </details>
          <div className="actions">
            {isOwner && booking.balance_due_cents > 0 ? (
              <button type="button" className="button button-primary" aria-label="Pay balance" aria-describedby="balance-amount" onClick={() => void pay()}>Pay balance<span aria-hidden="true" id="balance-amount"> · <span className="mono">{money(booking.balance_due_cents)}</span></span><Delayed /></button>
            ) : null}
            {isOwner && booking.status === "confirmed" ? <button type="button" className="button" onClick={() => setCancelling(true)}>Cancel booking</button> : null}
          </div>
          {user.role === "manager" && booking.status === "confirmed" ? (
            <div className="override">
              <label className="field">
                <span>Override reason</span>
                <input type="text" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
              </label>
              <button type="button" className="button" onClick={() => void override()}>Cancel with full refund</button>
              <Live label="Manager status" message={managerMessage} />
            </div>
          ) : null}
          {cancelling ? (
            <Modal title="Cancel booking" alert className="alert" onClose={() => setCancelling(false)}>
              <CancelDialog booking={booking} announce={announce} onDone={() => { void load(); onChanged(); }} />
            </Modal>
          ) : null}
        </>
      ) : <p className="loading-row">Loading…</p>}
    </Modal>
  );
}
