import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { DailyReport } from "../../shared/api.js";
import { isDate } from "../../shared/clock.js";
import { duration } from "../../shared/format.js";
import { api } from "../api.js";
import { Shell, type Session } from "../App.js";
import { UsageBars } from "../components/UsageBars.js";
import { GENERIC, reportCopy } from "../copy.js";
import { kitchenToday } from "../kitchen.js";
import { useRefresh, REFRESH_MS } from "../refresh.js";
import { navigate, type Screen } from "../router.js";
import { announce, Notice, ScreenHeading, show, tell, type NoticeState } from "../ui.js";
import { DateGroup } from "./DateGroup.js";


export function Report({ session, screen, search }: { session: Session; screen: Screen; search: string }): JSX.Element {
  const raw = new URLSearchParams(search).get("date");
  const date = raw !== null && isDate(raw) ? raw : kitchenToday(session.kitchen);
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<NoticeState | null>(null);
  /** The date whose first read has been drawn: later reads of it are refreshes. */
  const settled = useRef<string | null>(null);
  const latest = useRef<DailyReport | null>(null);

  useEffect(() => {
    if (raw !== date) navigate(`/report?date=${date}`, { replace: true });
  }, [search]);

  useRefresh(async (current) => {
    const first = settled.current !== date;
    setLoading(first);
    const result = await api<DailyReport>("GET", `/api/reports/daily?date=${date}`);
    if (!current()) return;
    if (!result.ok) {
      if (first && result.status !== 401) {
        setLoading(false);
        setFailure(tell(GENERIC, "outage"));
      }
      return;
    }
    const data = result.data;
    setFailure(null);
    if (first) {
      settled.current = date;
      setLoading(false);
      latest.current = data;
      setReport(data);
      announce(reportCopy.done(date, data.totalBookedMinutes));
      return;
    }
    const before = latest.current;
    if (before && JSON.stringify(before) === JSON.stringify(data)) return;
    latest.current = data;
    if (before && before.totalBookedMinutes !== data.totalBookedMinutes) announce(reportCopy.updated(date, data.totalBookedMinutes));
    setReport(data);
  }, REFRESH_MS, [date]);

  const shown = report?.date === date ? report : null;
  const description = shown ? shown.stations.map((s) => `${s.stationName}: ${duration(s.bookedMinutes)}`).join("; ") : "";
  return (
    <Shell session={session} screen={screen}
      tools={<><DateGroup date={date} kitchen={session.kitchen} onDate={(d) => navigate(`/report?date=${d}`)} /><span class="report-pending" data-loading={loading ? "true" : undefined}><Notice notice={show(reportCopy.pending)} /></span></>}>
      <section class="screen">
        <header class="screen__head">
          <ScreenHeading>Daily usage</ScreenHeading>
          {shown ? <p class="total">Total booked {duration(shown.totalBookedMinutes)}</p> : <p class="total" data-empty="true" aria-hidden="true">{"\u00a0"}</p>}
          <Notice notice={failure} />
        </header>
        <div class="report" data-settling={shown || failure ? undefined : "true"}>
          {shown ? (
            <figure class="panel usage" aria-label="Usage by station" aria-describedby="usage-description">
              <span id="usage-description" class="visually-hidden">{description}</span>
              <UsageBars stations={shown.stations} settled={date} />
            </figure>
          ) : null}
          <section class="panel">
            <h2>Minutes per station</h2>
            <table class="table" aria-label="Usage by station">
              <thead><tr><th scope="col">Station</th><th scope="col">Booked</th><th scope="col">Bookings</th></tr></thead>
              <tbody>
                {(shown?.stations ?? []).map((s) => (
                  <tr key={s.stationId}><td data-label="Station">{s.stationName}</td><td data-label="Booked" class="num">{duration(s.bookedMinutes)}</td><td data-label="Bookings" class="num">{s.bookingCount}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
          <section class="panel report__wide">
            <h2>Minutes per tenant</h2>
            <table class="table" aria-label="Usage by tenant">
              <thead><tr><th scope="col">Business</th><th scope="col">Booked</th><th scope="col">Bookings</th><th scope="col">No-shows</th></tr></thead>
              <tbody>
                {shown && shown.tenants.length === 0 ? <tr><td colSpan={4} class="muted">No bookings on this date.</td></tr> : null}
                {(shown?.tenants ?? []).map((t) => (
                  <tr key={t.tenantId}><td data-label="Business">{t.businessName}</td><td data-label="Booked" class="num">{duration(t.bookedMinutes)}</td><td data-label="Bookings" class="num">{t.bookingCount}</td><td data-label="No-shows" class="num">{t.noShowCount}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </section>
    </Shell>
  );
}
