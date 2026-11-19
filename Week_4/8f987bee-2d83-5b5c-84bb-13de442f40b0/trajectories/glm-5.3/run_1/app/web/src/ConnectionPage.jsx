import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, Dialog, Icon, Status, StatusWord, Switch } from "./components.jsx";
import { api, ApiError, localTime, newIdempotencyKey, nextRunText, readToken } from "./api.js";
import { roleAtLeast, useUser } from "./console.jsx";

const OUTAGE = "Wayline couldn't confirm this action. Check the list before trying again.";
const DB_OUTAGE = "Wayline can't reach its database right now. It keeps retrying on its own.";

const MODE_LABELS = {
  full_refresh_overwrite: "Full refresh overwrite",
  full_refresh_append: "Full refresh append",
  incremental_append: "Incremental append",
  incremental_dedup: "Incremental dedup",
};

const FINAL_COPY = {
  succeeded: "Sync succeeded",
  failed: "Sync failed",
  cancelled: "Sync cancelled",
};

function playChime(kind) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const notes = kind === "succeeded" ? [523.25, 783.99] : [783.99, 523.25];
  notes.forEach((freq, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02 + index * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35 + index * 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + index * 0.18);
    osc.stop(ctx.currentTime + 0.4 + index * 0.18);
  });
}

