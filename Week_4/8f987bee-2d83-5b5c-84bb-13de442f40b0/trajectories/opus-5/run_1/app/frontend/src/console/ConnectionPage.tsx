import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Dialog, LiveStatus, StatusCell, Switch } from "../components/ui";
import { FlowDiagram } from "./FlowDiagram";
import type { ConnectionRecord, JobRecord } from "./Dashboard";
import { api, readToken, RequestError } from "../lib/api";
import { CONNECTION_INACTIVE_COPY, SYNC_RUNNING_COPY, VERSION_MISMATCH_COPY } from "../lib/copy";
import { localTime, nextRunText, scheduleText, SYNC_MODE_LABELS } from "../lib/format";
import { useInterval } from "../lib/hooks";
import { useIntentKey } from "../lib/intent";
import { useSession } from "../lib/session";
import { useRefusalAlert } from "./Shell";
import { playChime } from "../lib/sounds";

interface LogLine {
  position: number;
  level: string;
  message: string;
}

interface StreamState {
  name: string;
  cursor_field: string | null;
  cursor_value: string | null;
}

const ACTIVE = ["pending", "running"];
const PAGE_SIZE = 10;

function sortJobs(jobs: JobRecord[]): JobRecord[] {
  return [...jobs].sort((left, right) => {
    if (left.created_at === right.created_at) return left.id < right.id ? 1 : -1;
    return left.created_at < right.created_at ? 1 : -1;
  });
}

