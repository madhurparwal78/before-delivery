// Schools: each school's delivery weekday, roster summary and the delivery-day notice. A school's delivery days
// refresh in place when its first cutoff passes on the server's clock; only a passed selection is cleared.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Roster, School } from "../../shared/api.js";
import { formatDate, formatDateTime } from "../../shared/storeTime.js";
import { call, NETWORK_COPY } from "../api.js";
import { Link } from "../app.js";
import { RosterSummary } from "../components/RosterSummary.js";
import { errorNotice, info, quiet, Status, type Notice } from "../components/ui.js";
import { hasPassed, SERVER_CLOCK_REFRESH_MS } from "../serverClock.js";

const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

export function Schools(): ReactNode {
  const [schools, setSchools] = useState<School[] | null>(null);
  const [notice, setNotice] = useState<Notice>(quiet);

  useEffect(() => {
    void call<{ schools: School[] }>("GET", "/api/schools").then((r) => {
      if (r.ok) setSchools(r.data.schools);
      else setNotice(errorNotice(NETWORK_COPY));
    });
    // Asking again keeps the page's estimate of the server clock fresh while it stays open.
    const timer = window.setInterval(() => void call("GET", "/api/schools"), SERVER_CLOCK_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="page schools">
      <header className="page__head">
        <p className="eyebrow">Partner programs</p>
        <h1>Schools</h1>
        <p className="lede">Each school takes deliveries on one weekday. Reservations made before 5:00 PM store time the day before make that delivery day.</p>
        <Status label="Schools status" notice={notice} />
      </header>
      <div className="school-grid">
        {(schools ?? []).map((school) => <SchoolSection key={school.id} initial={school} />)}
      </div>
    </section>
  );
}

function SchoolSection({ initial }: { initial: School }): ReactNode {
  const [school, setSchool] = useState(initial);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [selected, setSelected] = useState<string>(initial.upcoming_delivery_days[0].date);
  const [notice, setNotice] = useState<Notice>(quiet);
  const [busy, setBusy] = useState(false);
  const refreshing = useRef(false);
  const selection = useRef(selected);
  selection.current = selected;

  const loadRoster = useCallback(async () => {
    const r = await call<Roster>("GET", `/api/schools/${encodeURIComponent(initial.id)}/roster`);
    if (r.ok) setRoster(r.data);
  }, [initial.id]);
  useEffect(() => { void loadRoster(); }, [loadRoster]);

  /** Reloads this school's delivery days and roster summary; a selection no longer listed is cleared with the copy. */
  const refresh = useCallback(async (): Promise<void> => {
    refreshing.current = true;
    const [r] = await Promise.all([call<{ schools: School[] }>("GET", "/api/schools"), loadRoster()]);
    refreshing.current = false;
    const fresh = r.ok ? r.data.schools.find((s) => s.id === initial.id) : undefined;
    if (!fresh) return;
    setSchool(fresh);
    const kept = fresh.upcoming_delivery_days.some((d) => d.date === selection.current);
    if (!kept && selection.current !== "") {
      setNotice(errorNotice(`Delivery day ${formatDate(selection.current)} passed its cutoff. Pick another delivery day.`));
      setSelected("");
    }
  }, [initial.id, loadRoster]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!refreshing.current && hasPassed(school.upcoming_delivery_days[0].cutoff_at)) void refresh();
    }, 250);
    return () => window.clearInterval(timer);
  }, [school, refresh]);

  const titleId = `school-${school.id}`;
  return (
    <section className="school" aria-labelledby={titleId}>
      <header className="school__head">
        <h2 id={titleId}>{school.name}</h2>
        <p className="muted">Deliveries on {WEEKDAYS[school.delivery_weekday]} · next {formatDate(school.next_delivery_date)}</p>
      </header>
      {roster ? <RosterSummary counts={roster.counts} total={roster.students.length} /> : <p className="muted">Loading the roster summary…</p>}
      <Link to={`/roster?school=${encodeURIComponent(school.id)}`} className="text-link">View roster</Link>
      <form className="form notice-form" noValidate onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setNotice(info("Sending…"));
        void call<{ recipient: string; student_count: number }>("POST", `/api/schools/${encodeURIComponent(school.id)}/delivery-notice`,
          { delivery_date: selected }).then((r) => {
          setBusy(false);
          if (r.ok) {
            setNotice(info(`Delivery notice queued for ${r.data.recipient} (${r.data.student_count} students).`));
            void refresh();
          } else setNotice(errorNotice(r.status === 422 ? "Pick one of this school's delivery days." : NETWORK_COPY));
        });
      }}>
        <div className="field">
          <label className="field__label" htmlFor={`${titleId}-date`}>Delivery date</label>
          <select id={`${titleId}-date`} value={selected} onChange={(e) => {
            setSelected(e.currentTarget.value);
            setNotice(quiet);
          }}>
            <option value="">Pick a delivery day</option>
            {school.upcoming_delivery_days.map((d) => (
              <option key={d.date} value={d.date}>{formatDate(d.date)} (cutoff {formatDateTime(d.cutoff_at)})</option>
            ))}
          </select>
        </div>
        <button type="submit" className="button button--primary" disabled={busy || selected === ""}>Send delivery notice</button>
        <Status label="Delivery notice status" notice={notice} />
      </form>
    </section>
  );
}
