import { useRef, useState } from "preact/hooks";
import { Download } from "lucide-preact";
import { ApiError, api, projectPath, type ProjectDetail } from "../api";
import { Link, navigate, projectHref } from "../router";
import { act, dateTime, errorCopy, loadProjects, useLoad, type Loaded } from "../store";
import { Button, Dialog, Field, PageSkeleton, focusFirstError, useHeadingFocus, useSettled } from "../ui";
import { NotFound } from "./public";

interface Reviewer { id: string; name: string; email: string }
interface Token { id: string; label: string; created_at: string }
interface Webhook { url: string; event_types: string[]; signing_secret: string }
interface EventRow { event_id: string; type: string; state: string; attempts: number; created_at: string; sent_at: string | null }
interface SourceFile { file_id: string; branch: string; filename: string; content_type: string; size: number; at: string }

function ReviewersCard({ slug, reviewers }: { slug: string; reviewers: Loaded<{ reviewers: Reviewer[] }> }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const invite = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setKey(null);
    const out = await act("Inviting reviewer.", () => api<{ name: string; access_key: string | null }>("POST", `${projectPath(slug)}/reviewers`, { name, email }),
      (r) => (r.access_key ? `Invited ${r.name}. Copy the access key now; it won't be shown again.` : `Added ${r.name} to this project.`));
    setBusy(false);
    if (out.ok) {
      setKey(out.value.access_key);
      setName("");
      setEmail("");
      setErrors({});
      reviewers.reload();
      return;
    }
    setErrors(out.error.code === "reviewer_exists" ? { email: errorCopy(out.error) } : out.error.fields);
    focusFirstError(form.current);
  };
  const remove = async (r: Reviewer) => {
    const out = await act("Removing reviewer.", () => api("DELETE", `${projectPath(slug)}/reviewers/${r.id}`), `Removed ${r.name} from this project.`);
    if (out.ok) reviewers.reload();
  };
  return (
    <section className="card stack" aria-label="Reviewers">
      <h2 className="h4">Reviewers</h2>
      <p className="muted">Invited reviewers see only this project and act only on segments assigned to them.</p>
      {reviewers.data && (reviewers.data.reviewers.length === 0 ? <p className="muted">No reviewers invited yet.</p> : (
        <ul className="rows">{reviewers.data.reviewers.map((r) => (
          <li key={r.id} className="row-item"><div><strong>{r.name}</strong><p className="muted">{r.email}</p></div><Button variant="outline" aria-label={`Remove ${r.name}`} onClick={() => void remove(r)}>Remove</Button></li>
        ))}</ul>
      ))}
      <form ref={form} onSubmit={invite} noValidate className="stack">
        <Field label="Reviewer name" error={errors.name}>{(p) => <input {...p} type="text" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />}</Field>
        <Field label="Reviewer email" error={errors.email}>{(p) => <input {...p} type="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />}</Field>
        <div><Button type="submit" busy={busy}>Invite reviewer</Button></div>
      </form>
      {key && (
        <section className="secret" aria-label="New access key">
          <p className="eyebrow">Access key, shown once</p>
          <code>{key}</code>
        </section>
      )}
    </section>
  );
}

function TokensCard({ slug, tokens }: { slug: string; tokens: Loaded<{ tokens: Token[] }> }) {
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setCreated(null);
    const out = await act("Creating token.", () => api<{ token: string }>("POST", `${projectPath(slug)}/tokens`, { label }), "Token created. Copy it now; it won't be shown again.");
    setBusy(false);
    if (out.ok) { setCreated(out.value.token); setLabel(""); setError(""); tokens.reload(); } else setError(errorCopy(out.error));
  };
  const revoke = async (t: Token) => {
    const out = await act("Revoking token.", () => api("DELETE", `${projectPath(slug)}/tokens/${t.id}`), `Revoked ${t.label}.`);
    if (out.ok) tokens.reload();
  };
  return (
    <section className="card stack" aria-label="CI tokens">
      <h2 className="h4">CI tokens</h2>
      <p className="muted">A token lets CI download this project's approved locale files, and nothing else.</p>
      {tokens.data && (tokens.data.tokens.length === 0 ? <p className="muted">No tokens yet.</p> : (
        <ul className="rows">{tokens.data.tokens.map((t) => (
          <li key={t.id} className="row-item"><div><strong>{t.label}</strong><p className="muted">Created {dateTime(t.created_at)}</p></div><Button variant="outline" aria-label={`Revoke ${t.label}`} onClick={() => void revoke(t)}>Revoke</Button></li>
        ))}</ul>
      ))}
      <form onSubmit={create} noValidate className="stack">
        <Field label="Token label" error={error}>{(p) => <input {...p} type="text" value={label} onInput={(e) => setLabel((e.target as HTMLInputElement).value)} />}</Field>
        <div><Button type="submit" busy={busy}>Create token</Button></div>
      </form>
      {created && (
        <section className="secret" aria-label="New token">
          <p className="eyebrow">Token, shown once</p>
          <code>{created}</code>
        </section>
      )}
    </section>
  );
}

