// The school roster: next delivery day, the summary and the roster table by band, and the CSV download.

import { useEffect, useState, type ReactNode } from "react";
import { Download } from "lucide-react";
import type { Roster as RosterBody, RosterRow, School } from "../../shared/api.js";
import { formatDate } from "../../shared/storeTime.js";
import { instrumentLabel, instrumentName, sizeWord } from "../../shared/vocabulary.js";
import { call, NETWORK_COPY } from "../api.js";
import { useApp, useUser } from "../app.js";
import { DeliveryStatusWord, RosterSummary } from "../components/RosterSummary.js";
import { errorNotice, quiet, Status, type Notice } from "../components/ui.js";
import { useBand, type Band } from "../hooks.js";

const COLUMNS: Record<Band, readonly string[]> = {
  narrow: ["Student", "Instrument", "Serial", "Status"],
  medium: ["Student", "Instrument", "Size", "Serial", "Delivery day", "Status"],
  wide: ["Student", "Grade", "Instrument", "Size", "Serial", "Delivery day", "Status"],
};

function cell(column: string, row: RosterRow, band: Band): ReactNode {
  const none = <span className="muted">—</span>;
  switch (column) {
    case "Student": return row.student_name;
    case "Grade": return <span className="figure">{row.grade === 0 ? "K" : row.grade}</span>;
    case "Instrument":
      if (row.instrument_type === null || row.size === null) return none;
      return band === "narrow" ? instrumentLabel(row.instrument_type, row.size) : instrumentName(row.instrument_type);
    case "Size": return row.size === null ? none : <span className={row.size === "full" ? "size-word" : "figure"}>{sizeWord(row.size)}</span>;
    case "Serial": return row.serial === null ? none : <span className="figure">{row.serial}</span>;
    case "Delivery day": return row.delivery_date === null ? none : <span className="figure">{formatDate(row.delivery_date)}</span>;
    default: return <DeliveryStatusWord status={row.delivery_status} />;
  }
}

export function Roster(): ReactNode {
  const user = useUser();
  const { location } = useApp();
  const band = useBand();
  const [roster, setRoster] = useState<RosterBody | null>(null);
  const [notice, setNotice] = useState<Notice>(quiet);
  const requested = new URLSearchParams(location.search).get("school");

  useEffect(() => {
    const schoolId = async (): Promise<string | null> => {
      if (user.role === "director") return user.school_id;
      if (requested) return requested;
      const r = await call<{ schools: School[] }>("GET", "/api/schools");
      return r.ok ? r.data.schools[0]?.id ?? null : null;
    };
    void schoolId().then(async (id) => {
      const r = id === null ? null : await call<RosterBody>("GET", `/api/schools/${encodeURIComponent(id)}/roster`);
      if (r?.ok) setRoster(r.data);
      else setNotice(errorNotice(r?.status === 404 ? "There is no roster for that school." : NETWORK_COPY));
    });
  }, [user, requested]);

  const columns = COLUMNS[band];
  return (
    <section className="page roster">
      {roster === null ? (
        <>
          <h1>Roster</h1>
          <p className="muted">Loading the roster…</p>
          <Status label="Roster status" notice={notice} />
        </>
      ) : (
        <>
          <header className="page__head">
            <p className="eyebrow">Delivery roster</p>
            <h1>{roster.school.name} roster</h1>
            <p className="next-day">Next delivery day: <span className="figure">{formatDate(roster.next_delivery_date)}</span></p>
          </header>
          <div className="roster__summary-row">
            <RosterSummary counts={roster.counts} total={roster.students.length} />
            <a className="button button--secondary" href={`/api/schools/${encodeURIComponent(roster.school.id)}/roster.csv`} download={`roster-${roster.school.id}.csv`}>
              <Download size={18} aria-hidden="true" />Download roster CSV
            </a>
          </div>
          <table className={`roster-table roster-table--${band}`} aria-label="Roster" role="table">
            <thead role="rowgroup">
              <tr role="row">{columns.map((c) => <th key={c} scope="col" role="columnheader">{c}</th>)}</tr>
            </thead>
            <tbody role="rowgroup">
              {roster.students.map((row) => (
                <tr key={row.student_id} role="row">
                  {columns.map((c) => <td key={c} role="cell" data-label={c}>{cell(c, row, band)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
