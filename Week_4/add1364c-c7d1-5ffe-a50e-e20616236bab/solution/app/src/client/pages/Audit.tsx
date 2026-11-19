import { useCallback, useEffect, useRef, useState } from "react";
import { get } from "../lib/api";
import { useTitle } from "../lib/hooks";
import { validDate } from "../lib/office";
import { useRouter } from "../lib/router";
import { useStore } from "../lib/store";
import type { AuditEntry, AuditPage } from "../lib/types";

const PAGE = 50;

export function Audit() {
  useTitle("Audit trail");
  const { office } = useStore();
  const { location, navigate } = useRouter();
  const asked = new URLSearchParams(location.search).get("day");
  const day = validDate(asked) ? asked : null;
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const wanted = useRef<string | null>(null);
  const firstNew = useRef<string | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (day || !office) return;
    navigate(`/audit?day=${office.date}`, true);
  }, [day, office, navigate]);

  const loadFirst = useCallback(async (d: string) => {
    wanted.current = d;
    setLoaded(false);
    try {
      const page = await get<AuditPage>(`/api/audit?day=${d}&order=oldest&limit=${PAGE}`);
      if (wanted.current !== d) return;
      setEntries(page.entries);
      setCursor(page.next_cursor);
      setLoaded(true);
    } catch { /* leave the page empty */ }
  }, []);

  useEffect(() => {
    if (day) { setEntries([]); setCursor(null); void loadFirst(day); }
  }, [day, loadFirst]);

  const more = async () => {
    if (!day || !cursor || loading) return;
    setLoading(true);
    const d = day;
    try {
      const page = await get<AuditPage>(`/api/audit?day=${d}&order=oldest&limit=${PAGE}&after=${encodeURIComponent(cursor)}`);
      if (wanted.current !== d) return;
      firstNew.current = page.entries[0]?.id ?? null;
      setEntries((current) => [...current, ...page.entries]);
      setCursor(page.next_cursor);
    } catch { /* the button stays for another try */ } finally { setLoading(false); }
  };

  useEffect(() => {
    if (!firstNew.current) return;
    rows.current.get(firstNew.current)?.focus({ preventScroll: true });
    firstNew.current = null;
  }, [entries]);

  const change = (value: string) => {
    if (validDate(value)) navigate(`/audit?day=${value}`);
  };

  return (
    <div className="folder-page">
      <section className="folder band-0 sheet">
        <header className="folder-title">
          <h1>Audit trail</h1>
          <label className="inline-field">Office day <input type="date" value={day ?? ""} max={office?.date} onChange={(e) => change(e.target.value)} /></label>
        </header>
        <div role="table" aria-label="Audit entries" className="grid-table audit-table">
          <div role="rowgroup" className="gt-head"><div role="row"><span role="columnheader">Office time</span><span role="columnheader">Actor</span><span role="columnheader">Action</span><span role="columnheader">Subject</span></div></div>
          <div role="rowgroup" className="gt-body">
            {entries.map((e) => (
              <div role="row" className="gt-row" key={e.id} tabIndex={-1} ref={(el) => { if (el) rows.current.set(e.id, el); else rows.current.delete(e.id); }}>
                <span role="cell" className="fig">{e.office_time} {e.offset}</span>
                <span role="cell">{"system" in e.actor ? e.actor.system : e.actor.name}</span>
                <span role="cell">{e.action}</span>
                <span role="cell">{e.subject.name}</span>
              </div>
            ))}
          </div>
        </div>
        {loaded && entries.length === 0 ? <p className="muted pad">No entries were written on this office day.</p> : null}
        {cursor ? <button type="button" className="btn btn-solid btn-cut more" aria-disabled={loading || undefined} onClick={() => void more()}>{loading ? "Loading" : "More entries"}</button> : null}
      </section>
    </div>
  );
}
