import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import type { Booking } from "../../shared/api.js";
import { duration } from "../../shared/format.js";
import { api } from "../api.js";
import { Shell, type Session } from "../App.js";
import { bookingDate, bookingEmailAnnouncement, bookingEmailLine, MISSING_RECORD, ticketStatus } from "../copy.js";
import { hhmm, holdSecondsLeft } from "../kitchen.js";
import { useRefresh, REFRESH_MS } from "../refresh.js";
import { navigate, type Screen } from "../router.js";
import { announce, landOn, ScreenHeading } from "../ui.js";


export function Receipt({ session, screen, id }: { session: Session; screen: Screen; id: string }): JSX.Element | null {
  const [booking, setBooking] = useState<Booking | null | "missing">(null);
  const latest = useRef<Booking | null>(null);
  const tenant = session.me.role === "tenant";

  useRefresh(async (current) => {
    const result = await api<Booking>("GET", `/api/bookings/${id}`);
    if (!current()) return;
    if (!result.ok) {
      if (result.status !== 404) return;
      if (tenant) {
        landOn("heading");
        navigate("/board", { replace: true });
      } else {
        setBooking("missing");
      }
      return;
    }
    const before = latest.current;
    if (before && JSON.stringify(before) === JSON.stringify(result.data)) return;
    latest.current = result.data;
    const sent = before ? result.data.emails.filter((e) => e.status === "sent" && before.emails.some((b) => b.kind === e.kind && b.status === "queued")) : [];
    if (sent.length > 0) announce(sent.map((e) => bookingEmailAnnouncement(e.kind)).join(" "));
    setBooking(result.data);
  }, REFRESH_MS, [id]);

  if (booking === null) return <Shell session={session} screen={screen}><section class="screen" /></Shell>;
  if (booking === "missing") {
    return <Shell session={session} screen={screen}><section class="screen"><p class="missing">{MISSING_RECORD}</p></section></Shell>;
  }
  const seconds = holdSecondsLeft(booking.holdExpiresAt, session.kitchen.holdSeconds);
  const lines: [string, string][] = [
    ["Station", booking.stationName],
    ["Shelf", booking.shelfName ?? "None"],
    ["Date", bookingDate(booking)],
    ["Starts", hhmm(booking.start)],
    ["Ends", hhmm(booking.end)],
    ["Hours debited", booking.debitedMinutes === null ? "—" : duration(booking.debitedMinutes)],
    ["Status", ticketStatus(booking, seconds)],
    ["Booking reference", booking.id],
  ];
  return (
    <Shell session={session} screen={screen}>
      <section class="screen receipt-screen">
        <article class="ticket receipt">
          <ScreenHeading>Booking receipt</ScreenHeading>
          <p class="receipt__kitchen">{session.kitchen.name} · {session.kitchen.timeZone}</p>
          {booking.tenantName ? <p class="receipt__kitchen">{booking.tenantName}</p> : null}
          <dl class="receipt__lines">
            {lines.map(([label, value]) => (
              <div key={label} class="receipt__line"><dt>{label}</dt><dd class={label === "Booking reference" ? "mono" : undefined}>{value}</dd></div>
            ))}
          </dl>
          <div class="receipt__emails">
            {booking.emails.map((e) => <p key={e.kind} class="email-line" data-status={e.status}>{bookingEmailLine(e)}</p>)}
          </div>
        </article>
      </section>
    </Shell>
  );
}
