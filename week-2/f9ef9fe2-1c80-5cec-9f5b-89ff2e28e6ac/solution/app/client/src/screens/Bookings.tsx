import { useCallback, useEffect, useState } from "react";
import { call, type ErrorBody } from "../api";
import { Dialog } from "../Dialog";
import { dollars, hoursText, kitchenDateTime, stateName } from "../format";
import { usePaused, useSession } from "../session";
import type { Booking, Invoice, UsageReport } from "../types";
import { type FormState, FormStatus, Page, StateBadge, Table } from "./common";
import { InvoiceDetail } from "./InvoiceDetail";

type DayAction = "check-in" | "complete" | "no-show";

/** Which day-sheet actions a booking offers, judged from its own fields (the server decides again). */
function dayActions(booking: Booking, today: string): DayAction[] {
  if (booking.state === "checked_in") return ["complete"];
  if (booking.state === "confirmed" && today >= booking.date) return ["check-in", "no-show"];
  return [];
}

/** The cancel dialog's preview, from the booking's stored window and the server clock. */
function cancelPreview(booking: Booking, serverNow: number): { inWindow: boolean; text: string } {
  const inWindow = serverNow <= Date.parse(booking.starts_at) - booking.cancellation_window_hours * 3_600_000;
  return inWindow
    ? { inWindow, text: `Cancelling now refunds ${hoursText(booking.pack_quarters)} pack hours and ${booking.total}.` }
    : { inWindow, text: `This is inside the ${booking.cancellation_window_hours}-hour cancellation window. Cancelling now refunds nothing.` };
}

const ACTION_NAMES: Record<DayAction, string> = { "check-in": "Check in", complete: "Mark completed", "no-show": "Mark no-show" };

