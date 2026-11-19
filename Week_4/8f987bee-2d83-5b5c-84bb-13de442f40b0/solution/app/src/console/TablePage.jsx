import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Discs } from "../components/Icons.jsx";
import { api, outageCopy } from "./api.js";
import { useConsole } from "./context.js";

const PAGE = 50;

// One warehouse table, one page at a time; the page lives in the address, so reload and history show it again.
export default function TablePage() {
  const { destinationId, table } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { report } = useConsole();
  const cursor = params.get("cursor");
  const [page, setPage] = useState(null);
  const [invalid, setInvalid] = useState(false);
  const [missing, setMissing] = useState(false);
  const [status, setStatus] = useState("");
  const base = `/app/destinations/${destinationId}/tables/${table}`;

  useEffect(() => {
    let current = true;
    setStatus("Loading records…");
    setInvalid(false);
    setMissing(false);
    const query = new URLSearchParams({ limit: String(PAGE), ...(cursor ? { cursor } : {}) });
    api(`/api/destinations/${destinationId}/tables/${encodeURIComponent(table)}/records?${query}`).then((result) => {
      if (!current) return;
      if (result.ok) {
        setPage(result.body);
        setStatus("Page loaded");
      } else if (result.status === 404) {
        setPage(null);
        setMissing(true);
        setStatus("");
      } else if (result.body?.error === "invalid_cursor") {
        setPage(null);
        setInvalid(true);
        setStatus("");
      } else {
        setPage(null);
        setStatus(result.outage ? outageCopy(result) : "");
        report(result);
      }
    });
    return () => { current = false; };
  }, [destinationId, table, cursor, report]);

  if (missing) {
    return (
      <div className="page">
        <div className="empty empty-stacked panel">
          <Discs />
          <h1>Table not found</h1>
          <p>This destination lists no table by that name in your workspace.</p>
          <Link to="/app/destinations">Back to destinations</Link>
        </div>
      </div>
    );
  }
  const records = page?.records ?? [];
  const columns = records.length ? Object.keys(records[0]) : [];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="label eyebrow"><Link to="/app/destinations">Destinations</Link></span>
          <h1 className="code-title">{table}</h1>
        </div>
      </div>
      {invalid && (
        <div role="alert" className="alert">
          <span>This page link is no longer valid.</span> <Link to={base}>First page</Link>
        </div>
      )}
      <p className="records-total num">{page ? `${page.total_count.toLocaleString("en-US")} records` : ""}</p>
      <section className="panel">
        <div className="table-frame records-frame" role="region" tabIndex={0} aria-label={`Scroll ${table} records`}>
          <table className="data records" aria-label={`${table} records`}>
            <thead><tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
            <tbody>
              {records.map((record, row) => (
                <tr key={`${cursor}-${row}`}>
                  {columns.map((column, index) => {
                    const value = record[column] === null ? "null" : String(record[column]);
                    return index === 0 ? <th key={column} scope="row">{value}</th> : <td key={column}>{value}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {page && records.length === 0 && <p className="empty"><Discs />This table holds no rows.</p>}
        </div>
        <div className="panel-foot">
          <button type="button" className="btn btn-outline" disabled={!page?.prev_cursor}
            onClick={() => navigate(`${base}?cursor=${encodeURIComponent(page.prev_cursor)}`)}>Previous page</button>
          <button type="button" className="btn btn-outline" disabled={!page?.has_more}
            onClick={() => navigate(`${base}?cursor=${encodeURIComponent(page.next_cursor)}`)}>Next page</button>
          <p role="status" aria-label="Records status" className="status-line">{status}</p>
        </div>
      </section>
    </div>
  );
}
