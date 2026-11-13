import { useRef, useState } from "preact/hooks";
import { Download, RotateCcw } from "lucide-preact";
import { api, projectPath, upload, type ImportReport, type Operation, type ProjectDetail } from "../api";
import { projectHref } from "../router";
import { act, dateTime, errorCopy, loadProjects, useLoad } from "../store";
import { Button, Dialog, EmptyState, Field, LinkButton, PageSkeleton, useHeadingFocus, useSettled } from "../ui";
import { NotFound } from "./public";

interface TMEntry { id: string; source: string; target: string; target_language: string; import_id: string | null }

export function RestoreDialog({ slug, op, onClose, onDone }: { slug: string; op: Operation; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const out = await act("Restoring.", () => api("POST", `${projectPath(slug)}/operations/${op.id}/restore`, {}), `Restored the state before this ${op.kind}.`);
    setBusy(false);
    if (out.ok) { onDone(); onClose(); }
  };
  return (
    <Dialog title="Restore" onClose={onClose}>
      <div className="stack">
        <p>Restoring returns main and the translation memory to exactly how they were before <strong>{op.label}</strong>. It is refused if anything has changed since.</p>
        <div className="dialog-actions"><Button onClick={() => void submit()} busy={busy}>Restore now</Button><Button variant="outline" onClick={onClose}>Cancel</Button></div>
      </div>
    </Dialog>
  );
}

const REASONS: Record<string, string> = {
  missing_source: "The source is empty.",
  missing_target: "The target is empty.",
  unknown_language: "The target language isn't one of this project's.",
  conflicting_target: "The TM already holds a different target for this source.",
  no_matching_key: "No live main key has this source yet.",
};

const formatSize = (n: number) => `${n.toLocaleString("en-US")} bytes`;

