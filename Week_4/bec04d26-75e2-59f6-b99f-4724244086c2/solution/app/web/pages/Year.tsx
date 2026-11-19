import { useEffect, useState } from "react";
import { dateWords } from "../../shared/calendar";
import { type StateInfo, STATUS_LABELS, STATUSES } from "../../shared/types";
import { returnData } from "../components/Tile";
import { get } from "../api";
import { useLive, useReturnList } from "../hooks";
import { Link, navigate, useLocation } from "../router";

const STATUS_CHIPS: [string, string][] = [...STATUSES.map((s): [string, string] => [s, STATUS_LABELS[s]]), ["overdue", "Overdue"]];

export function Year({ year }: { year: string }) {
  const { path, query } = useLocation();
  const status = query.get("status") ?? "";
  const state = query.get("state") ?? "";
  const [states, setStates] = useState<StateInfo[] | null>(null);
  const load = (): void => void get<StateInfo[]>("/api/states").then((a) => a.ok && setStates(a.data));
  useEffect(load, []);
  useLive((event) => {
    if (event.type === "states") load();
  });

  const filters = new URLSearchParams();
  if (status) filters.set("status", status);
  if (state) filters.set("state", state);
  const suffix = filters.size ? `?${filters}` : "";
  const list = useReturnList(`/api/returns?year=${year}${filters.size ? `&${filters}` : ""}`);

  const toggle = (key: "status" | "state", value: string): void => {
    const next = new URLSearchParams(query);
    if (next.get(key) === value) next.delete(key);
    else next.set(key, value);
    navigate(`${path}${next.size ? `?${next}` : ""}`);
  };

    return (
    <main className="year">
      <h1>{`Year ${year}`}</h1>
      {/* The filters and table paint together once the states and the list are in, so neither pushes the other down. */}
      {states && list && <>
      <div className="chips" role="group" aria-label="Status filters">
        {STATUS_CHIPS.map(([value, label]) => (
          <button key={value} type="button" className="filter" aria-label={`Status: ${label}`} aria-pressed={status === value}
            onClick={() => toggle("status", value)}>{label}</button>
        ))}
      </div>
      <div className="chips" role="group" aria-label="State filters">
        {states.map((s) => (
          <button key={s.code} type="button" className="filter" aria-label={`State: ${s.code}`} aria-pressed={state === s.code}
            onClick={() => toggle("state", s.code)}>{s.code}</button>
        ))}
      </div>
      <div className="result-bar">
        <p role="status" aria-label="Result count">{`${list.counts.total} ${list.counts.total === 1 ? "return" : "returns"}`}</p>
        <a className="button" href={`/api/year/${year}/export.csv${suffix}`}>Export CSV</a>
      </div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Returns table">
      <table aria-label="Returns" role="table" className="returns-table">
        <thead role="rowgroup">
          <tr role="row">
            {["Client", "State", "Period", "Status", "Due", "Zone", "Gross sales", "Tax due", "Rate", "Edition"].map((h) => (
              <th key={h} role="columnheader" scope="col">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {list.returns.map((r) => (
            <tr key={r.id} role="row" {...returnData(r)}>
              <td role="cell" data-label="Client"><Link href={`/returns/${r.id}`}>{r.client.name}</Link></td>
              <td role="cell" data-label="State">{r.state}</td>
              <td role="cell" data-label="Period">{r.period_label}</td>
              <td role="cell" data-label="Status">{r.overdue ? `${r.status_label} · Overdue` : r.status_label}</td>
              <td role="cell" data-label="Due">{dateWords(r.due_date)}</td>
              <td role="cell" data-label="Zone">{r.zone_label}</td>
              <td role="cell" data-label="Gross sales" className="figure">{r.gross_sales ?? "Not entered"}</td>
              <td role="cell" data-label="Tax due" className="figure">{r.tax_due ?? "Not entered"}</td>
              <td role="cell" data-label="Rate" className="figure">{r.edition.rate}</td>
              <td role="cell" data-label="Edition">{r.edition.effective_date}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      </>}
    </main>
  );
}
