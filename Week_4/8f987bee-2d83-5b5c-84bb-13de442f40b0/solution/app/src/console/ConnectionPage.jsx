import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Discs } from "../components/Icons.jsx";
import { useModal } from "../lib/dialog.js";
import { api, outageCopy, PERMISSION } from "./api.js";
import { chime } from "./chime.js";
import { useConsole } from "./context.js";
import FlowDiagram from "./FlowDiagram.jsx";
import { clock, modeLabel, nextRun, scheduleText } from "./format.js";
import JobHistory from "./JobHistory.jsx";
import { session } from "./session.js";
import StatusChip from "./StatusChip.jsx";
import Switch from "./Switch.jsx";
import { useIntent } from "./useIntent.js";

const PAGE = 10;
const REFRESH_MS = 5000;
const ACTIVE = new Set(["pending", "running"]);
const STARTING = "Starting sync…";
const RUNNING = "Sync running";
const ENDED = { succeeded: "Sync succeeded", failed: "Sync failed", cancelled: "Sync cancelled" };
const OUTCOME = Object.fromEntries(Object.entries(ENDED).map(([status, words]) => [words, status]));
const SYNC_REFUSALS = {
  sync_already_running: "A sync is already running for this connection.",
  connection_inactive: "This connection is paused. Turn it on to sync.",
};
const MISMATCH = "This connection changed since you opened it. Showing the latest version.";

const newestFirst = (a, b) => (a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1);

function ResetDialog({ onConfirm, onClose, pending }) {
  const keep = useRef(null);
  const ref = useModal(true, onClose, keep);
  return (
    <dialog ref={ref} role="alertdialog" aria-labelledby="reset-title" aria-describedby="reset-text" className="confirm">
      <h2 id="reset-title">Reset connection</h2>
      <p id="reset-text">Every table this connection wrote is emptied and its cursors clear. The job history stays.</p>
      <div className="form-actions">
        <button ref={keep} type="button" className="btn btn-outline" onClick={onClose}>Keep tables</button>
        <button type="button" className="btn btn-danger" disabled={pending} onClick={onConfirm}>
          {pending ? "Resetting…" : "Reset tables"}
        </button>
      </div>
    </dialog>
  );
}

