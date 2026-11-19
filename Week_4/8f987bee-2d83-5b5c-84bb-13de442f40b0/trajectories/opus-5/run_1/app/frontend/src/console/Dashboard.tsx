import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { StatusCell } from "../components/ui";
import { Icon } from "../components/Icon";
import { api } from "../lib/api";
import { figureText, nextRunText, type Schedule } from "../lib/format";
import { useInterval } from "../lib/hooks";
import { useSession } from "../lib/session";

export interface ConnectionRecord {
  id: string;
  name: string;
  status: string;
  version: number;
  source_id: string;
  destination_id: string;
  namespace_prefix: string;
  streams: {
    name: string;
    selected: boolean;
    sync_mode: string;
    cursor_field: string | null;
    primary_key: string[] | null;
    known_fields: string[];
  }[];
  schedule: Schedule;
  schema_change_policy: string;
  next_run_at: string | null;
}

export interface JobRecord {
  id: string;
  connection_id: string;
  status: string;
  records_committed: number;
  failure_reason: string | null;
  started_at: string | null;
  created_at: string;
  per_stream: { stream: string; records_committed: number }[];
}

interface Stats {
  records_synced: number;
  latency_seconds: number | null;
  freshness_seconds: number | null;
}

export function Dashboard(): JSX.Element {
  const session = useSession();
  const navigate = useNavigate();
  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [sources, setSources] = useState<Record<string, string>>({});
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const [latest, setLatest] = useState<Record<string, JobRecord>>({});
  const [stats, setStats] = useState<Stats | null>(null);

  const load = useCallback(async () => {
    const [connectionList, sourceList, destinationList, jobList, figures] = await Promise.all([
      api<{ connections: ConnectionRecord[] }>("GET", "/api/connections"),
      api<{ sources: { id: string; name: string }[] }>("GET", "/api/sources"),
      api<{ destinations: { id: string; name: string }[] }>("GET", "/api/destinations"),
      api<{ jobs: JobRecord[] }>("GET", "/api/jobs?limit=100"),
      api<Stats>("GET", "/api/stats"),
    ]);
    setConnections(connectionList.connections);
    setSources(Object.fromEntries(sourceList.sources.map((source) => [source.id, source.name])));
    setDestinations(
      Object.fromEntries(destinationList.destinations.map((destination) => [destination.id, destination.name])),
    );
    const newest: Record<string, JobRecord> = {};
    for (const job of jobList.jobs) {
      if (!newest[job.connection_id]) newest[job.connection_id] = job;
    }
    setLatest(newest);
    setStats(figures);
  }, []);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);
  useInterval(() => void load().catch(() => undefined), 30000);

  const failing = connections.filter((connection) => latest[connection.id]?.status === "failed").length;
  const mayWrite = session.user?.role === "admin" || session.user?.role === "editor";

  return (
    <>
      <h1>Connections</h1>
      <p className="plain-label">{failing === 0 ? "All syncs healthy" : `${failing} connections need attention`}</p>
      <div className="health-cards">
        <div className="panel health-card">
          <p className="eyebrow">Records synced</p>
          <p className="figure">{stats ? figureText(stats.records_synced) : "—"}</p>
        </div>
        <div className="panel health-card">
          <p className="eyebrow">Latency</p>
          <p className="figure">{stats ? figureText(stats.latency_seconds) : "—"}</p>
        </div>
        <div className="panel health-card">
          <p className="eyebrow">Freshness</p>
          <p className="figure">{stats ? figureText(stats.freshness_seconds) : "—"}</p>
        </div>
      </div>
      <div className="panel">
        <div className="toolbar">
          <h2 style={{ marginRight: "auto" }}>Pipelines</h2>
          {mayWrite ? (
            <button type="button" className="button" onClick={() => navigate("/app/connections/new")}>
              <Icon name="plus" />
              New connection
            </button>
          ) : null}
        </div>
        <div className="row-list">
          {connections.map((connection) => (
            <Link
              key={connection.id}
              to={`/app/connections/${connection.id}`}
              className="row-link"
              aria-label={connection.name}
            >
              <strong>{connection.name}</strong>
              <span>
                {sources[connection.source_id] ?? "—"} → {destinations[connection.destination_id] ?? "—"}
              </span>
              <span>{connection.status}</span>
              <span>
                {latest[connection.id] ? (
                  <StatusCell status={latest[connection.id].status} />
                ) : (
                  "No runs yet"
                )}
              </span>
              <span>{nextRunText(connection.next_run_at, connection.schedule)}</span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
