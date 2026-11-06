// Bookings: the month list (/workspace/bookings) and the booking page with its fee lines and Issue invoice.

import { useEffect, useRef, useState } from "react";
import { api } from "../../../api.js";
import { Link, definePage, navigate, useLocation } from "../../../router.js";
import { sessionCopy } from "../../../session.js";
import { Shell } from "../../../workspace/shell.js";
import { Button } from "../../../ui/button.js";
import { Select } from "../../../ui/fields.js";
import { StatusLine, useAnnouncer } from "../../../ui/status.js";
import { formatDate, formatMoney, formatMonth, formatOfficeTime, listJoin } from "../../../../shared/format.js";
import { OFFICES, addMonthsToMonth, isMonth, isOfficeId, type OfficeId } from "../../../../shared/zones.js";
import { useOfficeToday, type Booking } from "./common.js";
import { useResource, useMember } from "../../../workspace/data.js";
import { BILLING_DOWN } from "../../../workspace/data.js";

const STATE_NAMES: Record<Booking["state"], string> = { confirmed: "Confirmed", invoiced: "Invoiced", corrected: "Corrected" };

function BookingsPage() {
  const member = useMember();
  const { query } = useLocation();
  const officeParam = query.get("office") ?? "";
  const office: OfficeId | "all" = isOfficeId(officeParam) ? officeParam : officeParam === "all" ? "all" : member.office;
  const today = useOfficeToday(office === "all" ? "toronto" : office);
  const monthParam = query.get("month") ?? "";
  const current = today?.slice(0, 7) ?? "";
  const month = monthParam === "all" || isMonth(monthParam) ? monthParam : current;
  const params = new URLSearchParams();
  if (office !== "all") params.set("office", office);
  if (month !== "all") params.set("month", month);
  const bookings = useResource<{ bookings: Booking[] }>(month ? `/api/bookings?${params.toString()}` : null);
  const go = (next: { office?: string; month?: string }) =>
    navigate(`/workspace/bookings?office=${next.office ?? office}&month=${next.month ?? month}`);
  const months = current ? Array.from({ length: 25 }, (_, i) => addMonthsToMonth(current, i - 12)) : [];
  return (
    <Shell>
      <div className="workspace-head">
        <p className="eyebrow">Confirmed jobs and their invoices</p>
        <h1>Bookings</h1>
      </div>
      <div className="filters">
        <Select id="bookings-office" label="Office" value={office} onChange={(value) => go({ office: value })}
          choices={[{ value: "all", label: "Both offices" }, { value: "toronto", label: "Toronto" },
            { value: "vancouver", label: "Vancouver" }]} />
        <Select id="bookings-month" label="Month" value={month} onChange={(value) => go({ month: value })}
          choices={[{ value: "all", label: "All months" }, ...months.map((m) => ({ value: m, label: formatMonth(m) }))]} />
      </div>
      <div className="desk-region" role="region" aria-label="Booking list" tabIndex={0}>
        <table aria-label="Bookings" className="desk-table">
          <thead>
            <tr>
              <th scope="col">Reference</th>
              <th scope="col">Day</th>
              <th scope="col">Client</th>
              <th scope="col">Job</th>
              <th scope="col">Talent</th>
              <th scope="col">State</th>
              <th scope="col" className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {(bookings.data?.bookings ?? []).map((booking) => (
              <tr key={booking.id}>
                <th scope="row"><Link href={`/workspace/bookings/${booking.id}`}>{booking.reference}</Link></th>
                <td>{formatDate(booking.date)}</td>
                <td>{booking.clientCompany}</td>
                <td>{booking.jobTitle}</td>
                <td>{listJoin(booking.talent.map((t) => t.displayName))}</td>
                <td>{STATE_NAMES[booking.state]}</td>
                <td className="num">{formatMoney(booking.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {bookings.data && !bookings.data.bookings.length ? (
        <p className="desk-empty">No bookings {month === "all" ? "yet" : `in ${formatMonth(month)}`}{office === "all" ? "" : ` for ${OFFICES[office].city}`}.</p>
      ) : null}
      {!bookings.data ? <p className="muted">Loading bookings…</p> : null}
    </Shell>
  );
}

function BookingPage({ id }: { id: string }) {
  const member = useMember();
  const { message, announce } = useAnnouncer();
  const { data, reload } = useResource<{ booking: Booking }>(`/api/bookings/${id}`);
  const [pending, setPending] = useState(false);
  const stateText = useRef<HTMLElement>(null);
  const issueButton = useRef<HTMLButtonElement>(null);
  const [focusState, setFocusState] = useState(false);
  useEffect(() => {
    if (focusState) {
      setFocusState(false);
      stateText.current?.focus();
    }
  }, [focusState]);
  const booking = data?.booking;
  const office = member.office;
  const canIssue = member.role === "accounts_lead" || member.role === "agency_director";

  const issue = async () => {
    if (!booking) return;
    setPending(true);
    const result = await api<{ booking: Booking }>("POST", `/api/bookings/${booking.id}/issue`, {});
    setPending(false);
    if (result.ok) {
      await reload();
      announce("Invoice issued in billing.");
      setFocusState(true);
      return;
    }
    const error = result.error;
    const copy = sessionCopy(error)
      ?? (error.error === "already_invoiced"
        ? `This invoice was already issued by ${String(error.issuedBy ?? "")} at ${
          typeof error.issuedAt === "string" ? formatOfficeTime(error.issuedAt, office) : ""}.`
        : error.error === "billing_unavailable"
          ? BILLING_DOWN
          : "The invoice was not issued. Reload the booking and try again.");
    announce(copy);
    if (error.error === "already_invoiced") await reload();
    issueButton.current?.focus();
  };

  return (
    <Shell>
      <div className="workspace-head">
        <p className="eyebrow"><Link href="/workspace/bookings">Bookings</Link></p>
        <h1>{booking ? `Booking ${booking.reference}` : "Booking"}</h1>
      </div>
      <StatusLine name="Booking" message={message} />
      {!booking ? <p className="muted">Loading the booking…</p> : (
        <>
          <dl className="facts">
            <div><dt>State</dt><dd><span ref={stateText} tabIndex={-1} className="desk-state">{STATE_NAMES[booking.state]}</span></dd></div>
            <div><dt>Client</dt><dd>{booking.clientCompany}</dd></div>
            <div><dt>Job</dt><dd>{booking.jobTitle}</dd></div>
            <div><dt>Day</dt><dd>{formatDate(booking.date)}</dd></div>
            <div><dt>Office</dt><dd>{OFFICES[booking.office].city}</dd></div>
            <div><dt>Talent</dt><dd>{listJoin(booking.talent.map((t) => t.displayName))}</dd></div>
            <div><dt>Rate card</dt><dd>{booking.rateCard.name}, effective {formatDate(booking.rateCard.effectiveFrom)}</dd></div>
            <div><dt>Confirmed</dt><dd>{booking.confirmedBy}, {formatOfficeTime(booking.confirmedAt, office)}</dd></div>
            {booking.issuedBy && booking.issuedAt ? (
              <div><dt>Issued</dt><dd>{booking.issuedBy}, {formatOfficeTime(booking.issuedAt, office)}</dd></div>
            ) : null}
          </dl>
          {canIssue && booking.state === "confirmed" ? (
            <div className="btn-row">
              <Button ref={issueButton} pending={pending} pendingLabel="Issuing invoice…" onClick={() => void issue()}>
                Issue invoice</Button>
            </div>
          ) : null}
          <h2 className="section-title">Fee lines</h2>
          <div className="desk-region" role="region" aria-label="Fee lines" tabIndex={0}>
            <table aria-label="Fee lines" className="desk-table">
              <thead><tr><th scope="col">Line</th><th scope="col" className="num">Amount</th></tr></thead>
              <tbody>
                {booking.lines.map((line, i) => (
                  <tr key={i}><td>{line.label}</td><td className="num">{formatMoney(line.amountCents)}</td></tr>
                ))}
              </tbody>
              <tfoot>
                <tr><th scope="row">Talent fees</th><td className="num">{formatMoney(booking.talentFeesCents)}</td></tr>
                <tr><th scope="row">Service fee</th><td className="num">{formatMoney(booking.serviceFeeCents)}</td></tr>
                <tr><th scope="row">Tax</th><td className="num">{formatMoney(booking.taxCents)}</td></tr>
                <tr className="total"><th scope="row">Total</th><td className="num">{formatMoney(booking.totalCents)}</td></tr>
              </tfoot>
            </table>
          </div>
          <h2 className="section-title">Talent shares</h2>
          <ul className="rows">
            {booking.talent.map((t) => (
              <li key={t.talentId} className="row-line">
                <span>{t.displayName}</span>
                <span className="num">{formatMoney(t.talentFeesCents)} fees, {formatMoney(t.serviceFeeShareCents)} service fee share</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Shell>
  );
}

const READERS: Array<"agency_director" | "booker" | "accounts_lead"> = ["agency_director", "booker", "accounts_lead"];
definePage({ pattern: "/workspace/bookings", kind: "workspace", roles: READERS, render: () => <BookingsPage /> });
definePage({ pattern: "/workspace/bookings/:id", kind: "workspace", roles: READERS,
  render: (match) => <BookingPage key={match.params.id} id={match.params.id} /> });