export function TM({ slug }: { slug: string }) {
  useHeadingFocus("Translation memory");
  const project = useLoad(() => api<ProjectDetail>("GET", projectPath(slug)), [slug]);
  const imports = useLoad(() => api<{ imports: ImportReport[] }>("GET", `${projectPath(slug)}/tm/imports`), [slug]);
  const ops = useLoad(() => api<{ operations: Operation[] }>("GET", `${projectPath(slug)}/operations`), [slug]);
  const [q, setQ] = useState("");
  const entries = useLoad(() => api<{ entries: TMEntry[]; total: number }>("GET", `${projectPath(slug)}/tm${q ? `?q=${encodeURIComponent(q)}` : ""}`), [slug, q]);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState("tmx");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState<Operation | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const ready = useSettled(![project, imports, ops, entries].some((l) => l.loading));
  if (project.error?.status === 404) return <NotFound kind="project" />;

  const list = imports.data?.imports ?? [];
  const opById = new Map((ops.data?.operations ?? []).map((o) => [o.id, o]));
  const shown = report ?? list.find((i) => !i.restored_at) ?? list[0] ?? null;
  const empty = project.data && project.data.tm_entries === 0 && list.length === 0 && !entries.data?.total;
  const reload = () => { project.reload(); imports.reload(); ops.reload(); entries.reload(); void loadProjects(); };

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!file) { const m = "Choose a file to import."; setError(m); return; }
    setBusy(true);
    setError("");
    const data = new FormData();
    data.set("file", file, file.name);
    data.set("format", format);
    const out = await act("Importing translation memory.", () => upload<ImportReport>(`${projectPath(slug)}/tm/imports`, data),
      (r) => `Imported ${r.added} new entries, merged ${r.duplicates} duplicates and reused ${r.applied} exact matches.${r.rows.length ? ` ${r.rows.length} rows need attention.` : ""}`);
    setBusy(false);
    if (out.ok) {
      setReport(out.value);
      setFile(null);
      form.current?.reset();
      reload();
      return;
    }
    setError(errorCopy(out.error));
  };

  return (
    <>
      <h1 className="display page-title">Translation memory</h1>
      <p className="muted lede">{project.data?.name} · one translation memory for the project, matched by one exact-match rule.</p>

      <form ref={form} className="card stack" aria-label="Import translation memory" onSubmit={submit} noValidate>
        <h2 className="h4">Import a file</h2>
        <div className="form-row">
          <Field label="Import file" error={error} hint="TMX or a CSV with source, target and target_language columns, up to 5,000,000 bytes.">
            {(p) => <input {...p} ref={fileInput} type="file" accept=".tmx,.xml,.csv,text/csv,application/xml" onChange={(e) => setFile((e.target as HTMLInputElement).files?.[0] ?? null)} />}
          </Field>
          <Field label="Format">
            {(p) => <select {...p} value={format} onChange={(e) => setFormat((e.target as HTMLSelectElement).value)}><option value="tmx">TMX</option><option value="csv">CSV</option></select>}
          </Field>
        </div>
        <div><Button type="submit" busy={busy}>Import</Button></div>
      </form>

      {!ready ? <PageSkeleton /> : (
        <>
      <section className="card" aria-label="Import report">
        <h2 className="h4">Import report</h2>
        {!shown ? <p className="muted">No import yet. Rows that need attention are listed here by line.</p> : (
          <>
            <p>
              <strong>{shown.filename}</strong>: {shown.added} new entries added, {shown.duplicates} duplicates merged, {shown.applied} exact matches reused, {shown.rows.length} rows need attention.
            </p>
            {shown.rows.length > 0 && (
              <div className="table-scroll" tabIndex={0} role="group" aria-label="Scrollable table">
                <table className="table">
                  <thead><tr><th>Line</th><th>Reason</th></tr></thead>
                  <tbody>{shown.rows.map((r, i) => <tr key={i}><td className="num">{r.line}</td><td><code>{r.reason}</code> <span className="muted">{REASONS[r.reason]}</span></td></tr>)}</tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <section className="card" aria-label="Imports">
        <h2 className="h4">Imports</h2>
        {imports.data && list.length === 0 && <p className="muted">Nothing imported yet.</p>}
        {list.length > 0 && (
          <ul className="rows">
            {list.map((i) => (
              <li key={i.import_id} className="row-item">
                <div>
                  <strong>{i.filename}</strong>
                  <p className="muted">{i.format.toUpperCase()} · {formatSize(i.size)} · {dateTime(i.at)}{i.restored_at ? " · Restored" : ""}</p>
                </div>
                <div className="row-actions">
                  <a className="btn btn-outline" href={`${projectPath(slug)}/tm/imports/${i.import_id}/original`} download={i.filename}><Download size={18} strokeWidth={1.5} aria-hidden="true" />Download original</a>
                  {!i.restored_at && opById.has(i.operation_id ?? "") && (
                    <Button variant="outline" onClick={() => setRestoring(opById.get(i.operation_id ?? "")!)}><RotateCcw size={18} strokeWidth={1.5} aria-hidden="true" />Restore</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-label="Entries">
        <div className="title-row">
          <h2 className="h4">Entries{entries.data ? ` (${entries.data.total})` : ""}</h2>
          <input type="search" className="search" aria-label="Search translation memory" placeholder="Search sources" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        </div>
        {empty ? (
          <EmptyState heading="No translation memory yet" text="Import a TMX file or a spreadsheet to start reusing exact matches.">
            <Button onClick={() => fileInput.current?.focus()}>Import translation memory</Button>
          </EmptyState>
        ) : entries.data && entries.data.entries.length === 0 && <p className="muted">No entries match.</p>}
        {entries.data && entries.data.entries.length > 0 && (
          <div className="table-scroll" tabIndex={0} role="group" aria-label="Scrollable table">
            <table className="table">
              <thead><tr><th>Source</th><th>Language</th><th>Target</th><th>From</th></tr></thead>
              <tbody>{entries.data.entries.map((e) => <tr key={e.id}><td>{e.source}</td><td>{e.target_language}</td><td>{e.target}</td><td className="muted">{e.import_id ? "Import" : "Seeded"}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
      <p><LinkButton variant="outline" href={projectHref(slug)}>Back to the project</LinkButton></p>
        </>
      )}
      {restoring && <RestoreDialog slug={slug} op={restoring} onClose={() => setRestoring(null)} onDone={reload} />}
    </>
  );
}
