// Streams: the list, one stream's mapping and uploads, text analysis and the lifecycle timeline.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { timelineText, type NextStep, type Phase } from "../../shared/timeline";
import { parseIsoInstant } from "../../shared/time";
import { api, ApiFailure } from "../lib/api";
import { Modal } from "../lib/dialog";
import { useShown } from "../lib/format";
import { useLive } from "../lib/live";
import { Link } from "../lib/router";
import { announce, useAppState } from "../lib/store";
import { Button, EmptyBand, ErrorSummary, Field, LoadFailed, Skeleton, useBusy } from "../lib/ui";
import { useResource } from "../lib/useResource";

interface StreamRow {
  name: string;
  write_generation: number;
  events: number;
  failures: number;
}

function NewStreamDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, run] = useBusy();
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      try {
        await api.post("/api/streams", { name });
        announce(`Stream ${name} created.`);
        onClose();
        onCreated();
      } catch (error) {
        setFailure(error as ApiFailure);
      }
    });
  };
  return (
    <Modal label="New stream" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ErrorSummary failure={failure} labels={{ name: "Stream name" }} />
        <Field label="Stream name" hint="1 to 40 characters: a-z, 0-9 or -." error={failure?.fields.name}>
          {(props) => <input {...props} type="text" data-field="name" autoCapitalize="none" spellCheck={false} value={name} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>Create stream</button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

export function StreamsPage() {
  const list = useResource(() => api.get<{ streams: StreamRow[] }>("/api/streams"), []);
  const [creating, setCreating] = useState(false);
  const role = useAppState((s) => s.me?.space.role);
  const empty = list.data?.streams.length === 0;
  const open = (
    <Button primary={empty} onClick={() => setCreating(true)} disabled={role !== "admin"}>New stream</Button>
  );
  return (
    <div className="stack">
      <div className="page-head"><h1>Streams</h1>{empty ? null : open}</div>
      {list.error ? <LoadFailed failure={list.error} onRetry={list.reload} /> : null}
      {!list.data && !list.error ? <Skeleton /> : null}
      {empty ? <EmptyBand line="No streams in this space yet.">{open}</EmptyBand> : null}
      {list.data && !empty ? (
        <div className="table-wrap">
          <table className="data" aria-label="Streams">
            <thead><tr><th scope="col">Stream</th><th scope="col" className="num">Write generation</th><th scope="col" className="num">Events</th><th scope="col" className="num">Failures</th></tr></thead>
            <tbody>
              {list.data.streams.map((stream) => (
                <tr key={stream.name}>
                  <td><Link to={`/streams/${stream.name}`} className="mono">{stream.name}</Link></td>
                  <td className="num">{stream.write_generation}</td><td className="num">{stream.events}</td><td className="num">{stream.failures}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {creating ? <NewStreamDialog onClose={() => setCreating(false)} onCreated={list.reload} /> : null}
    </div>
  );
}

interface MappingRow { field: string; type: string; generation: number; explicit: boolean }
interface UploadRow {
  id: number; file: string; bytes: number; status: string; done_lines: number; total_lines: number;
  created: number; duplicates: number; dropped: number; failed: number;
}
interface FailureRow { id: number; reason: string; raw: string; at: string }

function AddFieldDialog({ stream, onClose, onAdded }: { stream: string; onClose: () => void; onAdded: () => void }) {
  const [field, setField] = useState("");
  const [type, setType] = useState("keyword");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, run] = useBusy();
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      try {
        await api.post(`/api/streams/${stream}/mappings`, { field, type });
        announce(`Field ${field} added as ${type}.`);
        onClose();
        onAdded();
      } catch (error) {
        setFailure(error as ApiFailure);
      }
    });
  };
  return (
    <Modal label="Add field" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ErrorSummary failure={failure} labels={{ field: "Field name", type: "Field type" }} />
        <Field label="Field name" error={failure?.fields.field}>
          {(props) => <input {...props} type="text" data-field="field" autoCapitalize="none" spellCheck={false} value={field} onChange={(event) => setField(event.target.value)} />}
        </Field>
        <Field label="Field type" error={failure?.fields.type}>
          {(props) => (
            <select {...props} data-field="type" value={type} onChange={(event) => setType(event.target.value)}>
              {["number", "date", "boolean", "text", "keyword"].map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          )}
        </Field>
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>Add</button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

export function StreamPage({ name }: { name: string }) {
  const detail = useResource(() => api.get<{ mapping: MappingRow[] }>(`/api/streams/${name}`), [name]);
  const uploads = useResource(() => api.get<{ uploads: UploadRow[] }>(`/api/streams/${name}/uploads`), [name]);
  const failures = useResource(() => api.get<{ failures: FailureRow[] }>(`/api/streams/${name}/failures`), [name]);
  const pipelines = useResource(() => api.get<{ pipelines: Array<{ name: string }> }>("/api/pipelines"), []);
  const [pipeline, setPipeline] = useState("");
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<ApiFailure | null>(null);
  const [done, setDone] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const role = useAppState((s) => s.me?.space.role);
  const canWrite = role === "editor" || role === "admin";

  useLive(["upload"], (data) => {
    if (data.stream !== name) return;
    const row = data.upload as UploadRow | null;
    if (row) {
      uploads.set((current) => {
        const rows = current?.uploads ?? [];
        return { uploads: rows.some((r) => r.id === row.id) ? rows.map((r) => (r.id === row.id ? row : r)) : [row, ...rows] };
      });
    }
    const sentence = (data.announcements as string[] | undefined)?.[0];
    if (sentence) {
      announce(sentence);
      setDone(sentence);
      detail.reload();
      uploads.reload();
    }
    failures.reload();
  });

  const send = async (file: File): Promise<void> => {
    setProblem(null);
    setDone("");
    const form = new FormData();
    form.append("file", file, file.name);
    if (pipeline) form.append("pipeline", pipeline);
    try {
      await api.post(`/api/streams/${name}/uploads`, form);
    } catch (error) {
      setProblem(error as ApiFailure);
    }
  };

  const running = uploads.data?.uploads.find((upload) => upload.status === "kept" || upload.status === "parsing");
  const loadError = detail.error ?? uploads.error ?? failures.error;
  const settled = [detail, uploads, failures].every((resource) => resource.data !== null || resource.error !== null);
  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="mono">{name}</h1>
        <Link to={`/streams/${name}/analyze`} className="btn btn-outline">Analyze</Link>
        <Link to={`/streams/${name}/lifecycle`} className="btn btn-outline">Lifecycle</Link>
      </div>
      {loadError ? <LoadFailed failure={loadError} onRetry={() => { detail.reload(); uploads.reload(); failures.reload(); }} /> : null}
      {settled ? (
        <>
          <div className="cols cols-2">
            <section className="stack">
              <div className="page-head"><h2>Mapping</h2>{canWrite && role === "admin" ? <Button onClick={() => setAdding(true)}>Add field</Button> : null}</div>
              {detail.data ? (
                <div className="table-wrap">
                  <table className="data" aria-label="Mapping">
                    <thead><tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col" className="num">Generation</th><th scope="col">Explicit</th></tr></thead>
                    <tbody>
                      {detail.data.mapping.map((row) => (
                        <tr key={`${row.field}:${row.generation}`}><td className="mono">{row.field}</td><td className="mono">{row.type}</td><td className="num">{row.generation}</td><td>{row.explicit ? "Yes" : "No"}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Skeleton rows={3} />}
            </section>
            <section className="stack">
              <h2>Uploads</h2>
              <div className="upload-controls">
                <Field label="Pipeline">
                  {(props) => (
                    <select {...props} value={pipeline} onChange={(event) => setPipeline(event.target.value)}>
                      <option value="">None</option>
                      {pipelines.data?.pipelines.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                    </select>
                  )}
                </Field>
                <input ref={picker} type="file" accept=".ndjson" hidden tabIndex={-1} aria-hidden="true" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void send(file); }} />
                <Button primary disabled={!canWrite} onClick={() => picker.current?.click()}>Upload file</Button>
              </div>
              <ErrorSummary failure={problem} />
              {running ? (
                <div>
                  <p className="mono small">Upload: {running.done_lines} of {running.total_lines} lines</p>
                  <div role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuenow={running.done_lines} aria-valuemax={running.total_lines} className="progress">
                    <span style={{ width: `${running.total_lines ? (running.done_lines / running.total_lines) * 100 : 0}%` }} />
                  </div>
                </div>
              ) : null}
              {done ? <p className="notice">{done}</p> : null}
              {uploads.data ? (
                <div className="table-wrap">
                  <table className="data" aria-label="Uploads">
                    <thead><tr><th scope="col">File</th><th scope="col" className="num">Bytes</th><th scope="col">Status</th></tr></thead>
                    <tbody>
                      {uploads.data.uploads.map((upload) => (
                        <tr key={upload.id}><td className="mono">{upload.file}</td><td className="num">{upload.bytes}</td><td>{upload.status}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Skeleton rows={2} />}
            </section>
          </div>
          <FailureStore rows={failures.data?.failures ?? []} />
        </>
      ) : <Skeleton rows={8} />}
      {adding ? <AddFieldDialog stream={name} onClose={() => setAdding(false)} onAdded={detail.reload} /> : null}
    </div>
  );
}

function FailureStore({ rows }: { rows: FailureRow[] }) {
  const shown = useShown();
  return (
    <section role="region" aria-label="Failure store" className="stack">
      <h2>Failure store</h2>
      {rows.length === 0 ? <p className="muted">No failed lines.</p> : null}
      {rows.map((row) => (
        <article key={row.id} className="card">
          <p className="small muted mono">{shown(row.at)}</p>
          <p>{row.reason}</p>
          <pre className="raw">{row.raw}</pre>
        </article>
      ))}
    </section>
  );
}

export function AnalyzePage({ name }: { name: string }) {
  const [text, setText] = useState("");
  const [analyzer, setAnalyzer] = useState("standard");
  const [tokens, setTokens] = useState<Array<{ token: string; position: number; start: number; end: number }> | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, run] = useBusy();
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      try {
        setFailure(null);
        setTokens((await api.post<{ tokens: NonNullable<typeof tokens> }>("/api/analyze", { analyzer, text })).tokens);
      } catch (error) {
        setFailure(error as ApiFailure);
      }
    });
  };
  return (
    <div className="stack narrow-wide">
      <div className="page-head"><h1>Analyze</h1><Link to={`/streams/${name}`} className="mono">{name}</Link></div>
      <form onSubmit={submit} className="stack" noValidate>
        <ErrorSummary failure={failure} />
        <Field label="Text">{(props) => <textarea {...props} className="mono" value={text} onChange={(event) => setText(event.target.value)} />}</Field>
        <Field label="Analyzer">
          {(props) => (
            <select {...props} value={analyzer} onChange={(event) => setAnalyzer(event.target.value)}>
              {["standard", "keyword", "whitespace"].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
        </Field>
        <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>Analyze</button>
      </form>
      {tokens ? (
        <div className="table-wrap">
          <table className="data" aria-label="Tokens">
            <thead><tr><th scope="col">Token</th><th scope="col" className="num">Position</th><th scope="col" className="num">Start</th><th scope="col" className="num">End</th></tr></thead>
            <tbody>{tokens.map((t) => <tr key={`${t.position}:${t.token}`}><td className="mono">{t.token}</td><td className="num">{t.position}</td><td className="num">{t.start}</td><td className="num">{t.end}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

interface GenerationView {
  number: number;
  phase: Phase;
  events: number;
  next: { step: NextStep["step"]; at: string | null; events?: number } | null;
  archive_failed: boolean;
  delete_failed: boolean;
}

interface PolicyForm {
  rollover_max_age_ms: string;
  rollover_max_events: string;
  warm_after_ms: string;
  archive_after_ms: string;
  delete_after_ms: string;
}

const POLICY_FIELDS: Array<{ key: keyof PolicyForm; label: string }> = [
  { key: "rollover_max_age_ms", label: "Rollover max age (ms)" },
  { key: "rollover_max_events", label: "Rollover max events" },
  { key: "warm_after_ms", label: "Warm after (ms)" },
  { key: "archive_after_ms", label: "Archive after (ms)" },
  { key: "delete_after_ms", label: "Delete after (ms)" },
];

export function LifecyclePage({ name }: { name: string }) {
  const detail = useResource(() => api.get<{ policy: Record<keyof PolicyForm, number | null>; generations: GenerationView[] }>(`/api/streams/${name}`), [name]);
  const [form, setForm] = useState<PolicyForm | null>(null);
  const [generations, setGenerations] = useState<GenerationView[] | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, run] = useBusy();
  const zone = useAppState((s) => s.me?.time_zone ?? "UTC");
  const role = useAppState((s) => s.me?.space.role);

  useEffect(() => {
    if (!detail.data) return;
    setGenerations(detail.data.generations);
    setForm(Object.fromEntries(POLICY_FIELDS.map(({ key }) => [key, detail.data?.policy[key] == null ? "" : String(detail.data?.policy[key])])) as unknown as PolicyForm);
  }, [detail.data]);

  useLive(["lifecycle"], (data) => {
    if (data.stream === name) setGenerations(data.generations as GenerationView[]);
  });

  const save = (event: FormEvent): void => {
    event.preventDefault();
    if (!form) return;
    void run(async () => {
      const body: Record<string, number | null> = {};
      for (const { key } of POLICY_FIELDS) body[key] = form[key].trim() === "" ? null : Number(form[key]);
      try {
        setFailure(null);
        const saved = await api.put<{ message: string }>(`/api/streams/${name}/lifecycle`, body);
        announce(saved.message);
        detail.reload();
      } catch (error) {
        setFailure(error as ApiFailure);
      }
    });
  };

  return (
    <div className="stack">
      <div className="page-head"><h1>Lifecycle</h1><Link to={`/streams/${name}`} className="mono">{name}</Link></div>
      {detail.error ? <LoadFailed failure={detail.error} onRetry={detail.reload} /> : null}
      {form ? (
        <form onSubmit={save} className="stack narrow-wide" noValidate>
          <ErrorSummary failure={failure} labels={Object.fromEntries(POLICY_FIELDS.map((f) => [f.key, f.label]))} />
          <div className="grid-fields">
            {POLICY_FIELDS.map(({ key, label }) => (
              <Field key={key} label={label} error={failure?.fields[key]}>
                {(props) => <input {...props} type="text" inputMode="numeric" data-field={key} className="mono" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />}
              </Field>
            ))}
          </div>
          <button type="submit" className="btn btn-primary" disabled={role !== "admin"} aria-busy={busy || undefined}>Save policy</button>
        </form>
      ) : null}
      {generations ? (
        <section className="stack">
          <h2>Generation timeline</h2>
          <ol className="timeline" aria-label="Generation timeline">
            {generations.map((generation) => {
              const next: NextStep | null = generation.next && { step: generation.next.step, at: generation.next.at === null ? null : (parseIsoInstant(generation.next.at) as number), events: generation.next.events };
              return (
                <li key={generation.number} className={`band band-${generation.phase}`}>
                  <span className="mono">{timelineText(generation.number, generation.phase, next, zone)}</span>
                  <span className="small muted mono"> {generation.events} events</span>
                  {generation.archive_failed ? <p className="small band-note">Archive failed. It will retry on the next step.</p> : null}
                  {generation.delete_failed ? <p className="small band-note">Delete failed. It will retry on the next step.</p> : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