function WebhookCard({ slug, hook, events }: { slug: string; hook: Loaded<Webhook | null>; events: Loaded<{ events: EventRow[] }> }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    const out = await act("Saving endpoint.", () => api<Webhook>("PUT", `${projectPath(slug)}/webhook`, { url }), "Webhook endpoint saved.");
    setBusy(false);
    if (out.ok) { setError(""); setUrl(""); hook.reload(); events.reload(); return; }
    setError(errorCopy(out.error));
    focusFirstError(form.current);
  };
  return (
    <section className="card stack" aria-label="Webhook endpoint">
      <h2 className="h4">Webhook endpoint</h2>
      <p className="muted">Signed <code>locale.published</code> and <code>review.completed</code> events are sent here through Svix.</p>
      {hook.data && (
        <div className="secret">
          <p className="eyebrow">Current endpoint</p>
          <p className="break">{hook.data.url}</p>
          <p className="eyebrow">Signing secret</p>
          <code>{hook.data.signing_secret}</code>
        </div>
      )}
      <form ref={form} onSubmit={save} noValidate className="stack">
        <Field label="Endpoint URL" error={error}>{(p) => <input {...p} type="url" placeholder="https://ci.example.com/hooks/interline" value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} />}</Field>
        <div><Button type="submit" busy={busy}>Save endpoint</Button></div>
      </form>
      {events.data && events.data.events.length > 0 && (
        <div className="table-scroll" tabIndex={0} role="group" aria-label="Scrollable table">
          <table className="table">
            <thead><tr><th>Event</th><th>State</th><th>Attempts</th></tr></thead>
            <tbody>{events.data.events.map((e) => <tr key={e.event_id}><td className="break"><code>{e.event_id}</code></td><td>{e.state === "sent" ? "Sent" : "Pending"}</td><td className="num">{e.attempts}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SourceFilesCard({ slug, files }: { slug: string; files: Loaded<{ files: SourceFile[] }> }) {
  return (
    <section className="card stack" aria-label="Source files">
      <h2 className="h4">Source files</h2>
      <p className="muted">Uploaded originals are kept exactly as submitted.</p>
      {files.data && (files.data.files.length === 0 ? <p className="muted">No source files uploaded yet.</p> : (
        <ul className="rows">{files.data.files.map((f) => (
          <li key={f.file_id} className="row-item">
            <div><strong>{f.filename}</strong><p className="muted">{f.branch} · {f.size.toLocaleString("en-US")} bytes · {dateTime(f.at)}</p></div>
            <a className="btn btn-outline" href={`${projectPath(slug)}/source-files/${f.file_id}/original`} download={f.filename}><Download size={18} strokeWidth={1.5} aria-hidden="true" />Download original</a>
          </li>
        ))}</ul>
      ))}
    </section>
  );
}

function EraseDialog({ project, onClose }: { project: ProjectDetail; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const erase = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    const out = await act("Erasing project.", () => api("DELETE", projectPath(project.slug), { confirm: typed }), `Erased ${project.name} and every stored file.`);
    setBusy(false);
    if (out.ok) { await loadProjects(); onClose(); navigate("/desk"); return; }
    setError(errorCopy(out.error));
    focusFirstError(form.current);
  };
  return (
    <Dialog title="Erase project" onClose={onClose}>
      <form ref={form} onSubmit={erase} noValidate className="stack">
        <p>This removes {project.name} everywhere: its keys, translation memory, files, tokens, reviewer access, audit entries and webhook application. It can't be undone.</p>
        <Field label="Type the project slug to confirm" error={error} hint={`The slug is ${project.slug}.`}>
          {(p) => <input {...p} type="text" value={typed} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} autocomplete="off" />}
        </Field>
        <div className="dialog-actions"><Button type="submit" busy={busy}>Erase everything</Button><Button variant="outline" onClick={onClose}>Cancel</Button></div>
      </form>
    </Dialog>
  );
}

export function Settings({ slug }: { slug: string }) {
  useHeadingFocus("Project settings");
  const project = useLoad(() => api<ProjectDetail>("GET", projectPath(slug)), [slug]);
  const reviewers = useLoad(() => api<{ reviewers: Reviewer[] }>("GET", `${projectPath(slug)}/reviewers`), [slug]);
  const tokens = useLoad(() => api<{ tokens: Token[] }>("GET", `${projectPath(slug)}/tokens`), [slug]);
  const hook = useLoad(() => api<Webhook | null>("GET", `${projectPath(slug)}/webhook`).catch((e) => { if (e instanceof ApiError && e.status === 404) return null; throw e; }), [slug]);
  const events = useLoad(() => api<{ events: EventRow[] }>("GET", `${projectPath(slug)}/events`), [slug]);
  const files = useLoad(() => api<{ files: SourceFile[] }>("GET", `${projectPath(slug)}/source-files`), [slug]);
  const ready = useSettled(![project, reviewers, tokens, hook, events, files].some((l) => l.loading));
  const [erasing, setErasing] = useState(false);
  if (project.error?.status === 404) return <NotFound kind="project" />;
  return (
    <>
      <div className="title-row">
        <h1 className="display page-title">Settings</h1>
        <Link href={projectHref(slug)} className="btn btn-outline">Back to {project.data?.name ?? "project"}</Link>
      </div>
      {!ready ? <PageSkeleton /> : (
        <>
          <div className="settings-grid">
            <ReviewersCard slug={slug} reviewers={reviewers} />
            <TokensCard slug={slug} tokens={tokens} />
            <WebhookCard slug={slug} hook={hook} events={events} />
            <SourceFilesCard slug={slug} files={files} />
          </div>
          <section className="card danger-zone" aria-label="Erase">
            <div>
              <h2 className="h4">Erase this client</h2>
              <p className="muted">Removes the project and every stored file, token, reviewer scope and audit entry.</p>
            </div>
            <Button variant="outline" onClick={() => setErasing(true)}>Erase project</Button>
          </section>
        </>
      )}
      {erasing && project.data && <EraseDialog project={project.data} onClose={() => setErasing(false)} />}
    </>
  );
}