export function ConnectionPage(): JSX.Element {
  const { connectionId = "" } = useParams();
  const session = useSession();
  const mayWrite = session.user?.role === "admin" || session.user?.role === "editor";
  const [connection, setConnection] = useState<ConnectionRecord | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [missing, setMissing] = useState(false);
  const [names, setNames] = useState({ source: "", destination: "" });
  const [tableRows, setTableRows] = useState<Record<string, number>>({});
  const [cursors, setCursors] = useState<Record<string, string | null>>({});
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [syncMessage, setSyncMessage] = useState("");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [historyMessage, setHistoryMessage] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [togglePending, setTogglePending] = useState(false);
  const [syncPending, setSyncPending] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const [justFinished, setJustFinished] = useState(false);
  const syncKey = useIntentKey();
  const alertFor = useRefusalAlert();
  const phase = useRef(0);
  const watched = useRef<string | null>(null);
  const endingHandled = useRef<Set<string>>(new Set());
  const resetButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);

  const readConnection = useCallback(async () => {
    try {
      const answer = await api<{ connection: ConnectionRecord }>("GET", `/api/connections/${connectionId}`, {
        onHeaders: (headers) => {
          const tag = headers.get("ETag");
          if (tag) setVersion(Number(tag.replaceAll('"', "")));
        },
      });
      setConnection(answer.connection);
      const [source, destination] = await Promise.all([
        api<{ source: { name: string } }>("GET", `/api/sources/${answer.connection.source_id}`),
        api<{ destinations: { id: string; name: string }[] }>("GET", "/api/destinations"),
      ]);
      setNames({
        source: source.source.name,
        destination:
          destination.destinations.find((entry) => entry.id === answer.connection.destination_id)?.name ?? "",
      });
      return answer.connection;
    } catch (error) {
      if ((error as RequestError).status === 404) setMissing(true);
      return null;
    }
  }, [connectionId]);

  const readFigures = useCallback(
    async (target: ConnectionRecord) => {
      const [tables, state] = await Promise.all([
        api<{ tables: { name: string; row_count: number }[] }>(
          "GET",
          `/api/destinations/${target.destination_id}/tables`,
        ),
        api<{ streams: StreamState[] }>("GET", `/api/connections/${target.id}/state`),
      ]);
      return {
        rows: Object.fromEntries(tables.tables.map((table) => [table.name, table.row_count])),
        cursors: Object.fromEntries(state.streams.map((stream) => [stream.name, stream.cursor_value])),
      };
    },
    [],
  );

  const readHistory = useCallback(async () => {
    const answer = await api<{ jobs: JobRecord[]; next_cursor: string | null; has_more: boolean }>(
      "GET",
      `/api/jobs?connection_id=${connectionId}&limit=${PAGE_SIZE}`,
    );
    setJobs((held) => {
      const merged = new Map(held.map((job) => [job.id, job]));
      for (const job of answer.jobs) merged.set(job.id, job);
      return sortJobs([...merged.values()]);
    });
    if (olderCursor === null) {
      setOlderCursor(answer.next_cursor);
      setHasMore(answer.has_more);
    }
    return answer.jobs;
  }, [connectionId, olderCursor]);

  useEffect(() => {
    void (async () => {
      const target = await readConnection();
      if (!target) return;
      const figures = await readFigures(target);
      setTableRows(figures.rows);
      setCursors(figures.cursors);
      await readHistory().catch(() => undefined);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  useEffect(() => {
    setHistoryMessage(`Showing ${jobs.length} jobs`);
  }, [jobs.length]);

  const applyJobEnd = useCallback(
    async (jobId: string, status: string) => {
      if (endingHandled.current.has(jobId)) return;
      endingHandled.current.add(jobId);
      const target = connection ?? (await readConnection());
      if (!target) return;
      const [job, figures] = await Promise.all([
        api<{ job: JobRecord }>("GET", `/api/jobs/${jobId}`),
        readFigures(target),
      ]);
      const copy =
        status === "succeeded" ? "Sync succeeded" : status === "failed" ? "Sync failed" : "Sync cancelled";
      setJobs((held) => {
        const merged = new Map(held.map((entry) => [entry.id, entry]));
        merged.set(job.job.id, job.job);
        return sortJobs([...merged.values()]);
      });
      setTableRows(figures.rows);
      setCursors(figures.cursors);
      if (phase.current === 2) {
        phase.current = 3;
        setSyncMessage(copy);
      }
      setJustFinished(true);
      if (session.user?.preferences.sync_sounds) {
        playChime(status as "succeeded" | "failed" | "cancelled");
      }
    },
    [connection, readConnection, readFigures, session.user?.preferences.sync_sounds],
  );

  const activeJob = jobs.find((job) => ACTIVE.includes(job.status)) ?? null;

  useEffect(() => {
    if (activeJob === null || watched.current === activeJob.id) return;
    watched.current = activeJob.id;
    setLines([]);
    const token = readToken();
    const stream = new EventSource(`/api/jobs/${activeJob.id}/events?token=${encodeURIComponent(token ?? "")}`);
    stream.addEventListener("log", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { level: string; message: string };
      const position = Number((event as MessageEvent).lastEventId);
      setLines((held) =>
        held.some((line) => line.position === position)
          ? held
          : [...held, { position, level: payload.level, message: payload.message }].sort(
              (left, right) => left.position - right.position,
            ),
      );
      if (phase.current === 1) {
        phase.current = 2;
        setSyncMessage("Sync running");
      }
    });
    stream.addEventListener("status", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { status: string };
      stream.close();
      watched.current = null;
      void applyJobEnd(activeJob.id, payload.status);
    });
    return () => stream.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob?.id]);

  useInterval(() => {
    if (missing) return;
    const before = new Map(jobs.map((job) => [job.id, job.status]));
    void readHistory()
      .then((page) => {
        for (const job of page) {
          const wasActive = ACTIVE.includes(before.get(job.id) ?? "pending");
          if (!ACTIVE.includes(job.status) && wasActive && !endingHandled.current.has(job.id)) {
            void applyJobEnd(job.id, job.status);
          }
        }
      })
      .catch(() => undefined);
  }, 5000);

  useEffect(() => {
    if (!justFinished) return;
    const timer = window.setTimeout(() => setJustFinished(false), 1200);
    return () => window.clearTimeout(timer);
  }, [justFinished]);

  const syncNow = async () => {
    setSyncPending(true);
    phase.current = 1;
    setSyncMessage("Starting sync…");
    try {
      const answer = await api<{ job: JobRecord }>("POST", `/api/connections/${connectionId}/sync`, {
        body: {},
        idempotencyKey: syncKey.key(),
      });
      syncKey.answered();
      endingHandled.current.delete(answer.job.id);
      setJobs((held) => sortJobs([answer.job, ...held.filter((job) => job.id !== answer.job.id)]));
      if (!ACTIVE.includes(answer.job.status)) {
        phase.current = 2;
        void applyJobEnd(answer.job.id, answer.job.status);
      }
    } catch (error) {
      const refusal = error as RequestError;
      syncKey.keepForRetry(refusal);
      phase.current = 0;
      if (refusal.code === "sync_already_running") setSyncMessage(SYNC_RUNNING_COPY);
      else if (refusal.code === "connection_inactive") setSyncMessage(CONNECTION_INACTIVE_COPY);
      else setSyncMessage(alertFor(refusal) ?? SYNC_RUNNING_COPY);
    } finally {
      setSyncPending(false);
    }
  };

  const cancel = async () => {
    if (!activeJob) return;
    setCancelPending(true);
    setSyncMessage("Cancelling…");
    try {
      await api<{ job: JobRecord }>("POST", `/api/jobs/${activeJob.id}/cancel`, { body: {} });
    } catch (error) {
      const refusal = error as RequestError;
      if (refusal.code === "job_not_active") setSyncMessage("This job has already finished.");
      else setSyncMessage(alertFor(refusal) ?? "This job has already finished.");
    } finally {
      setCancelPending(false);
    }
  };

  const reset = async () => {
    setResetPending(true);
    setSyncMessage("Resetting…");
    try {
      await api<{ connection: ConnectionRecord }>("POST", `/api/connections/${connectionId}/reset`, { body: {} });
      setDialogOpen(false);
      window.setTimeout(() => resetButton.current?.focus(), 0);
      const target = connection;
      if (target) {
        const figures = await readFigures(target);
        setTableRows(figures.rows);
        setCursors(figures.cursors);
      }
      setSyncMessage("Connection reset");
    } catch (error) {
      const refusal = error as RequestError;
      setDialogOpen(false);
      window.setTimeout(() => resetButton.current?.focus(), 0);
      if (refusal.code === "sync_already_running") setSyncMessage(SYNC_RUNNING_COPY);
      else setSyncMessage(alertFor(refusal) ?? SYNC_RUNNING_COPY);
    } finally {
      setResetPending(false);
    }
  };

  const toggleActive = async (next: boolean) => {
    setTogglePending(true);
    setConnectionMessage("Saving…");
    try {
      const answer = await api<{ connection: ConnectionRecord }>("PATCH", `/api/connections/${connectionId}`, {
        body: { status: next ? "active" : "inactive" },
        ifMatch: `"${version}"`,
        onHeaders: (headers) => {
          const tag = headers.get("ETag");
          if (tag) setVersion(Number(tag.replaceAll('"', "")));
        },
      });
      setConnection(answer.connection);
      setConnectionMessage(next ? "Connection turned on" : "Connection turned off");
    } catch (error) {
      const refusal = error as RequestError;
      await readConnection();
      if (refusal.code === "version_mismatch") setConnectionMessage(VERSION_MISMATCH_COPY);
      else setConnectionMessage(alertFor(refusal) ?? VERSION_MISMATCH_COPY);
    } finally {
      setTogglePending(false);
    }
  };

  const loadOlder = async () => {
    if (!olderCursor) return;
    const answer = await api<{ jobs: JobRecord[]; next_cursor: string | null; has_more: boolean }>(
      "GET",
      `/api/jobs?connection_id=${connectionId}&limit=${PAGE_SIZE}&cursor=${encodeURIComponent(olderCursor)}`,
    );
    setJobs((held) => {
      const merged = new Map(held.map((job) => [job.id, job]));
      for (const job of answer.jobs) merged.set(job.id, job);
      return sortJobs([...merged.values()]);
    });
    setOlderCursor(answer.next_cursor);
    setHasMore(answer.has_more);
  };

  if (missing) {
    return (
      <>
        <h1>Connection not found</h1>
        <Link to="/app">Back to connections</Link>
      </>
    );
  }

  if (!connection) return <p>Loading connection…</p>;

  const selected = connection.streams.filter((stream) => stream.selected);

  return (
    <>
      <h1>{connection.name}</h1>
      <div className="panel">
        <FlowDiagram
          sourceName={names.source}
          destinationName={names.destination}
          running={activeJob?.status === "running"}
          justFinished={justFinished}
        />
        <dl className="summary-grid">
          <div>
            <dt>Status</dt>
            <dd>{connection.status}</dd>
          </div>
          <div>
            <dt>Next run</dt>
            <dd>{nextRunText(connection.next_run_at, connection.schedule)}</dd>
          </div>
          <div>
            <dt>Schedule</dt>
            <dd>{scheduleText(connection.schedule)}</dd>
          </div>
          <div>
            <dt>Namespace</dt>
            <dd>{connection.namespace_prefix}</dd>
          </div>
        </dl>
        {mayWrite ? (
          <div className="button-row">
            <Switch
              label="Connection active"
              checked={connection.status === "active"}
              disabled={togglePending}
              onChange={(next) => void toggleActive(next)}
            />
            <button type="button" className="button" disabled={syncPending} onClick={() => void syncNow()}>
              Sync now
            </button>
            {activeJob ? (
              <button
                type="button"
                className="button outline"
                disabled={cancelPending}
                onClick={() => void cancel()}
              >
                Cancel
              </button>
            ) : null}
            <button
              type="button"
              className="button outline"
              ref={resetButton}
              onClick={() => setDialogOpen(true)}
            >
              Reset
            </button>
          </div>
        ) : null}
        <LiveStatus name="Sync status" message={syncMessage} />
        <LiveStatus name="Connection status" message={connectionMessage} />
      </div>

      <div className="panel">
        <h2>Streams</h2>
        <table className="data-table" aria-label="Streams">
          <thead>
            <tr>
              <th scope="col">Stream</th>
              <th scope="col">Sync mode</th>
              <th scope="col">Rows</th>
              <th scope="col">Cursor</th>
            </tr>
          </thead>
          <tbody>
            {selected.map((stream) => {
              const table = connection.namespace_prefix + stream.name;
              const rows = tableRows[table];
              return (
                <tr key={stream.name}>
                  <th scope="row">{stream.name}</th>
                  <td>{SYNC_MODE_LABELS[stream.sync_mode]}</td>
                  <td className="numeric">{rows === undefined ? "—" : rows}</td>
                  <td className="numeric">{cursors[stream.name] ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="connection-lower">
        <div className="panel">
          <h2>Job history</h2>
          <table className="data-table" aria-label="Job history">
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
                  <th scope="row">{`Job ${job.id.slice(0, 8)}`}</th>
                  <td>
                    <StatusCell status={job.status} />
                  </td>
                  <td>{localTime(job.started_at)}</td>
                  <td className="numeric">{job.records_committed}</td>
                  <td>{job.failure_reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasMore ? (
            <button type="button" className="button outline" onClick={() => void loadOlder()}>
              Load older jobs
            </button>
          ) : null}
          <LiveStatus name="Job history status" message={historyMessage} />
        </div>
        <div className="panel">
          <h2>Live log</h2>
          <ul className="live-log" role="log" aria-label="Live log" aria-live="polite">
            {lines.map((line) => (
              <li key={line.position}>{line.message}</li>
            ))}
          </ul>
        </div>
      </div>

      {dialogOpen ? (
        <Dialog
          name="Reset connection"
          kind="alertdialog"
          initialFocus={keepButton}
          onClose={() => {
            setDialogOpen(false);
            window.setTimeout(() => resetButton.current?.focus(), 0);
          }}
        >
          <h2>Reset connection</h2>
          <p>
            Resetting empties this connection's tables and clears its cursors. The job history stays as it
            is.
          </p>
          <div className="dialog-actions">
            <button type="button" className="button" disabled={resetPending} onClick={() => void reset()}>
              Reset tables
            </button>
            <button
              type="button"
              className="button outline"
              ref={keepButton}
              onClick={() => {
                setDialogOpen(false);
                window.setTimeout(() => resetButton.current?.focus(), 0);
              }}
            >
              Keep tables
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
