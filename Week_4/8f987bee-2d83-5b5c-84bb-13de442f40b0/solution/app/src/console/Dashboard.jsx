import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Plus } from "../components/Icons.jsx";
import { api } from "./api.js";
import { useConsole } from "./context.js";
import { nextRun, seconds } from "./format.js";
import StatusChip from "./StatusChip.jsx";

const REFRESH_MS = 30000;

export default function Dashboard() {
  const navigate = useNavigate();
  const { editor, report } = useConsole();
  const [stats, setStats] = useState(null);
  const [connections, setConnections] = useState(null);
  const [names, setNames] = useState({});

  useEffect(() => {
    const load = async () => {
      const [figures, list, sources, destinations] = await Promise.all([
        api("/api/stats"), api("/api/connections"), api("/api/sources"), api("/api/destinations")]);
      if (figures.ok) setStats(figures.body);
      if (list.ok) setConnections(list.body.connections);
      if (sources.ok && destinations.ok) {
        setNames(Object.fromEntries([...sources.body.sources, ...destinations.body.destinations].map((item) => [item.id, item.name])));
      }
      [figures, list].filter((result) => !result.ok).forEach(report);
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [report]);

  const attention = (connections || []).filter((c) => c.last_job_status === "failed").length;
  const cards = [
    ["Records synced", stats ? stats.records_synced.toLocaleString("en-US") : null],
    ["Latency", stats ? seconds(stats.latency_seconds) : null],
    ["Freshness", stats ? seconds(stats.freshness_seconds) : null],
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Connections</h1>
        {editor && (
          <button type="button" className="btn btn-primary" onClick={() => navigate("/app/connections/new")}>
            <Plus width="16" height="16" />New connection
          </button>
        )}
      </div>
      <p className={`monitor ${attention ? "monitor-warn" : ""}`}>
        <span className="status-dot" aria-hidden="true" />
        {connections === null ? "Checking syncs…" : attention ? `${attention} connections need attention` : "All syncs healthy"}
      </p>
      <div className="health">
        {cards.map(([label, value]) => (
          <section className="health-card" key={label} aria-label={label}>
            <h2 className="label">{label}</h2>
            {value === null ? <span className="skeleton" aria-hidden="true" /> : <strong className="figure">{value}</strong>}
          </section>
        ))}
      </div>
      <section className="panel" aria-labelledby="connection-list">
        <h2 id="connection-list" className="panel-title">All connections</h2>
        <div className="table-frame" role="region" tabIndex={0} aria-label="Connections table">
          <table className="data">
            <thead><tr><th scope="col">Connection</th><th scope="col">Source → destination</th><th scope="col">Status</th><th scope="col">Last job</th><th scope="col">Next run</th></tr></thead>
            <tbody>
              {connections === null && <tr><td colSpan="5"><span className="skeleton" aria-hidden="true" /></td></tr>}
              {connections?.length === 0 && <tr><td colSpan="5" className="empty">No connections yet.</td></tr>}
              {connections?.map((c) => (
                <tr key={c.id}>
                  <th scope="row"><Link to={`/app/connections/${c.id}`}>{c.name}</Link></th>
                  <td>{names[c.source_id] ?? "…"}<ArrowRight className="route-arrow" />{names[c.destination_id] ?? "…"}</td>
                  <td><span className={`pill pill-${c.status}`}>{c.status === "active" ? "Active" : "Inactive"}</span></td>
                  <td><StatusChip status={c.last_job_status} /></td>
                  <td className="num">{nextRun(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
