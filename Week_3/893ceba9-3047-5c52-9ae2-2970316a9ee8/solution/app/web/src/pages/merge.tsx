import { useRef, useState } from "preact/hooks";
import { RotateCcw } from "lucide-preact";
import { ApiError, api, branchPath, enc, projectPath, type Conflict, type Operation, type Preview, type ProjectDetail } from "../api";
import { projectHref, useRoute } from "../router";
import { act, clock, dateTime, errorCopy, loadProjects, statusWord, useLoad } from "../store";
import { Button, Dialog, EmptyState, Field, LinkButton, PageSkeleton, StatusWord, focusFirstError, useHeadingFocus, useSettled, EmptyIllustration } from "../ui";
import { RestoreDialog } from "./tm";
import { NotFound } from "./public";

function ResolveDialog({ slug, branch, conflict, onClose, onDone }: { slug: string; branch: string; conflict: Conflict; onClose: () => void; onDone: () => void }) {
  const [choice, setChoice] = useState(conflict.resolution?.choice ?? "");
  const [value, setValue] = useState(conflict.resolution?.choice === "custom" ? conflict.resolution.value ?? "" : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!choice) { setError("Choose how to resolve this conflict."); focusFirstError(form.current); return; }
    setBusy(true);
    const out = await act("Saving resolution.", () => api("PUT", `${branchPath(slug, branch)}/conflicts/${enc(conflict.id)}`, { choice, value: choice === "custom" ? value : undefined }), "Resolution saved.");
    setBusy(false);
    if (out.ok) { onDone(); onClose(); return; }
    setError(errorCopy(out.error));
    focusFirstError(form.current);
  };
  const options: [string, string][] = [["main", "Keep main"], ["branch", "Keep branch"], ["custom", "Write a new value"]];
  return (
    <Dialog title="Resolve conflict" onClose={onClose}>
      <form ref={form} onSubmit={submit} noValidate className="stack">
        <p className="muted">{conflict.key} · {conflict.field}</p>
        <dl className="compare">
          <div><dt>Base</dt><dd>{conflict.base ?? "–"}</dd></div>
          <div><dt>Main</dt><dd>{conflict.main ?? "–"}</dd></div>
          <div><dt>Branch</dt><dd>{conflict.branch ?? "–"}</dd></div>
        </dl>
        <div role="radiogroup" aria-label="Resolution" className="radios">
          {options.map(([v, label]) => (
            <label key={v} className="radio"><input type="radio" name="choice" value={v} checked={choice === v} onChange={() => { setChoice(v); setError(""); }} aria-invalid={error && !choice ? true : undefined} />{label}</label>
          ))}
        </div>
        <Field label="New value" error={error}>
          {(p) => <textarea {...p} rows={3} disabled={choice !== "custom"} value={value} onInput={(e) => setValue((e.target as HTMLTextAreaElement).value)} />}
        </Field>
        <div className="dialog-actions"><Button type="submit" busy={busy}>Save resolution</Button><Button variant="outline" onClick={onClose}>Cancel</Button></div>
      </form>
    </Dialog>
  );
}

function AbandonDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Abandon branch" onClose={onClose}>
      <div className="stack">
        <p>An abandoned branch is final: its changes are never merged and it can't be reopened.</p>
        <div className="dialog-actions">
          <Button busy={busy} onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); onClose(); }}>Abandon</Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Dialog>
  );
}