export function ConnectionPage() {
  const { connectionId } = useParams();
  const { user, guard } = useUser();
  const [connection, setConnection] = useState(null);
  const [missing, setMissing] = useState(false);
  const [state, setState] = useState({ tables: {}, stateStreams: [] });
  const [jobs, setJobs] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");
  const [connStatus, setConnStatus] = useState("");
  const [historyStatus, setHistoryStatus] = useState("");
  const [alert, setAlert] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [switchBusy, setSwitchBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [logLines, setLogLines] = useState([]);
  const [names, setNames] = useState({ source: "Source", destination: "Warehouse" });
  const idemKey = useRef(null);
  const versionRef = useRef(null);
  const appliedEnd = useRef(false);
  const syncKey = useRef(null);
  const nextCursorRef = useRef(null);
  const sseRef = useRef(null);
  const knownStreams = useRef({});

  const isEditor = roleAtLeast(user?.role || "viewer", "editor");
  const activeJob = jobs.find((job) => job.status === "pending" || job.status === "running");

  const readConnection = useCallback(async () => {
    try {
      const [connRes, stateRes] = await Promise.all([
        api(`/api/connections/${connectionId}`),
        api(`/api/connections/${connectionId}/state`),
      ]);
      const conn = connRes.data.connection;
      versionRef.current = conn.version;
      const versionHeader = connRes.response.headers.get("etag");
      if (versionHeader) versionRef.current = Number(versionHeader.replace(/"/g, ""));
      setConnection(conn);
      setState((current) => ({ ...current, stateStreams: stateRes.data.streams }));
      const [sourcesRes, destinationsRes] = await Promise.all([
        api("/api/sources"), api("/api/destinations"),
      ]);
      const source = sourcesRes.data.sources.find((entry) => entry.id === conn.source_id);
      const destination = destinationsRes.data.destinations
        .find((entry) => entry.id === conn.destination_id);
      setNames({
        source: source ? source.name : "Source",
        destination: destination ? destination.name : "Warehouse",
      });
      return conn;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
        setMissing(true);
      }
      return null;
    }
  }, [connectionId]);

  const readTables = useCallback(async (conn) => {
    if (!conn) return;
    try {
      const { data } = await api(`/api/destinations/${conn.destination_id}/tables`);
      const map = {};
      data.tables.forEach((table) => { map[table.name] = table.row_count; });
      setState((current) => ({ ...current, tables: map }));
    } catch {
      /* tables stay as they were */
    }
  }, []);

  const readJobs = useCallback(async () => {
    try {
      const { data } = await api(`/api/jobs?connection_id=${connectionId}&limit=10`);
      setJobs((current) => {
        const byId = new Map();
        const merged = [...current, ...data.jobs].reduce((acc, job) => {
          const existing = byId.get(job.id);
          if (!existing) {
            byId.set(job.id, job);
            acc.push(job);
          } else {
            Object.assign(existing, job);
          }
          return acc;
        }, []);
        merged.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        return merged;
      });
      nextCursorRef.current = data.next_cursor;
      setHasMore(data.has_more);
    } catch {
      /* history stays as it was */
    }
  }, [connectionId]);

  const applyJobEnd = useCallback(async (jobId) => {
    if (appliedEnd.current === jobId) return;
    appliedEnd.current = jobId;
    const [jobRes, conn] = await Promise.all([api(`/api/jobs/${jobId}`), readConnection()]);
    await readTables(conn);
    await api(`/api/connections/${connectionId}/state`).then(({ data }) => {
      setState((current) => ({ ...current, stateStreams: data.streams }));
    }).catch(() => {});
    const job = jobRes.data.job;
    setJobs((current) => current.map((entry) => (entry.id === jobId ? job : entry)));
    setSyncStatus(FINAL_COPY[job.status] || "");
    if (user?.preferences?.sync_sounds
        && ["succeeded", "failed", "cancelled"].includes(job.status)) {
      playChime(job.status === "succeeded" ? "succeeded" : "fall");
    }
  }, [connectionId, readConnection, readTables, user?.preferences?.sync_sounds]);

  useEffect(() => {
    let active = true;
    (async () => {
      const conn = await readConnection();
      if (!conn) return;
      await readTables(conn);
      await readJobs();
      setHistoryStatus(`Showing ${Math.min(10, 1)} jobs`);
    })();
    const timer = window.setInterval(async () => {
      await readJobs();
      setJobs((current) => {
        setHistoryStatus(`Showing ${current.length} jobs`);
        return current;
      });
    }, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [readConnection, readTables, readJobs, connectionId]);

  useEffect(() => {
    setJobs([]);
    appliedEnd.current = false;
    setLogLines([]);
  }, [connectionId]);

  const openStream = useCallback((job) => {
    if (!job) return;
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    const token = readToken();
    const source = new EventSource(`/api/jobs/${job.id}/events?token=${encodeURIComponent(token)}`);
    sseRef.current = source;
    source.addEventListener("log", (event) => {
      const line = JSON.parse(event.data);
      setLogLines((current) => {
        if (current.some((existing) => existing.seq === line.seq)) return current;
        return [...current, line].sort((a, b) => a.seq - b.seq);
      });
    });
    source.addEventListener("status", (event) => {
      const { status } = JSON.parse(event.data);
      source.close();
      sseRef.current = null;
      applyJobEnd(job.id);
    });
    source.onerror = () => {
      source.close();
      sseRef.current = null;
      window.setTimeout(() => {
        api(`/api/jobs/${job.id}`).then(({ data }) => {
          if (["succeeded", "failed", "cancelled"].includes(data.job.status)) {
            applyJobEnd(job.id);
          } else {
            openStream(data.job);
          }
        }).catch(() => {});
      }, 600);
    };
  }, [applyJobEnd]);

  useEffect(() => {
    if (activeJob && activeJob.id !== syncKey.current) {
      syncKey.current = activeJob.id;
      openStream(activeJob);
    }
    if (!activeJob) {
      syncKey.current = null;
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
    }
  }, [activeJob?.id, openStream]);

  useEffect(() => () => {
    if (sseRef.current) sseRef.current.close();
  }, []);

  const syncNow = async () => {
    if (!idemKey.current) idemKey.current = newIdempotencyKey();
    setSyncBusy(true);
    setAlert("");
    setSyncStatus("Starting sync…");
    try {
      const { data } = await api(`/api/connections/${connectionId}/sync`, {
        method: "POST",
        body: {},
        headers: { "Idempotency-Key": idemKey.current },
      });
      idemKey.current = null;
      appliedEnd.current = false;
      setSyncStatus("Sync running");
      await readJobs();
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) {
        setAlert(OUTAGE);
        setSyncStatus("");
        return;
      }
      if (error instanceof ApiError && error.status >= 500 && error.status !== 503) {
        setAlert(OUTAGE);
        setSyncStatus("");
        return;
      }
      if (error instanceof ApiError && error.status === 409
          && error.code === "sync_already_running") {
        setSyncStatus("A sync is already running for this connection.");
        return;
      }
      if (error instanceof ApiError && error.status === 409
          && error.code === "connection_inactive") {
        setSyncStatus("This connection is paused. Turn it on to sync.");
        return;
      }
      if (error instanceof ApiError && error.status === 503) {
        setAlert(DB_OUTAGE);
        setSyncStatus("");
        return;
      }
      setAlert(OUTAGE);
      setSyncStatus("");
    } finally {
      setSyncBusy(false);
    }
  };

  const cancelJob = async () => {
    if (!activeJob) return;
    setSyncBusy(true);
    setSyncStatus("Cancelling…");
    try {
      await api(`/api/jobs/${activeJob.id}/cancel`, { method: "POST", body: {} });
      setSyncStatus("Sync cancelled");
      appliedEnd.current = activeJob.id;
      await readJobs();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setSyncStatus("This job has already finished.");
      } else {
        setAlert(error instanceof ApiError && error.status === 503 ? DB_OUTAGE : OUTAGE);
      }
      setSyncStatus("This job has already finished.");
    } finally {
      setSyncBusy(false);
    }
  };

  const reset = async () => {
    setResetOpen(false);
    setSyncStatus("Resetting…");
    try {
      await api(`/api/connections/${connectionId}/reset`, { method: "POST", body: {} });
      const conn = await readConnection();
      await readTables(conn);
      await api(`/api/connections/${connectionId}/state`).then(({ data }) => {
        setState((current) => ({ ...current, stateStreams: data.streams }));
      });
      setSyncStatus("Connection reset");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setSyncStatus("A sync is already running for this connection.");
      } else {
        setAlert(error instanceof ApiError && error.status === 503 ? DB_OUTAGE : OUTAGE);
        setSyncStatus("");
      }
    }
  };

  const toggleActive = async (next) => {
    setSwitchBusy(true);
    setConnStatus("Saving…");
    const wanted = next;
    try {
      const { data } = await api(`/api/connections/${connectionId}`, {
        method: "PATCH",
        body: { status: wanted ? "active" : "inactive" },
        headers: { "If-Match": `"${versionRef.current}"` },
      });
      versionRef.current = data.connection.version;
      setConnection(data.connection);
      setConnStatus(wanted ? "Connection turned on" : "Connection turned off");
    } catch (error) {
      await readConnection();
      if (error instanceof ApiError && error.status === 412) {
        setConnStatus("This connection changed since you opened it. Showing the latest version.");
      } else if (error instanceof ApiError && error.status === 503) {
        setAlert(DB_OUTAGE);
        setConnStatus("");
      } else if (error instanceof ApiError && error.status === 403) {
        setAlert("You don't have permission to do that.");
        setConnStatus("");
      } else {
        setAlert(OUTAGE);
        setConnStatus("");
      }
    } finally {
      setSwitchBusy(false);
    }
  };

  const loadOlder = async () => {
    if (!nextCursorRef.current) return;
    try {
      const { data } = await api(
        `/api/jobs?connection_id=${connectionId}&limit=10&cursor=${encodeURIComponent(nextCursorRef.current)}`);
      nextCursorRef.current = data.next_cursor;
      setHasMore(data.has_more);
      setJobs((current) => {
        const seen = new Set(current.map((job) => job.id));
        const merged = [...current];
        data.jobs.forEach((job) => {
          if (!seen.has(job.id)) {
            seen.add(job.id);
            merged.push(job);
          } else {
            const index = merged.findIndex((entry) => entry.id === job.id);
            if (index >= 0) merged[index] = job;
          }
        });
        merged.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        setHistoryStatus(`Showing ${merged.length} jobs`);
        return merged;
      });
    } catch {
      setAlert(OUTAGE);
    }
  };

  if (missing) {
    return (
      <div className="not-found">
        <h1>Connection not found</h1>
        <Link to="/app" className="btn btn-outline">Back to connections</Link>
      </div>
    );
  }

  if (!connection) {
    return <p className="status-line" role="status" aria-live="polite">Loading…</p>;
  }

  const sourceName = names.source;
  const destinationName = names.destination;
  const running = Boolean(activeJob);

  return (
    <div>
      <h1>{connection.name}</h1>
      {alert && <Alert tone="error">{alert}</Alert>}
      <div className="card card-pad" style={{ marginBottom: "1.2rem" }}>
        <div className={`flow ${running ? "flow-running" : ""}`} role="img"
          aria-label={`Data flow from ${sourceName} to ${destinationName}`}>
          <span className="flow-node">
            <span className="flow-name">Source</span>
            <span className="flow-sub">Streams</span>
          </span>
          <svg className="flow-link" viewBox="0 0 74 34" aria-hidden="true">
            <path d="M2 17 H 72" stroke="currentColor" strokeWidth="2" />
          </svg>
          <span className="flow-node flow-hub">
            <span className="flow-name">Wayline</span>
            <span className="flow-sub">One sync</span>
          </span>
          <svg className="flow-link" viewBox="0 0 74 34" aria-hidden="true">
            <path d="M2 17 H 72" stroke="currentColor" strokeWidth="2" />
          </svg>
          <span className={`flow-node ${running ? "" : ""}`}>
            <span className="flow-name">Warehouse</span>
            <span className="flow-sub">Stored tables</span>
          </span>
        </div>
      </div>
      <div className="conn-split">
        <div>
          <div className="card card-pad" style={{ marginBottom: "1.2rem" }}>
            <p style={{ margin: 0 }}>
              <StatusWord status={connection.status} />
            </p>
            {isEditor && (
              <div style={{ marginTop: "0.8rem" }}>
                <Switch id="connection-active" label="Connection active"
                  checked={connection.status === "active"}
                  disabled={switchBusy}
                  onChange={toggleActive} />
              </div>
            )}
            <p style={{ marginTop: "0.9rem", marginBottom: 0 }}>
              Next run: {nextRunText(connection.next_run_at, connection.schedule?.time_zone)}
            </p>
            <p style={{ marginBottom: 0, color: "var(--muted)", fontSize: "0.9rem" }}>
              Schedule: {scheduleLabel(connection.schedule)}
            </p>
            <div style={{ display: "flex", gap: "0.6rem", marginTop: "1.2rem", flexWrap: "wrap" }}>
              {isEditor && (
                <>
                  <button type="button" className="btn btn-primary" onClick={syncNow}
                    disabled={syncBusy || running}>
                    Sync now
                  </button>
                  {running && (
                    <button type="button" className="btn btn-danger" onClick={cancelJob}
                      disabled={syncBusy}>
                      Cancel
                    </button>
                  )}
                  <button type="button" className="btn btn-outline" onClick={() => setResetOpen(true)}>
                    Reset
                  </button>
                </>
              )}
            </div>
            <Status name="Connection status" message={connStatus} id="connection-status" />
            <Status name="Sync status" message={syncStatus} id="sync-status" />
          </div>
          <div className="card card-pad">
            <h2 style={{ fontSize: "1.1rem" }}>Streams</h2>
            <div className="table-scroll">
            <table className="table">
              <caption className="visually-hidden">Streams</caption>
              <thead>
                <tr>
                  <th scope="col">Stream</th>
                  <th scope="col">Sync mode</th>
                  <th scope="col">Rows</th>
                  <th scope="col">Cursor</th>
                </tr>
              </thead>
              <tbody>
                {connection.streams.filter((stream) => stream.selected).map((stream) => {
                  const table = `${connection.namespace_prefix}${stream.name}`;
                  const rows = state.tables[table];
                  const cursor = state.stateStreams.find((s) => s.name === stream.name)?.cursor_value;
                  return (
                    <tr key={stream.name}>
                      <th scope="row">{stream.name}</th>
                      <td>{MODE_LABELS[stream.sync_mode]}</td>
                      <td className="num">{rows === undefined ? "—" : rows}</td>
                      <td>{cursor ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        </div>
        <div>
          <div className="card card-pad">
            <h2 style={{ fontSize: "1.1rem" }}>Job history</h2>
            <div className="table-scroll">
            <table className="table">
              <caption className="visually-hidden">Job history</caption>
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Status</th>
                  <th scope="col">Started</th>
                  <th scope="col">Records</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <th scope="row">Job {job.id.slice(0, 8)}</th>
                    <td><StatusWord status={job.status} /></td>
                    <td>{job.started_at ? localTime(job.started_at) : ""}</td>
                    <td className="num">{job.records_committed}</td>
                    <td>{job.failure_reason || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            {hasMore && (
              <button type="button" className="btn btn-outline btn-sm" onClick={loadOlder}>
                Load older jobs
              </button>
            )}
            <Status name="Job history status" message={historyStatus} id="job-history-status" />
          </div>
          <div className="log-panel" style={{ marginTop: "1.2rem" }} role="log"
            aria-label="Live log" aria-live="polite">
            <div className="log-dots" aria-hidden="true"><span /><span /><span /></div>
            {logLines.length === 0 && <span className="log-line">No lines yet.</span>}
            {logLines.map((line) => (
              <span className={`log-line ${line.level === "error" ? "log-error" : ""}`} key={line.seq}>
                <span className="log-time">{localTime(line.at)}</span>
                {line.message}
              </span>
            ))}
          </div>
        </div>
      </div>
      {resetOpen && (
        <Dialog title="Reset connection"
          description="Empty the warehouse tables this connection created and clear its cursors?"
          labelledBy="reset-dialog-title" onClose={() => setResetOpen(false)}>
          <div className="dialog-actions">
            <button type="button" className="btn btn-danger" onClick={reset}>Reset tables</button>
            <button type="button" className="btn btn-outline" onClick={() => setResetOpen(false)}>
              Keep tables
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function scheduleLabel(schedule) {
  if (!schedule) return "Manual";
  if (schedule.type === "manual") return "Manual";
  if (schedule.type === "interval") return `Every ${schedule.interval_minutes} minutes`;
  return `Cron ${schedule.cron_expression} (${schedule.time_zone || "UTC"})`;
}
