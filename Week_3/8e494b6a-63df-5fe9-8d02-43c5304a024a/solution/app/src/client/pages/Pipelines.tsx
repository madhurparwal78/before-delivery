// Pipelines: the list, the processors editor and the simulation page.
import { useEffect, useState, type FormEvent } from "react";
import { api, ApiFailure } from "../lib/api";
import { Modal } from "../lib/dialog";
import { Link, navigate } from "../lib/router";
import { announce, useAppState } from "../lib/store";
import { Button, EmptyBand, ErrorSummary, Field, LoadFailed, Skeleton, useBusy } from "../lib/ui";
import { useResource } from "../lib/useResource";

interface PipelineRow {
  name: string;
  version: number;
  processors: unknown[];
}

function NewPipelineDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, run] = useBusy();
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      try {
        const saved = await api.put<{ message: string }>(`/api/pipelines/${encodeURIComponent(name)}`, { processors: [] });
        announce(saved.message);
        onClose();
        navigate(`/pipelines/${name}`);
      } catch (error) {
        setFailure(error as ApiFailure);
      }
    });
  };
  return (
    <Modal label="New pipeline" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ErrorSummary failure={failure} labels={{ name: "Pipeline name" }} />
        <Field label="Pipeline name" hint="1 to 40 characters: a-z, 0-9 or -." error={failure?.fields.name}>
          {(props) => <input {...props} type="text" data-field="name" autoCapitalize="none" spellCheck={false} value={name} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>Create pipeline</button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

export function PipelinesPage() {
  const list = useResource(() => api.get<{ pipelines: PipelineRow[] }>("/api/pipelines"), []);
  const [creating, setCreating] = useState(false);
  const role = useAppState((s) => s.me?.space.role);
  const empty = list.data?.pipelines.length === 0;
  const open = <Button primary={empty} disabled={role !== "admin"} onClick={() => setCreating(true)}>New pipeline</Button>;
  return (
    <div className="stack">
      <div className="page-head"><h1>Pipelines</h1>{empty ? null : open}</div>
      {list.error ? <LoadFailed failure={list.error} onRetry={list.reload} /> : null}
      {!list.data && !list.error ? <Skeleton /> : null}
      {empty ? <EmptyBand line="No pipelines yet.">{open}</EmptyBand> : null}
      {list.data && !empty ? (
        <div className="table-wrap">
          <table className="data" aria-label="Pipelines">
            <thead><tr><th scope="col">Pipeline</th><th scope="col" className="num">Version</th><th scope="col" className="num">Processors</th></tr></thead>
            <tbody>
              {list.data.pipelines.map((p) => (
                <tr key={p.name}><td><Link to={`/pipelines/${p.name}`} className="mono">{p.name}</Link></td><td className="num">{p.version}</td><td className="num">{p.processors.length}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {creating ? <NewPipelineDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

export function PipelineEditorPage({ name }: { name: string }) {
  const list = useResource(() => api.get<{ pipelines: PipelineRow[] }>("/api/pipelines"), [name]);
  const [json, setJson] = useState("");
  const [version, setVersion] = useState<number | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, run] = useBusy();
  const role = useAppState((s) => s.me?.space.role);
  useEffect(() => {
    const found = list.data?.pipelines.find((p) => p.name === name);
    if (found) {
      setJson(JSON.stringify(found.processors, null, 2));
      setVersion(found.version);
    }
  }, [list.data, name]);
  const save = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      let processors: unknown;
      try {
        processors = JSON.parse(json);
      } catch {
        setFailure(new ApiFailure(422, "invalid", "Check the highlighted fields.", { processors: "Enter the processors as valid JSON." }));
        return;
      }
      try {
        setFailure(null);
        const saved = await api.put<{ version: number; message: string }>(`/api/pipelines/${name}`, { processors: processors as Record<string, unknown> });
        setVersion(saved.version);
        announce(saved.message);
      } catch (error) {
        setFailure(error as ApiFailure);
      }
    });
  };
  const missing = list.data && !list.data.pipelines.some((p) => p.name === name);
  return (
    <div className="stack narrow-wide">
      <div className="page-head"><h1 className="mono">{name}</h1><span className="mono" style={version === null ? { visibility: "hidden" } : undefined}>Version {version ?? 0}</span><Link to={`/pipelines/${name}/simulate`} className="btn btn-outline">Simulate</Link></div>
      {list.error ? <LoadFailed failure={list.error} onRetry={list.reload} /> : null}
      {missing ? <p className="notice">Pipeline {name} doesn't exist.</p> : null}
      <form onSubmit={save} className="stack" noValidate>
        <ErrorSummary failure={failure} labels={{ processors: "Processors JSON" }} />
        <Field label="Processors JSON" error={failure?.fields.processors}>
          {(props) => <textarea {...props} data-field="processors" className="mono tall" spellCheck={false} value={json} onChange={(event) => setJson(event.target.value)} />}
        </Field>
        <div><button type="submit" className="btn btn-primary" disabled={role !== "admin"} aria-busy={busy || undefined}>Save pipeline</button></div>
      </form>
    </div>
  );
}

interface Step {
  step: number;
  processor: string;
  status: string;
  event: Record<string, unknown>;
  changed: string[];
  text?: string;
}
interface SimResult { event: number; outcome: string; error?: string; steps: Step[] }

function flat(value: Record<string, unknown>, prefix = ""): Array<[string, unknown]> {
  return Object.entries(value).flatMap(([key, child]) =>
    child !== null && typeof child === "object" && !Array.isArray(child) ? flat(child as Record<string, unknown>, `${prefix}${key}.`) : [[`${prefix}${key}`, child] as [string, unknown]],
  );
}

export function SimulatePage({ name }: { name: string }) {
  const [lines, setLines] = useState("");
  const [results, setResults] = useState<SimResult[] | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, run] = useBusy();
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      try {
        setFailure(null);
        setResults((await api.post<{ results: SimResult[] }>(`/api/pipelines/${name}/simulate`, { lines })).results);
      } catch (error) {
        setFailure(error as ApiFailure);
      }
    });
  };
  return (
    <div className="stack">
      <div className="page-head"><h1>Simulate</h1><Link to={`/pipelines/${name}`} className="mono">{name}</Link></div>
      <section role="region" aria-label="Simulate" className="stack">
        <form onSubmit={submit} className="stack" noValidate>
          <ErrorSummary failure={failure} labels={{ lines: "Sample events" }} />
          <Field label="Sample events" hint="One JSON object per line. Nothing is stored." error={failure?.fields.lines}>
            {(props) => <textarea {...props} data-field="lines" className="mono tall" spellCheck={false} value={lines} onChange={(event) => setLines(event.target.value)} />}
          </Field>
          <div><button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>Run simulation</button></div>
        </form>
        {results?.map((result) => (
          <div key={result.event} role="group" aria-label={`Event ${result.event}`} className="card sim-event">
            <h3>Event {result.event} <span className="badge badge-plain">{result.outcome}</span></h3>
            {result.error && result.steps.length === 0 ? <p>{result.error}</p> : null}
            {result.steps.map((step) => (
              <div key={step.step} role="group" aria-label={`Step ${step.step} ${step.processor}`} className={`sim-step sim-${step.status}`}>
                <p className="mono"><strong>{step.step}. {step.processor}</strong> <span className="badge badge-plain">{step.status}</span> {step.changed.length > 0 ? <span className="badge badge-info">changed</span> : null}</p>
                {step.text ? <p>{step.text}</p> : null}
                {step.status === "skipped" || step.status === "failed" ? null : (
                  <ul className="sim-fields mono">
                    {flat(step.event).map(([field, value]) => {
                      const changed = step.changed.includes(field);
                      return <li key={field} data-changed={changed ? "true" : undefined}>{field}: {JSON.stringify(value)}{changed ? <span className="badge badge-info"> changed</span> : null}</li>;
                    })}
                  </ul>
                )}
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}
