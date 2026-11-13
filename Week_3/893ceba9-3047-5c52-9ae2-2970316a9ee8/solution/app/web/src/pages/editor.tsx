import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { api, branchPath, projectPath, type KeyItem, type Project, type Segment } from "../api";
import { projectHref, setQuery, useRoute, Link } from "../router";
import { act, dateTime, errorCopy, useLoad } from "../store";
import { Button, Dialog, EmptyState, Field, PageSkeleton, StatusWord, focusFirstError, useHeadingFocus, useSettled } from "../ui";
import { NotFound } from "./public";

const CATEGORIES = ["accuracy", "fluency", "terminology", "style", "locale-convention"];
const SEVERITIES = ["minor", "major", "critical"];

interface Match { entry_id: string; source: string; target: string; reused_value: string }

function IssueDialog({ segment, onClose, onAdded }: { segment: Segment; onClose: () => void; onAdded: (s: Segment) => void }) {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [severity, setSeverity] = useState(SEVERITIES[0]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    const out = await act("Recording MQM issues.", () => api<Segment>("POST", `/api/segments/${segment.id}/issues`, { category, severity, note }), scoredCopy);
    setBusy(false);
    if (out.ok) { onAdded(out.value); onClose(); return; }
    setError(errorCopy(out.error));
    focusFirstError(form.current);
  };
  return (
    <Dialog title="Record MQM issue" onClose={onClose}>
      <form ref={form} onSubmit={submit} noValidate className="stack">
        <Field label="Category">{(p) => <select {...p} value={category} onChange={(e) => setCategory((e.target as HTMLSelectElement).value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>}</Field>
        <Field label="Severity">{(p) => <select {...p} value={severity} onChange={(e) => setSeverity((e.target as HTMLSelectElement).value)}>{SEVERITIES.map((c) => <option key={c}>{c}</option>)}</select>}</Field>
        <Field label="Note" error={error}>{(p) => <textarea {...p} rows={3} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />}</Field>
        <div className="dialog-actions"><Button type="submit" busy={busy}>Add issue</Button><Button variant="outline" onClick={onClose}>Cancel</Button></div>
      </form>
    </Dialog>
  );
}

const scoredCopy = (s: Segment) => (s.status === "needs_review" ? `Scored MQM ${s.score}. Sent to review.` : `Scored MQM ${s.score}.`);

export function Editor({ slug }: { slug: string }) {
  useHeadingFocus("Segment editor");
  const route = useRoute();
  const project = useLoad(() => api<Project>("GET", projectPath(slug)), [slug]);
  const branch = route.query.get("branch") ?? "main";
  const lang = route.query.get("lang") ?? project.data?.target_languages[0] ?? "";
  const keys = useLoad(() => (lang ? api<{ keys: KeyItem[] }>("GET", `${branchPath(slug, branch)}/keys?lang=${encodeURIComponent(lang)}`) : new Promise<{ keys: KeyItem[] }>(() => {})), [slug, branch, lang]);
  const list = keys.data?.keys ?? [];
  const segmentId = route.query.get("segment") ?? list[0]?.translations[lang]?.segment_id;
  const segment = useLoad(() => (segmentId ? api<Segment>("GET", `/api/segments/${segmentId}`) : Promise.resolve(undefined)), [segmentId]);
  const [current, setCurrent] = useState<Segment | undefined>();
  const [text, setText] = useState("");
  const [match, setMatch] = useState<Match | null | undefined>(undefined);
  const [issue, setIssue] = useState(false);
  const [busy, setBusy] = useState(false);
  const adopt = (s: Segment) => { setCurrent(s); setText(s.value ?? ""); };
  useLayoutEffect(() => { if (segment.data) adopt(segment.data); }, [segment.data]);
  useLayoutEffect(() => {
    setMatch(undefined);
    const source = current?.source;
    if (!source || !lang) return;
    let live = true;
    api<{ match: Match | null }>("POST", `${projectPath(slug)}/tm/match`, { source, language: lang }).then((r) => { if (live) setMatch(r.match); }, () => { if (live) setMatch(null); });
    return () => { live = false; };
  }, [current?.id, current?.source, lang, slug]);
  const ready = useSettled(!project.loading && (!lang || !keys.loading) && !segment.loading && (!segmentId || !!current || !!segment.error) && (!current?.source || match !== undefined));
  if (project.error?.status === 404 || keys.error?.status === 404) return <NotFound kind="project" />;

  const run = async <T,>(pending: string, fn: () => Promise<T>, success: string | ((v: T) => string), done: (v: T) => void) => {
    setBusy(true);
    const out = await act(pending, fn, success);
    setBusy(false);
    if (out.ok) done(out.value);
  };
  const save = () => current && run("Saving.", () => api<Segment>("PUT", `/api/segments/${current.id}/value`, { value: text }), `Saved ${current.key}.`, (s) => { adopt(s); keys.reload(); });
  const score = () => current && run("Recording MQM issues.", () => api<Segment>("POST", `/api/segments/${current.id}/score`, { issues: current.issues }), scoredCopy, (s) => { adopt(s); keys.reload(); });
  const approve = () => current && run("Approving.", () => api<Segment>("POST", `/api/segments/${current.id}/approve`, {}), "Approved.", (s) => { adopt(s); keys.reload(); });
  const status = current?.status ?? "";
  return (
    <>
      <div className="title-row">
        <h1 className="display page-title">Segment editor</h1>
        <Link href={projectHref(slug, "", { branch })} className="btn btn-outline">Back to {project.data?.name ?? "project"}</Link>
      </div>
      <p className="muted lede">{branch} · {lang}</p>
      {!ready ? <PageSkeleton lines={10} /> : (
      <div className="editor-grid">
        <section className="card editor-segments" aria-label="Segments">
          <h2 className="h5">Segments</h2>
          {keys.data && list.length === 0 && <EmptyState heading="No keys on this branch" text="Add a key or upload a source file to start translating." />}
          <ul className="segment-list" tabIndex={0}>
            {list.map((k) => {
              const t = k.translations[lang];
              return (
                <li key={k.id}>
                  <button type="button" className="segment-pick" aria-current={t?.segment_id === segmentId ? "true" : undefined} onClick={() => t && setQuery({ segment: t.segment_id })}>{k.name}</button>
                  {t && <StatusWord state={t.status} />}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="card editor-main" aria-label="Segment editor">
          {!current ? <p className="muted">Choose a segment to edit it.</p> : (
            <div className="stack">
              <div>
                <p className="eyebrow">Key</p>
                <h2 className="h4 key-name">{current.key}</h2>
              </div>
              <div>
                <p className="eyebrow">Source ({project.data?.source_language})</p>
                <p className="source-text">{current.source ?? "This key was removed."}</p>
              </div>
              <Field label={`Translation (${lang})`}>
                {(p) => (
                  <textarea
                    {...p}
                    rows={5}
                    value={text}
                    onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); } }}
                  />
                )}
              </Field>
              <p><StatusWord state={current.status} /></p>
              <div className="action-row">
                <Button onClick={() => void save()} busy={busy} disabled={text.trim() === ""}>Save translation</Button>
                <Button variant="outline" onClick={() => setIssue(true)}>Record MQM issue</Button>
                <Button variant="outline" onClick={() => void score()} busy={busy} disabled={!["drafted", "scored", "needs_review"].includes(status)}>Score</Button>
                <Button variant="outline" onClick={() => void approve()} busy={busy} disabled={!["scored", "needs_review"].includes(status)}>Approve</Button>
              </div>
            </div>
          )}
        </section>

        <section className="card editor-quality" aria-label="Quality and history">
          {!current ? <p className="muted">No segment selected.</p> : (
            <div className="stack">
              <p className="mqm-line">{current.score === null ? "Not scored" : <>MQM <span className="num">{current.score}</span></>}</p>
              <div>
                <h3 className="h5">Issues</h3>
                {current.issues.length === 0 ? <p className="muted">No issues recorded.</p> : (
                  <ul className="plain-list">{current.issues.map((i, n) => <li key={n}><strong>{i.category}</strong> · {i.severity}{i.note && <span className="muted"> — {i.note}</span>}</li>)}</ul>
                )}
              </div>
              <div className="tm-box">
                {match ? (
                  <>
                    <h3 className="h5">Exact match from translation memory</h3>
                    <p className="muted">{match.source}</p>
                    <p>{match.reused_value}</p>
                  </>
                ) : <p className="muted">No exact match.</p>}
              </div>
              <div>
                <h3 className="h5">Comments</h3>
                {current.comments.length === 0 ? <p className="muted">No comments yet.</p> : (
                  <ul className="plain-list">{current.comments.map((c) => <li key={c.id}><strong>{c.author}</strong> <span className="muted">{dateTime(c.at)}</span><br />{c.body}</li>)}</ul>
                )}
              </div>
              <div>
                <h3 className="h5">Status history</h3>
                {current.history.length === 0 && <p className="muted">No status changes yet.</p>}
                <ol className="plain-list history">
                  {current.history.map((h, i) => (
                    <li key={i}><span className="muted">{dateTime(h.at)}</span> {h.actor}: {h.from ?? "new"} → {h.to}{h.note ? ` (${h.note})` : ""}</li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </section>
      </div>
      )}
      {issue && current && <IssueDialog segment={current} onClose={() => setIssue(false)} onAdded={(s) => { adopt(s); keys.reload(); }} />}
    </>
  );
}
