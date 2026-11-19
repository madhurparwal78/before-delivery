import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ExportJson } from "../../../server/exports.js";
import { TABLE_FIELDS } from "../../../shared/fields.js";
import { TABLE_LABELS, TABLES, type Table } from "../../../shared/types.js";
import { ApiFailure, failureText, get, post } from "../../lib/api.js";
import { useAnnounce } from "../../lib/announce.js";
import { useTopics } from "../../lib/live.js";
import { Button, Field, Page, Rest, StatusBlock } from "../../lib/ui.js";

const STORE_KEY = "switchyard.exports";
const KEEP = 5;
const POLL_MS = 2000;
const STATUS_WORDS: Record<ExportJson["status"], string> = { queued: "Queued", running: "Running", storing: "Storing", complete: "Complete", failed: "Failed" };

function readIds(): number[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === "number").slice(0, KEEP) : [];
  } catch {
    return [];
  }
}

function ExportJob({ id, seed }: { id: number; seed: ExportJson | null }): JSX.Element {
  const announce = useAnnounce();
  const [job, setJob] = useState<ExportJson | null>(seed);
  const [problem, setProblem] = useState("");
  const [retrying, setRetrying] = useState(false);
  const seen = useRef<ExportJson["status"] | null>(seed?.status ?? null);
  const complete = job?.status === "complete";

  const refresh = (): void => {
    get<{ export: ExportJson }>(`/api/exports/${id}`).then(
      ({ export: next }) => {
        if (seen.current !== null && seen.current !== next.status) {
          if (next.status === "complete") announce(`Export complete: ${next.rows_total} rows.`);
          if (next.status === "failed") announce("Export failed: file storage is unreachable.");
        }
        seen.current = next.status;
        setProblem("");
        setJob(next);
      },
      (error: unknown) => setProblem(failureText(error)),
    );
  };
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    latest.current();
  }, [id]);
  useEffect(() => {
    if (complete) return undefined;
    const timer = setInterval(() => latest.current(), POLL_MS);
    return () => clearInterval(timer);
  }, [id, complete]);
  useTopics([`export:${id}`], () => latest.current());

  const retry = (): void => {
    if (retrying) return;
    setRetrying(true);
    setProblem("");
    post<{ export: ExportJson }>(`/api/exports/${id}/retry`).then(
      ({ export: next }) => {
        seen.current = next.status;
        setJob(next);
        setRetrying(false);
      },
      (error: unknown) => {
        const text = failureText(error);
        setProblem(text);
        announce(text);
        setRetrying(false);
      },
    );
  };

  if (!job) return <p className="muted">{problem || `Loading export ${id}...`}</p>;
  const percent = job.status === "complete" ? 100 : job.rows_total > 0 ? Math.min(100, (job.rows_done / job.rows_total) * 100) : 0;
  const progressText = `${job.rows_done} of ${job.rows_total} rows`;
  return (
    <div className="stack job">
      <div className="row">
        <h3>Export {id}</h3>
        <StatusBlock outlined={job.status !== "complete" && job.status !== "failed"}>{STATUS_WORDS[job.status]}</StatusBlock>
      </div>
      <div className="progress" role="progressbar" aria-label="Export progress" aria-valuemin={0} aria-valuemax={Math.max(job.rows_total, 1)} aria-valuenow={job.rows_done} aria-valuetext={progressText}>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${percent}%` }} />
        </div>
        <p className="progress-text">{progressText}</p>
      </div>
      {complete ? <p className="job-line">Export complete: {job.rows_total} rows.</p> : null}
      {job.status === "failed" ? <p className="job-line form-error">Export failed: file storage is unreachable.</p> : null}
      {problem ? <p className="form-error">{problem}</p> : null}
      <div className="row">
        {complete ? (
          <a className="btn btn-solid" href={`/api/exports/${id}/file`} download>
            Download export
          </a>
        ) : null}
        {job.status === "failed" ? (
          <Button busy={retrying} aria-disabled={retrying || undefined} onClick={retry}>
            Retry export
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function Exports(): JSX.Element {
  const announce = useAnnounce();
  const [table, setTable] = useState<Table>("incident");
  const [filter, setFilter] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<{ text: string; fields: Record<string, string> } | null>(null);
  const [ids, setIds] = useState<number[]>(readIds);
  const [current, setCurrent] = useState<{ id: number; seed: ExportJson | null } | null>(() => {
    const first = readIds()[0];
    return first === undefined ? null : { id: first, seed: null };
  });

  const start = (event: FormEvent): void => {
    event.preventDefault();
    if (starting) return;
    setStarting(true);
    setFailure(null);
    post<{ export: ExportJson }>("/api/exports", { table, filter, columns }).then(
      ({ export: created }) => {
        const next = [created.id, ...ids.filter((id) => id !== created.id)].slice(0, KEEP);
        sessionStorage.setItem(STORE_KEY, JSON.stringify(next));
        setIds(next);
        setCurrent({ id: created.id, seed: created });
        setStarting(false);
      },
      (error: unknown) => {
        const text = failureText(error);
        setFailure({ text, fields: error instanceof ApiFailure ? (error.fields ?? {}) : {} });
        announce(text);
        setStarting(false);
      },
    );
  };

  const choose = (next: Table): void => {
    setTable(next);
    setColumns([]);
  };
  const toggle = (name: string): void => setColumns((now) => (now.includes(name) ? now.filter((c) => c !== name) : [...now, name]));

  return (
    <Page subject="Exports">
      <Rest narrow>
        <form className="stack" onSubmit={start} aria-label="Start an export">
          <Field label="Table" error={failure?.fields.table}>
            <select value={table} onChange={(event) => choose(event.target.value as Table)}>
              {TABLES.map((name) => (
                <option key={name} value={name}>
                  {TABLE_LABELS[name]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Filter text" error={failure?.fields.filter}>
            <input type="text" value={filter} onChange={(event) => setFilter(event.target.value)} />
          </Field>
          <fieldset className="columns">
            <legend className="field-label">Columns</legend>
            <p className="muted">Leave every column unticked for the default columns.</p>
            <div className="column-grid">
              {TABLE_FIELDS[table].map((spec) => (
                <label key={spec.name} className="check">
                  <input type="checkbox" checked={columns.includes(spec.name)} onChange={() => toggle(spec.name)} />
                  <span>{spec.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {failure ? <p className="form-error">{failure.text}</p> : null}
          <div className="row">
            <Button type="submit" busy={starting} aria-disabled={starting || undefined}>
              Start export
            </Button>
          </div>
        </form>
      </Rest>
      {current ? (
        <Rest narrow label="Export job">
          <ExportJob key={current.id} id={current.id} seed={current.seed} />
        </Rest>
      ) : null}
      {ids.length > 1 ? (
        <Rest narrow label="Exports this session">
          <h3>Started in this session</h3>
          <ul className="session-list">
            {ids.map((id) => (
              <li key={id}>
                <Button variant="outline" aria-current={current?.id === id || undefined} onClick={() => setCurrent({ id, seed: null })}>
                  Show export {id}
                </Button>
              </li>
            ))}
          </ul>
        </Rest>
      ) : null}
    </Page>
  );
}