export function Merge({ slug }: { slug: string }) {
  const route = useRoute();
  const project = useLoad(() => api<ProjectDetail>("GET", projectPath(slug)), [slug]);
  const asked = route.query.get("branch");
  const feature = project.data?.branches.find((b) => !b.is_main && (b.state === "open" || b.state === "in_review"));
  const branch = asked ?? feature?.name ?? "";
  useHeadingFocus(branch ? `Merge ${branch} into main` : "Merge");
  const preview = useLoad(() => (branch ? api<Preview>("GET", `${branchPath(slug, branch)}/merge-preview`) : Promise.resolve(undefined)), [slug, branch]);
  const ops = useLoad(() => api<{ operations: Operation[] }>("GET", `${projectPath(slug)}/operations`), [slug]);
  const [resolving, setResolving] = useState<Conflict | null>(null);
  const [abandoning, setAbandoning] = useState(false);
  const [restoring, setRestoring] = useState<Operation | null>(null);
  const ready = useSettled(!project.loading && !ops.loading && (!branch || !!preview.data || !!preview.error));
  if (project.error?.status === 404) return <NotFound kind="project" />;
  if (preview.error?.status === 404) return <NotFound kind="page" />;
  const pv = preview.data;
  const reload = () => { preview.reload(); ops.reload(); project.reload(); void loadProjects(); };

  const hold = async (c: Conflict) => {
    const out = await act("Holding conflict.", () => api<{ held_until: string }>("POST", `${branchPath(slug, branch)}/conflicts/${enc(c.id)}/hold`, {}),
      (r) => `Holding this conflict for you until ${clock(r.held_until)}.`);
    if (out.ok) setResolving(c);
  };
  const transition = async (to: string) => {
    const out = await act("Updating branch.", () => api<{ name: string; state: string }>("POST", `${branchPath(slug, branch)}/transitions`, { to }), (b) => `Branch ${b.name} is ${statusWord(b.state).toLowerCase()}.`);
    if (out.ok) reload();
  };
  const merge = async () => {
    const out = await act(`Merging ${branch} into main.`, () => api("POST", `${branchPath(slug, branch)}/merge`, {}), `Merged ${branch} into main.`);
    if (out.ok) reload();
    else if (out.error instanceof ApiError && out.error.code === "conflicts_unresolved") preview.reload();
  };
  const state = pv?.state;
  if (!ready) return <PageSkeleton />;
  return (
    <>
      {!branch ? (
        <>
          <h1 className="display page-title">Merge a branch</h1>
          <div className="card"><EmptyState heading="No branch to merge" text="Create a branch from the project page, make changes on it and come back here." /></div>
        </>
      ) : (
        <>
          <div className="title-lead">
            <h1 className="display page-title">Merge {branch} into main</h1>
            {state && <StatusWord state={state} />}
          </div>
          <section className="card" aria-label="Merge preview">
            {pv && (
              <dl className="counts counts-row">
                <div><dt>New keys</dt><dd>{pv.new_keys}</dd></div>
                <div><dt>Edited keys</dt><dd>{pv.edited_keys}</dd></div>
                <div><dt>Deleted keys</dt><dd>{pv.deleted_keys}</dd></div>
                <div><dt>Conflicts</dt><dd>{pv.conflicts.length}</dd></div>
              </dl>
            )}
            <div className="action-row">
              <Button variant="outline" onClick={() => void transition("in_review")} disabled={state !== "open"}>Request review</Button>
              <Button variant="outline" onClick={() => void transition("open")} disabled={state !== "in_review"}>Reopen branch</Button>
              <Button onClick={() => void merge()} disabled={state !== "in_review"}>Merge into main</Button>
              <Button variant="outline" onClick={() => setAbandoning(true)} disabled={state !== "open" && state !== "in_review"}>Abandon branch</Button>
            </div>
          </section>

          <section className="card" aria-label="Conflicts">
            <h2 className="h4">Conflicts</h2>
            {pv && pv.conflicts.length === 0 && <p className="muted">No conflicts with main.</p>}
            {pv && pv.conflicts.length > 0 && (
              <div className="table-scroll" tabIndex={0} role="group" aria-label="Scrollable table">
                <table className="table">
                  <thead><tr><th>Key</th><th>Field</th><th>Base</th><th>Main</th><th>Branch</th><th>Resolution</th></tr></thead>
                  <tbody>
                    {pv.conflicts.map((c) => (
                      <tr key={c.id}>
                        <td>{c.key}</td><td>{c.field}</td><td>{c.base ?? "–"}</td><td>{c.main ?? "–"}</td><td>{c.branch ?? "–"}</td>
                        <td>
                          <span className="resolution">{c.resolution ? `${c.resolution.choice === "main" ? "Keep main" : c.resolution.choice === "branch" ? "Keep branch" : "New value"}` : "Unresolved"}</span>
                          <Button variant="outline" aria-label={`Resolve ${c.key} ${c.field}`} onClick={() => void hold(c)} disabled={state !== "open" && state !== "in_review"}>Resolve</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <section className="card" aria-label="Operations">
        <h2 className="h4">Operations</h2>
        {ops.data && ops.data.operations.length === 0 && (
          <div className="empty empty-inline"><EmptyIllustration /><h3 className="empty-title">Nothing to restore yet</h3><p>No imports or merges to restore yet.</p></div>
        )}
        {ops.data && ops.data.operations.length > 0 && (
          <ul className="rows">
            {ops.data.operations.map((o) => (
              <li key={o.id} className="row-item">
                <div><strong>{o.label}</strong><p className="muted">{o.kind === "merge" ? "Merge" : "Import"} · {dateTime(o.at)}{o.restored_at ? " · Restored" : ""}</p></div>
                {!o.restored_at && <Button variant="outline" onClick={() => setRestoring(o)}><RotateCcw size={18} strokeWidth={1.5} aria-hidden="true" />Restore</Button>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <p><LinkButton variant="outline" href={projectHref(slug)}>Back to the project</LinkButton></p>
      {resolving && <ResolveDialog slug={slug} branch={branch} conflict={resolving} onClose={() => setResolving(null)} onDone={reload} />}
      {abandoning && <AbandonDialog onClose={() => setAbandoning(false)} onConfirm={() => transition("abandoned")} />}
      {restoring && <RestoreDialog slug={slug} op={restoring} onClose={() => setRestoring(null)} onDone={reload} />}
    </>
  );
}
