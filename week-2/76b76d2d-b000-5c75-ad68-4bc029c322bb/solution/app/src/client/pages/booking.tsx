import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Booking, Refund } from "../../shared/api.ts";
import { FARE_LABELS, formatMoney } from "../../shared/domain.ts";
import { api } from "../api.ts";
import { mailDown, useApp } from "../context.tsx";
import { localDate, localTime } from "../i18n.ts";
import { Dialog, Feedback, Num, PriceSummary, useAction } from "../ui.tsx";
import { CONFIRMED_KEY } from "./checkout.tsx";

type Source = { kind: "account"; ref: string } | { kind: "guest"; token: string };

/** "Booking confirmed" straight after payment: the checkout leaves a one-time marker for this booking. */
function takeConfirmation(): { ref: string; email: string } | null {
  const raw = sessionStorage.getItem(CONFIRMED_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(CONFIRMED_KEY);
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed === "object" && parsed !== null && "ref" in parsed && "email" in parsed && typeof parsed.ref === "string" && typeof parsed.email === "string") {
    return { ref: parsed.ref, email: parsed.email };
  }
  return null;
}

export function BookingPage({ source }: { source: Source }) {
  const ctx = useApp();
  const { locale, t } = ctx;
  const [booking, setBooking] = useState<Booking | null | undefined>(undefined);
  const [confirmation] = useState(takeConfirmation);
  const [refundOpen, setRefundOpen] = useState(false);
  const action = useAction();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const path = source.kind === "account" ? `/api/bookings/${encodeURIComponent(source.ref)}` : `/api/guest/bookings/${encodeURIComponent(source.token)}`;

  useLayoutEffect(() => {
    void api<{ booking: Booking }>("GET", path).then((r) => setBooking(r.ok ? r.data.booking : null));
  }, []);

  if (booking === undefined) return <section class="page"><h1 tabIndex={-1} class="page-title">{t.loading}</h1></section>;
  if (booking === null) return <section class="page"><h1 tabIndex={-1} class="page-title">{t.notFound}</h1></section>;

  const justPaid = confirmation?.ref === booking.ref;
  const refund = () => {
    void action.run(
      () => api<{ refund: Refund }>("POST", `${path}/refund`, {}),
      (data) => {
        setRefundOpen(false);
        setBooking({ ...booking, state: "refunded", tickets: booking.tickets.map((ticket) => ({ ...ticket, status: "refunded" })) });
        return t.refundDone(formatMoney(data.refund.refunded_cents, locale), data.refund.recredited_cents ? formatMoney(data.refund.recredited_cents, locale) : null);
      },
      () => setRefundOpen(false),
    );
  };

  return (
    <section class="page booking-page">
      <h1 ref={headingRef} tabIndex={-1} class="page-title">{justPaid ? t.bookingConfirmed : t.bookingHeading(booking.ref)}</h1>
      {justPaid ? (
        <div class="confirmation">
          <p>{t.confirmationLine(confirmation.email)}</p>
          {mailDown(ctx) ? <p class="muted">{t.mailDelayed}</p> : null}
        </div>
      ) : null}
      <div class="booking-layout">
        <div>
          <dl class="facts">
            <div><dt>{t.reference}</dt><dd><Num>{booking.ref}</Num></dd></div>
            <div><dt>{t.film}</dt><dd>{booking.screening.film_title}</dd></div>
            <div><dt>{t.showtime}</dt><dd><Num>{localDate(booking.screening.starts_at)} {localTime(booking.screening.starts_at)}</Num></dd></div>
            <div><dt>{t.auditorium}</dt><dd><Num>{booking.screening.auditorium}</Num></dd></div>
            <div><dt>{t.status}</dt><dd>{t.bookingState[booking.state]}</dd></div>
          </dl>
          <div class="table-wrap">
            <table aria-label={t.tickets} class="data-table">
              <thead><tr><th scope="col">{t.ticket}</th><th scope="col">{t.seat}</th><th scope="col">{t.fare}</th><th scope="col">{t.status}</th></tr></thead>
              <tbody>
                {booking.tickets.map((ticket) => (
                  <tr key={ticket.code}>
                    <td><Num>{ticket.code}</Num></td><td><Num>{ticket.seat}</Num></td><td>{FARE_LABELS[ticket.fare][locale]}</td><td>{t.ticketStatus[ticket.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {booking.split ? (
            <div class="table-wrap">
              <table aria-label={t.costSplit} class="data-table">
                <thead><tr><th scope="col">{t.payer}</th><th scope="col">{t.seatsLabel}</th><th scope="col">{t.share}</th></tr></thead>
                <tbody>
                  {booking.split.map((payer, i) => (
                    <tr key={i}><td>{payer.name}</td><td><Num>{payer.seats}</Num></td><td><Num>{formatMoney(payer.share_cents, locale)}</Num></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {booking.state === "paid" ? (
            <button type="button" class="button ghost" onClick={() => setRefundOpen(true)}>{t.refundBooking}</button>
          ) : null}
          <Feedback statusName={t.formStatus} alertName={t.formError} status={action.status} error={action.error} />
        </div>
        <aside class="booking-summary">
          <h2 class="panel-title">{t.priceSummary}</h2>
          <PriceSummary label={t.priceSummary} rows={[
            [t.admission, booking.admission_cents],
            [t.gst, booking.gst_cents],
            [t.qst, booking.qst_cents],
            [t.uplift, booking.uplift_cents ? booking.uplift_cents : null],
            [t.creditApplied, booking.credit_applied_cents ? booking.credit_applied_cents : null],
            [t.total, booking.total_cents, true],
            [t.payNow, booking.paid_cents, true],
          ]} />
        </aside>
      </div>
      <Dialog title={t.refundBooking} open={refundOpen} onClose={() => setRefundOpen(false)} returnFocus={booking.state === "refunded" ? headingRef : undefined}>
        <div class="dialog-body">
          <p>{t.refundIntro}</p>
          <div class="dialog-actions">
            <button type="button" class="button primary" disabled={action.busy} onClick={refund}>{action.busy ? t.working : t.confirmRefund}</button>
            <button type="button" class="button ghost" onClick={() => setRefundOpen(false)}>{t.close}</button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}
