import { useEffect, useState } from "react";
import { Placeholder } from "./Placeholder";
import { OFFLINE_COPY, api } from "./api";
import { CANCELLED, SETTING_LABEL, STATUS_LABEL, clockOf, dateLine } from "./format";
import { Link } from "./router";
import { SeatCounter } from "./StatusMark";
import type { ApiRequest } from "./types";
import { useSearch } from "./useSearch";

/** The client scheduler's requests, newest start first, searchable by reference or consumer name. */
export function Requests() {
  const search = useSearch();
  const [requests, setRequests] = useState<ApiRequest[] | null>(null);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let current = true;
    void api<{ requests: ApiRequest[] }>("GET", `/api/requests?q=${encodeURIComponent(search.query)}`).then((result) => {
      if (!current) return;
      if (result.ok) {
        setRequests([...result.data.requests].reverse());
        setProblem("");
      } else setProblem(result.error?.message ?? OFFLINE_COPY);
    });
    return () => {
      current = false;
    };
  }, [search.query]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Requests</h1>
        <Link to="/requests/new" className="button button--primary">
          New request
        </Link>
      </div>
      <div className="search-row">
        <input
          type="search"
          className="input search"
          aria-label="Search requests"
          placeholder="Reference or consumer name"
          value={search.text}
          onChange={(e) => search.onChange(e.target.value)}
          onKeyDown={search.onKeyDown}
        />
      </div>
      {problem && <p className="banner banner--alert">{problem}</p>}
      {requests === null ? (
        <Placeholder />
      ) : (
        <table className="data-table stack" aria-label="Requests">
          <thead>
            <tr>
              <th scope="col">Reference</th>
              <th scope="col">Date</th>
              <th scope="col">Time</th>
              <th scope="col">Setting</th>
              <th scope="col">Status</th>
              <th scope="col">Seats</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td data-label="Reference">
                  <Link to={`/requests/${r.id}`} className={`num${CANCELLED.includes(r.status) ? " struck" : ""}`}>
                    {r.reference}
                  </Link>
                </td>
                <td data-label="Date">{dateLine(r.starts_at)}</td>
                <td data-label="Time" className="num">
                  {clockOf(r.starts_at)}
                </td>
                <td data-label="Setting">{SETTING_LABEL[r.setting]}</td>
                <td data-label="Status">
                  <span className={`status-label status-label--${r.status}`}>{STATUS_LABEL[r.status]}</span>
                </td>
                <td data-label="Seats">{r.seats.length > 0 ? <SeatCounter request={r} /> : <span className="quiet">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      
      {requests?.length === 0 && (
        <p className="empty">{search.query ? `No request matches “${search.query}”.` : "No requests yet. Start one with New request."}</p>
      )}
    </div>
  );
}
