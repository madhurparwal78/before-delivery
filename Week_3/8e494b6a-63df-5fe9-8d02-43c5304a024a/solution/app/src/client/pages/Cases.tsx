// Cases: the table, creating one, and a case's status controls and items.
import { useState, type FormEvent } from "react";
import { api, ApiFailure } from "../lib/api";
import { Modal } from "../lib/dialog";
import { useLive } from "../lib/live";
import { Link } from "../lib/router";
import { announce, useAppState } from "../lib/store";
import { Button, EmptyBand, ErrorSummary, Field, LoadFailed, Skeleton, useBusy } from "../lib/ui";
import { useResource } from "../lib/useResource";

export interface CaseSummary { number: number; title: string; status: string }

export const caseLabel = (c: CaseSummary): string => `Case ${c.number}: ${c.title}, ${c.status}`;

function NewCaseDialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, run] = useBusy();
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      try {
        const made = await api.post<{ number: number }>("/api/cases", { title });
        announce(`Case ${made.number} created.`);
        onClose();
      } catch (error) {
        setFailure(error as ApiFailure);
      }
    });
  };
  return (
    <Modal label="New case" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ErrorSummary failure={failure} labels={{ title: "Case title" }} />
        <Field label="Case title" error={failure?.fields.title}>
          {(props) => <input {...props} type="text" data-field="title" value={title} onChange={(event) => setTitle(event.target.value)} />}
        </Field>
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>Create case</button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

export function CasesPage() {
  const list = useResource(() => api.get<{ cases: CaseSummary[] }>("/api/cases"), []);
  const [creating, setCreating] = useState(false);
  const editor = useAppState((s) => s.me?.space.role !== "viewer");
  useLive(["case"], (data) => {
    const item = data.case as CaseSummary;
    list.set((current) => {
      const rows = current?.cases ?? [];
      return { cases: rows.some((c) => c.number === item.number) ? rows.map((c) => (c.number === item.number ? item : c)) : [item, ...rows] };
    });
  });
  const empty = list.data?.cases.length === 0;
  const open = <Button primary={empty} disabled={!editor} onClick={() => setCreating(true)}>New case</Button>;
  return (
    <div className="stack">
      <div className="page-head"><h1>Cases</h1>{empty ? null : open}</div>
      {list.error ? <LoadFailed failure={list.error} onRetry={list.reload} /> : null}
      {!list.data && !list.error ? <Skeleton /> : null}
      {empty ? <EmptyBand line="No cases yet.">{open}</EmptyBand> : null}
      {list.data && !empty ? (
        <div className="table-wrap">
          <table className="data" aria-label="Cases">
            <thead><tr><th scope="col" className="num">Case</th><th scope="col">Title</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {list.data.cases.map((c) => (
                <tr key={c.number} aria-label={caseLabel(c)}>
                  <td className="num"><Link to={`/cases/${c.number}`} className="mono">{c.number}</Link></td><td>{c.title}</td><td>{c.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {creating ? <NewCaseDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

interface CaseItem { kind: "group" | "inbox" | "trace"; text: string; trace_id?: string }
interface CaseDetail extends CaseSummary { items: CaseItem[] }

const STATUSES = ["open", "investigating", "resolved", "closed"];

export function CasePage({ number }: { number: string }) {
  const detail = useResource(() => api.get<CaseDetail>(`/api/cases/${number}`), [number]);
  const [status, setStatus] = useState("");
  const [traceId, setTraceId] = useState("");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, run] = useBusy();
  const editor = useAppState((s) => s.me?.space.role !== "viewer");

  useLive(["case"], (data) => {
    const item = data.case as CaseSummary;
    if (String(item.number) === number) {
      detail.set((current) => (current ? { ...current, status: item.status, title: item.title } : current));
      detail.reload();
    }
  });

  const current = status || detail.data?.status || "open";
  const update = (): Promise<void> =>
    run(async () => {
      try {
        setFailure(null);
        const next = await api.patch<CaseDetail>(`/api/cases/${number}`, { status: current });
        detail.set(next);
        setStatus("");
      } catch (error) {
        setFailure(error as ApiFailure);
      }
    });
  const link = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      try {
        setFailure(null);
        detail.set(await api.post<CaseDetail>(`/api/cases/${number}/items`, { trace_id: traceId }));
        setTraceId("");
      } catch (error) {
        setFailure(error as ApiFailure);
      }
    });
  };

  return (
    <div className="stack narrow-wide">
      {detail.error ? <LoadFailed failure={detail.error} onRetry={detail.reload} /> : null}
      {detail.data ? (
        <>
          <div className="page-head"><h1>Case {detail.data.number}: {detail.data.title}</h1><span className="badge badge-plain">{detail.data.status}</span></div>
          <ErrorSummary failure={failure} labels={{ trace_id: "Trace id", status: "Case status" }} />
          <div className="inline-form">
            <Field label="Case status">
              {(props) => <select {...props} value={current} disabled={!editor} onChange={(event) => setStatus(event.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>}
            </Field>
            <Button primary busy={busy} disabled={!editor} onClick={() => void update()}>Update status</Button>
          </div>
          <h2>Items</h2>
          <ul className="plain-list" aria-label="Case items">
            {detail.data.items.map((item, k) => (
              <li key={k} className="card">
                {item.kind === "trace" ? <Link to={`/traces/${item.trace_id}`} className="mono" aria-label={item.text}>{item.text}</Link> : <span className="mono">{item.text}</span>}
              </li>
            ))}
          </ul>
          {detail.data.items.length === 0 ? <p className="muted">No items yet. Add a group, an inbox item or a trace.</p> : null}
          <form onSubmit={link} className="inline-form" noValidate>
            <Field label="Trace id" error={failure?.fields.trace_id}>
              {(props) => <input {...props} type="text" data-field="trace_id" className="mono" value={traceId} disabled={!editor} onChange={(event) => setTraceId(event.target.value)} />}
            </Field>
            <button type="submit" className="btn btn-outline" disabled={!editor} aria-busy={busy || undefined}>Link trace</button>
          </form>
        </>
      ) : null}
    </div>
  );
}