export function BookingsScreen() {
  const { user, kitchen, clockOffset } = useSession();
  const staff = user.role !== "member";
  const [date, setDate] = useState(kitchen.today);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [businesses, setBusinesses] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [showInvoice, setShowInvoice] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const cancelPaused = usePaused("cancel_booking");

  const load = useCallback(async () => {
    const result = await call<{ bookings: Booking[] }>("GET", staff ? `/api/bookings?date=${date}` : "/api/bookings");
    setLoading(false);
    if (result.ok) setBookings(result.data.bookings);
  }, [staff, date]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!staff) return;
    void (async () => {
      const result = await call<UsageReport>("GET", `/api/kitchens/${kitchen.id}/reports/usage?month=${kitchen.today.slice(0, 7)}`);
      if (result.ok) setBusinesses(new Map(result.data.members.map((m) => [m.member_id, m.business])));
    })();
  }, [staff, kitchen.id, kitchen.today]);

  const booking = bookings.find((b) => b.id === selected) ?? null;

  useEffect(() => {
    setInvoice(null);
    setShowInvoice(false);
    if (!booking?.invoice_id) return;
    void (async () => {
      const result = await call<{ invoice: Invoice }>("GET", `/api/invoices/${booking.invoice_id}`);
      if (result.ok) setInvoice(result.data.invoice);
    })();
  }, [booking?.id, booking?.invoice_id]);

  const replace = (next: Booking): void => setBookings((list) => list.map((b) => (b.id === next.id ? next : b)));

  const failure = (b: Booking, error: ErrorBody): string => {
    if (error.error === "invalid_transition") return `${b.ref} cannot move from ${stateName(error.from ?? "")} to ${stateName(error.to ?? "")}.`;
    if (error.error === "booking_day_not_reached") return `${b.ref} can only be checked in or marked no-show from its booking day.`;
    if (error.error === "billing_unavailable") return "Billing is unreachable. Confirming, cancelling, recurring slots and pack purchases are paused. Brushing and holds still work.";
    if (error.error === "mail_unavailable") return "Email is unreachable. Confirming, cancelling and recurring slots are paused.";
    return error.message;
  };

  const runDayAction = (b: Booking, action: DayAction): void => {
    setPending(action);
    setForm({ text: "Saving…", tone: "info" });
    void (async () => {
      const result = await call<{ booking: Booking }>("POST", `/api/bookings/${b.id}/${action}`, {});
      setPending(null);
      if (!result.ok) {
        setForm({ text: failure(b, result.error), tone: "error" });
        return;
      }
      replace(result.data.booking);
      const text =
        action === "check-in" ? `Checked in ${businesses.get(b.member_id) ?? "the member"}.` : action === "complete" ? `Marked ${b.ref} completed.` : `Marked ${b.ref} as a no-show.`;
      setForm({ text, tone: "success" });
    })();
  };

  const cancel = (b: Booking): void => {
    setPending("cancel");
    setForm({ text: "Cancelling…", tone: "info" });
    void (async () => {
      const result = await call<{ booking: Booking; refund: { pack_quarters: number; amount_cents: number; amount: string } }>(
        "POST",
        `/api/bookings/${b.id}/cancel`,
        {},
      );
      setPending(null);
      setCancelOpen(false);
      if (!result.ok) {
        setForm({ text: failure(b, result.error), tone: "error" });
        return;
      }
      replace(result.data.booking);
      const { refund } = result.data;
      setForm({
        text:
          result.data.booking.state === "cancelled_in_window"
            ? `Booking ${b.ref} cancelled. ${hoursText(refund.pack_quarters)} pack hours and ${refund.amount} refunded.`
            : `Booking ${b.ref} cancelled inside the ${b.cancellation_window_hours}-hour window, so it is still charged.`,
        tone: "success",
      });
    })();
  };

  const preview = booking ? cancelPreview(booking, Date.now() + clockOffset) : null;

  return (
    <Page title="Bookings">
      {staff && (
        <div className="toolbar">
          <label className="field inline">
            <span>Date</span>
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
          <p className="muted">{user.role === "operator" ? "Day sheet in kitchen time." : "Read-only view of the kitchen's bookings."}</p>
        </div>
      )}
      <FormStatus state={form} />
      <Table
        label="Bookings"
        loading={loading}
        rows={bookings}
        rowKey={(b) => b.id}
        empty={staff ? `No bookings on ${date}.` : "No bookings yet. Brush a run on the loom to book one."}
        columns={[
          {
            label: "Reference",
            cell: (b) => (
              <button type="button" className="link-button num" aria-expanded={selected === b.id} onClick={() => setSelected(b.id)}>
                {b.ref}
              </button>
            ),
          },
          { label: "Date", cell: (b) => <span className="num">{b.date}</span> },
          { label: "Stations", cell: (b) => [...new Set(b.blocks.map((x) => x.station))].join(", ") },
          { label: "Time", cell: (b) => <span className="num">{timeSpan(b)}</span> },
          ...(staff ? [{ label: "Member", cell: (b: Booking) => businesses.get(b.member_id) ?? "" }] : []),
          { label: "Hours", numeric: true, cell: (b) => b.hours },
          { label: "Total", numeric: true, cell: (b) => b.total },
          { label: "State", cell: (b) => <StateBadge state={b.state} /> },
        ]}
      />

      {booking && (
        <section role="region" aria-label={`Booking ${booking.ref}`} className="detail">
          <h2 className="num">{booking.ref}</h2>
          <dl className="summary">
            <dt>Date</dt>
            <dd className="num">{booking.date}</dd>
            <dt>Stations and times</dt>
            <dd>
              {booking.blocks.map((x) => (
                <span key={`${x.station_id}${x.start}`} className="block">
                  {x.station} <span className="num">{x.start}–{x.end}</span>
                </span>
              ))}
            </dd>
            <dt>State</dt>
            <dd>
              <StateBadge state={booking.state} />
            </dd>
            <dt>Total</dt>
            <dd className="num">{booking.total}</dd>
            <dt>Pack hours used</dt>
            <dd className="num">{hoursText(booking.pack_quarters)}</dd>
            <dt>Rate card</dt>
            <dd className="num">{booking.rate_card_id}</dd>
            <dt>Cancellation window</dt>
            <dd className="num">{booking.cancellation_window_hours} hours</dd>
            <dt>Confirmed</dt>
            <dd className="num">{kitchenDateTime(booking.confirmed_at, kitchen.timezone)}</dd>
          </dl>
          <ul className="quote-lines" aria-label="Lines">
            {booking.lines.map((l) => (
              <li key={`${l.station_id}-${l.tier}-${l.paid_by}`}>
                <span className="line-station">{l.station}</span>
                <span className="num">tier {l.tier}</span>
                <span className="num">{l.hours} h</span>
                <span className="num amount">{l.paid_by === "pack" ? "pack" : dollars(l.amount_cents)}</span>
              </li>
            ))}
          </ul>
          <div className="detail-actions">
            {user.role !== "bookkeeper" && booking.state === "confirmed" && (
              <button type="button" className="danger-ghost" disabled={pending !== null || cancelPaused} onClick={() => setCancelOpen(true)}>
                Cancel booking
              </button>
            )}
            {user.role === "operator" &&
              dayActions(booking, kitchen.today).map((action) => (
                <button key={action} type="button" className="ghost" disabled={pending !== null} onClick={() => runDayAction(booking, action)}>
                  {ACTION_NAMES[action]}
                </button>
              ))}
            {invoice && (
              <a
                href={`/bookings#invoice-${invoice.id}`}
                className="text-link"
                onClick={(event) => {
                  event.preventDefault();
                  setShowInvoice(true);
                }}
              >
                Invoice {invoice.ref}
              </a>
            )}
          </div>
          {invoice && showInvoice && <InvoiceDetail invoice={invoice} />}
        </section>
      )}

      <Dialog title="Cancel booking" open={cancelOpen && booking !== null} onClose={() => setCancelOpen(false)}>
        {booking && preview && (
          <div className="dialog-body">
            <p className={preview.inWindow ? "" : "warning-text"}>{preview.text}</p>
            <div className="dialog-actions">
              <button type="button" className="danger" disabled={pending === "cancel"} onClick={() => cancel(booking)}>
                Yes, cancel
              </button>
              <button type="button" className="ghost" onClick={() => setCancelOpen(false)}>
                Keep booking
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </Page>
  );
}

function timeSpan(b: Booking): string {
  const starts = b.blocks.map((x) => x.start).sort();
  const ends = b.blocks.map((x) => x.end).sort();
  return `${starts[0] ?? ""}–${ends.at(-1) ?? ""}`;
}