// The "Streams" table: one row per selected stream in catalog order, with its table's rows and its cursor.
function StreamsTable({ connection, order, figures }) {
  const selected = connection.streams.filter((stream) => stream.selected);
  const rank = (name) => (order.includes(name) ? order.indexOf(name) : order.length);
  selected.sort((a, b) => rank(a.name) - rank(b.name));
  return (
    <div className="table-frame">
      <table className="data" aria-labelledby="streams-title">
        <thead><tr><th scope="col">Stream</th><th scope="col">Sync mode</th><th scope="col">Rows</th><th scope="col">Cursor</th></tr></thead>
        <tbody>
          {selected.map((stream) => {
            const rows = figures?.tables[`${connection.namespace_prefix}${stream.name}`];
            const cursor = figures?.cursors[stream.name];
            return (
              <tr key={stream.name}>
                <th scope="row">{stream.name}</th>
                <td>{modeLabel(stream.sync_mode)}</td>
                <td className="num">{rows === undefined ? "—" : rows.toLocaleString("en-US")}</td>
                {cursor === undefined || cursor === null
                  ? <td className="num">—</td>
                  : <td className="num code">{cursor}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ConnectionPage() {
  const { connectionId } = useParams();
  const location = useLocation();
  const { editor, report, user } = useConsole();
  const intent = useIntent();
  const [connection, setConnection] = useState(null);
  const [missing, setMissing] = useState(false);
  const [names, setNames] = useState({ source: "", destination: "" });
  const [order, setOrder] = useState([]);
  const [figures, setFigures] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [older, setOlder] = useState({ cursor: null, hasMore: false });
  const [followed, setFollowed] = useState(null);
  const [lines, setLines] = useState([]);
  const [syncStatus, setSyncStatus] = useState("");
  const [connectionStatus, setConnectionStatus] = useState(location.state?.announce ?? "");
  const [busy, setBusy] = useState({ sync: false, cancel: false, reset: false, toggle: false });
  const [resetOpen, setResetOpen] = useState(false);
  const [ring, setRing] = useState(0);
  const jobsRef = useRef([]);
  const ending = useRef(new Set());
  const ended = useRef(new Set());
  const press = useRef({ jobId: null, phase: "idle" });
  const loadingOlder = useRef(false);
  const shownLog = useRef({ jobId: null, lastId: 0 });
  const sounds = useRef(false);
  sounds.current = user.preferences.sync_sounds;

  const putJobs = (list) => {
    jobsRef.current = list;
    setJobs(list);
  };

  const readConnection = useCallback(async () => {
    const result = await api(`/api/connections/${connectionId}`);
    if (result.ok) setConnection(result.body.connection);
    else if (result.status === 404) setMissing(true);
    return result;
  }, [connectionId]);

  // The figures the Streams table shows: each table's row count and each stream's cursor, read together.
  const readFigures = useCallback(async (destinationId) => {
    const [tables, state] = await Promise.all([
      api(`/api/destinations/${destinationId}/tables`), api(`/api/connections/${connectionId}/state`)]);
    if (!tables.ok || !state.ok) return null;
    return {
      tables: Object.fromEntries(tables.body.tables.map((t) => [t.name, t.row_count])),
      cursors: Object.fromEntries(state.body.streams.map((s) => [s.name, s.cursor_value])),
    };
  }, [connectionId]);

  // "Sync running" follows "Starting sync…" once, for the job this page's own press started.
  const markRunning = useCallback((jobId) => {
    if (press.current.jobId === jobId && press.current.phase === "starting") {
      press.current.phase = "running";
      setSyncStatus(RUNNING);
    }
  }, []);

  const showLog = useCallback((jobId, all) => {
    shownLog.current = { jobId, lastId: all.length };
    setLines(all);
  }, []);

  // The job-end render: read the job, the destination's tables and the connection's state first, then apply the
  // job row, the "Sync status" copy and every stream's Rows and Cursor in one render.
  const endJob = useCallback(async (jobId) => {
    if (ending.current.has(jobId) || ended.current.has(jobId)) return;
    ending.current.add(jobId);
    const [job, conn] = await Promise.all([api(`/api/jobs/${jobId}`), api(`/api/connections/${connectionId}`)]);
    if (!job.ok || !conn.ok) {
      ending.current.delete(jobId);
      return;
    }
    const [fresh, logs] = await Promise.all([
      readFigures(conn.body.connection.destination_id),
      shownLog.current.jobId === jobId ? api(`/api/jobs/${jobId}/logs`) : null,
    ]);
    const final = job.body.job;
    ending.current.delete(jobId);
    ended.current.add(jobId);
    const byId = new Map(jobsRef.current.map((j) => [j.id, j]));
    byId.set(final.id, final);
    putJobs([...byId.values()].sort(newestFirst));
    setConnection(conn.body.connection);
    if (fresh) setFigures(fresh);
    if (logs?.ok) showLog(jobId, logs.body.lines);
    if (press.current.jobId === jobId) press.current = { jobId, phase: "ended" };
    setSyncStatus(ENDED[final.status]);
    setRing((n) => n + 1);
    if (sounds.current) chime(final.status === "succeeded");
  }, [connectionId, readFigures, showLog]);

  // Rows merge by job id. A job shown as pending or running keeps that row until its job-end render has applied.
  const merge = useCallback((incoming) => {
    const byId = new Map(jobsRef.current.map((job) => [job.id, job]));
    const toEnd = [];
    for (const job of incoming) {
      const shown = byId.get(job.id);
      const final = !ACTIVE.has(job.status);
      if (ended.current.has(job.id)) {
        if (final) byId.set(job.id, job);
      } else if (ending.current.has(job.id) || (shown && ACTIVE.has(shown.status) && final)) {
        toEnd.push(job.id);
      } else {
        byId.set(job.id, job);
        if (job.status === "running") markRunning(job.id);
      }
    }
    putJobs([...byId.values()].sort(newestFirst));
    toEnd.forEach(endJob);
  }, [endJob, markRunning]);

  const follow = useCallback((job) => {
    if (shownLog.current.jobId !== job.id) showLog(job.id, []);
    setFollowed(job.id);
  }, [showLog]);

  const readFirstPage = useCallback(async (initial) => {
    const result = await api(`/api/jobs?connection_id=${connectionId}&limit=${PAGE}`);
    if (!result.ok) return;
    merge(result.body.jobs);
    if (initial) setOlder({ cursor: result.body.next_cursor, hasMore: result.body.has_more });
    const active = result.body.jobs.find((job) => ACTIVE.has(job.status));
    if (active) follow(active);
    else if (initial && result.body.jobs[0]) {
      const logs = await api(`/api/jobs/${result.body.jobs[0].id}/logs`);
      if (logs.ok) showLog(result.body.jobs[0].id, logs.body.lines);
    }
  }, [connectionId, merge, follow, showLog]);

  useEffect(() => {
    let live = true;
    let timer = 0;
    readConnection().then(async (result) => {
      if (!live) return;
      if (!result.ok) {
        if (result.status !== 404) report(result);
        return;
      }
      const { source_id: sourceId, destination_id: destinationId } = result.body.connection;
      readFirstPage(true);
      timer = setInterval(() => readFirstPage(false), REFRESH_MS);
      const [source, destinations, catalog, fresh] = await Promise.all([
        api(`/api/sources/${sourceId}`), api("/api/destinations"), api(`/api/sources/${sourceId}/catalog`), readFigures(destinationId)]);
      setNames({
        source: source.ok ? source.body.source.name : "",
        destination: destinations.ok ? destinations.body.destinations.find((d) => d.id === destinationId)?.name ?? "" : "",
      });
      if (catalog.ok) setOrder(catalog.body.streams.map((s) => s.name));
      setFigures(fresh);
    });
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [readConnection, readFirstPage, readFigures, report]);

  // Follow one job's live events. Each log event carries its line position as its id; a reconnect sends the last
  // one back, and a line at or below the last shown position is never shown twice.
  useEffect(() => {
    if (!followed) return undefined;
    const events = new EventSource(`/api/jobs/${followed}/events?token=${encodeURIComponent(session.get())}`);
    events.addEventListener("log", (event) => {
      const position = Number(event.lastEventId);
      if (shownLog.current.jobId !== followed || position <= shownLog.current.lastId) return;
      shownLog.current.lastId = position;
      setLines((current) => [...current, JSON.parse(event.data)]);
      markRunning(followed);
      // A log line means the job is running: the row reads Running now, not at the next history refresh.
      if (jobsRef.current.find((job) => job.id === followed)?.status === "pending") {
        api(`/api/jobs/${followed}`).then((result) => result.ok && merge([result.body.job]));
      }
    });
    events.addEventListener("status", () => {
      events.close();
      setFollowed(null);
      endJob(followed);
    });
    return () => events.close();
  }, [followed, endJob, markRunning, merge]);

  const syncNow = async () => {
    setBusy((b) => ({ ...b, sync: true }));
    setConnectionStatus("");
    press.current = { jobId: null, phase: "starting" };
    setSyncStatus(STARTING);
    const result = await api(`/api/connections/${connectionId}/sync`, {
      method: "POST", body: {}, headers: { "Idempotency-Key": intent.key() },
    });
    intent.settle(result);
    setBusy((b) => ({ ...b, sync: false }));
    if (result.ok) {
      const { job } = result.body;
      press.current = { jobId: job.id, phase: "starting" };
      if (ACTIVE.has(job.status)) {
        merge([job]);
        follow(job);
      } else {
        endJob(job.id);
      }
      return;
    }
    press.current = { jobId: null, phase: "idle" };
    if (result.outage) {
      setSyncStatus(outageCopy(result));
      report(result);
    } else if (result.status === 403) {
      setSyncStatus(PERMISSION);
      report(result);
    } else {
      setSyncStatus(SYNC_REFUSALS[result.body?.error] ?? "");
    }
  };

  const active = jobs.find((job) => ACTIVE.has(job.status));

  const cancel = async () => {
    setBusy((b) => ({ ...b, cancel: true }));
    setConnectionStatus("");
    press.current = { jobId: active.id, phase: "ended" };
    setSyncStatus("Cancelling…");
    const result = await api(`/api/jobs/${active.id}/cancel`, { method: "POST", body: {} });
    setBusy((b) => ({ ...b, cancel: false }));
    if (result.ok) endJob(result.body.job.id);
    else if (result.body?.error === "job_not_active") setSyncStatus("This job has already finished.");
    else {
      setSyncStatus(result.outage ? outageCopy(result) : PERMISSION);
      report(result);
    }
  };

  const reset = async () => {
    setBusy((b) => ({ ...b, reset: true }));
    setConnectionStatus("");
    setSyncStatus("Resetting…");
    const result = await api(`/api/connections/${connectionId}/reset`, { method: "POST", body: {} });
    if (result.ok) {
      const fresh = await readFigures(result.body.connection.destination_id);
      setConnection(result.body.connection);
      if (fresh) setFigures(fresh);
      setSyncStatus("Connection reset");
    } else if (result.body?.error === "sync_already_running") {
      setSyncStatus(SYNC_REFUSALS.sync_already_running);
      readFirstPage(false);
    } else {
      setSyncStatus(result.outage ? outageCopy(result) : PERMISSION);
      report(result);
    }
    setBusy((b) => ({ ...b, reset: false }));
    setResetOpen(false);
  };

  const toggle = async () => {
    const wanted = connection.status === "active" ? "inactive" : "active";
    setBusy((b) => ({ ...b, toggle: true }));
    setConnectionStatus("Saving…");
    const result = await api(`/api/connections/${connectionId}`, {
      method: "PATCH", body: { status: wanted }, headers: { "If-Match": `"${connection.version}"` },
    });
    if (result.ok) {
      const fresh = await readFigures(result.body.connection.destination_id);
      setConnection(result.body.connection);
      if (fresh) setFigures(fresh);
      setConnectionStatus(wanted === "active" ? "Connection turned on" : "Connection turned off");
    } else {
      await readConnection();
      if (result.body?.error === "version_mismatch") setConnectionStatus(MISMATCH);
      else if (result.outage) setConnectionStatus(outageCopy(result));
      else if (result.status === 403) setConnectionStatus(PERMISSION);
      else setConnectionStatus(SYNC_REFUSALS[result.body?.error] ?? "");
      report(result);
    }
    setBusy((b) => ({ ...b, toggle: false }));
  };

  // "Load older jobs" stays enabled while it reads, so focus never leaves it; a second press waits for the first.
  const loadOlder = async () => {
    if (loadingOlder.current) return;
    loadingOlder.current = true;
    const result = await api(`/api/jobs?connection_id=${connectionId}&limit=${PAGE}&cursor=${encodeURIComponent(older.cursor)}`);
    loadingOlder.current = false;
    if (result.ok) {
      merge(result.body.jobs);
      setOlder({ cursor: result.body.next_cursor, hasMore: result.body.has_more });
    } else report(result);
  };

  if (missing) {
    return (
      <div className="page">
        <div className="empty empty-stacked panel">
          <Discs />
          <h1>Connection not found</h1>
          <p>No connection with this address belongs to your workspace.</p>
          <Link to="/app">Back to connections</Link>
        </div>
      </div>
    );
  }
  if (!connection) return <div className="page"><p className="status-line">Loading connection…</p></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="label eyebrow">Connection</span>
          <h1>{connection.name}</h1>
        </div>
        {editor && (
          <div className="actions">
            <button type="button" className="btn btn-primary" disabled={busy.sync} onClick={syncNow}>Sync now</button>
            {active && <button type="button" className="btn btn-outline" disabled={busy.cancel} onClick={cancel}>Cancel</button>}
            <button type="button" className="btn btn-outline" onClick={() => setResetOpen(true)}>Reset</button>
          </div>
        )}
      </div>
      <p role="status" aria-label="Sync status" className="status-line sync-status">
        {OUTCOME[syncStatus] ? <StatusChip status={OUTCOME[syncStatus]}>{syncStatus}</StatusChip> : syncStatus}
      </p>
      <section className="panel flow-panel" aria-label="Flow">
        <FlowDiagram source={names.source} destination={names.destination}
          running={active?.status === "running"} ring={ring} />
      </section>
      <div className="connection-top">
        <section className="panel" aria-labelledby="summary-title">
          <h2 id="summary-title" className="panel-title">Summary</h2>
          <dl className="summary">
            <div><dt>Status</dt><dd><span className={`pill pill-${connection.status}`}>{connection.status === "active" ? "Active" : "Inactive"}</span></dd></div>
            {editor && (
              <div><dt>On or off</dt><dd>
                <Switch label="Connection active" checked={connection.status === "active"} disabled={busy.toggle} onChange={toggle} />
              </dd></div>
            )}
            <div><dt>Schedule</dt><dd>{scheduleText(connection.schedule)}</dd></div>
            <div><dt>Next run</dt><dd className="num">{nextRun(connection)}</dd></div>
            <div><dt>Version</dt><dd className="num">{connection.version}</dd></div>
          </dl>
          <p role="status" aria-label="Connection status" className="status-line">{connectionStatus}</p>
        </section>
        <section className="panel">
          <h2 id="streams-title" className="panel-title">Streams</h2>
          <StreamsTable connection={connection} order={order} figures={figures} />
        </section>
      </div>
      <div className="connection-bottom">
        <JobHistory jobs={jobs} hasMore={older.hasMore} onLoadOlder={loadOlder} />
        <section className="panel" aria-labelledby="log-title">
          <h2 id="log-title" className="panel-title">Live log</h2>
          <div className="terminal" role="log" aria-label="Live log">
            {lines.length === 0 && <p className="terminal-empty">Logs appear here while a job runs.</p>}
            {lines.map((line, index) => (
              <p key={`${line.at}-${index}`} className={`log-line log-${line.level}`}>
                <time dateTime={line.at}>{clock(line.at)}</time><span>{line.message}</span>
              </p>
            ))}
          </div>
        </section>
      </div>
      {resetOpen && <ResetDialog pending={busy.reset} onConfirm={reset} onClose={() => setResetOpen(false)} />}
    </div>
  );
}
