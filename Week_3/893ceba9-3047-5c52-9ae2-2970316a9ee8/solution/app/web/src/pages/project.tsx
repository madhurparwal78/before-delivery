import { useLayoutEffect, useId, useRef, useState } from "preact/hooks";
import {
  ChevronLeft, ChevronRight, FileUp, GitMerge, Layers, ListChecks, Plus, RotateCcw, Send, Sparkles,
  Upload, UserCheck, Users,
} from "lucide-preact";
import type { ComponentChildren } from "preact";
import {
  ApiError, api, branchPath, projectPath, upload, type Branch, type ImportReport, type Operation, type Preview, type Project,
  type ProjectDetail, type Publish,
} from "../api";
import { GradientTile, RailHub, type Glyph } from "../illustrations";
import { useMediaQuery } from "../layout";
import { navigate, projectHref, setQuery, useRoute } from "../router";
import { act, complain, errorCopy, loadProjects, publishFailureCopy, say, useLoad } from "../store";
import { Button, Dialog, Field, LinkButton, Skeleton, StatusWord, cx, focusFirstError, reducedMotion, useHeadingFocus } from "../ui";
import { NotFound } from "./public";

const IN_PROGRESS = ["queued", "awaiting_host_confirmation"];

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function Counts({ items }: { items: [string, ComponentChildren][] }) {
  return (
    <dl className="counts">
      {items.map(([caption, value]) => (
        <div key={caption}><dt>{caption}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}

interface PanelProps { project: Project; detail: ProjectDetail; branch: string; preview?: Preview; ghost?: boolean; lang: string }

function PanelBody({ project, detail, branch, preview, ghost, lang }: PanelProps) {
  const isMain = branch === "main";
  const editor = projectHref(project.slug, "editor", { branch, lang });
  const merge = projectHref(project.slug, "merge", { branch });
  const Anchor = ghost ? ("span" as const) : LinkButton;
  const last = detail.last_publish?.pull_request ? `Pull request #${detail.last_publish.pull_request.number}` : "Never";
  return (
    <div className="rail-panel-grid">
      <div className="rail-copy">
        {!isMain && <p><StatusWord state={detail.branches.find((b) => b.name === branch)?.state ?? "open"} /></p>}
        {preview ? (
          <Counts
            items={isMain
              ? [["Keys", preview.keys], ["Needs review", preview.needs_review], ["Below MQM threshold", preview.below_threshold], ["Last publish", last]]
              : [["New keys", preview.new_keys], ["Edited keys", preview.edited_keys], ["Conflicts", preview.conflicts.length], ["Below MQM threshold", preview.below_threshold]]}
          />
        ) : (
          <div className="counts counts-skeleton" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => <div key={i}><span className="bar" style={{ width: "48%" }} /><span className="bar big" style={{ width: "28%" }} /></div>)}
          </div>
        )}
        {!isMain && preview && (
          <div className="conflict-list">
            <h3 className="h5">Conflicting keys</h3>
            {preview.conflicts.length === 0
              ? <p className="muted">No conflicts with main.</p>
              : <ul>{preview.conflicts.map((c) => <li key={c.id}><strong>{c.key}</strong> <span className="muted">{c.field}</span></li>)}</ul>}
          </div>
        )}
        <div className="rail-links">
          {ghost ? <span className="btn btn-outline">Open editor</span> : <Anchor variant="outline" arrow href={editor}>Open editor</Anchor>}
          {!isMain && (ghost ? <span className="btn btn-outline">Open merge preview</span> : <Anchor variant="outline" arrow href={merge}>Open merge preview</Anchor>)}
        </div>
      </div>
      <RailHub
        branch={branch}
        repository={project.repository}
        tmEntries={detail.tm_entries}
        routes={project.target_languages.map((l) => [l, project.ai_routes[l] ?? "lexa-general"] as [string, string])}
      />
    </div>
  );
}

interface RailProps { project: Project; detail: ProjectDetail; tabs: Branch[]; selected: string; lang: string; refresh: number }

function BranchRail({ project, detail, tabs, selected, lang, refresh }: RailProps) {
  const [view, setView] = useState<{ branch: string; preview?: Preview }>({ branch: selected });
  const [leaving, setLeaving] = useState<{ branch: string; preview: Preview } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const animate = useRef(false);
  const strip = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  const [ready, setReady] = useState(false);
  const base = useId();

  useLayoutEffect(() => {
    let live = true;
    const prev = viewRef.current;
    if (prev.branch !== selected) {
      animate.current = true;
      if (prev.preview && !reducedMotion()) setLeaving({ branch: prev.branch, preview: prev.preview });
      setView({ branch: selected });
    }
    api<Preview>("GET", `${branchPath(project.slug, selected)}/merge-preview`).then(
      (preview) => { if (live) setView({ branch: selected, preview }); },
      () => { if (live) setView({ branch: selected }); },
    );
    return () => { live = false; };
  }, [selected, refresh, project.slug]);

  const measure = () => {
    const tab = tabRefs.current[selected];
    const label = tab?.firstElementChild as HTMLElement | null;
    if (tab && label) setIndicator({ left: label.offsetLeft, width: label.offsetWidth });
  };
  useLayoutEffect(measure, [selected, tabs.map((t) => t.name).join("|")]);
  useLayoutEffect(() => {
    setReady(true);
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const choose = (name: string, focus: boolean) => {
    setQuery({ branch: name });
    const tab = tabRefs.current[name];
    if (focus) tab?.focus();
    const s = strip.current;
    if (tab && s) s.scrollTo({ left: tab.offsetLeft - (s.clientWidth - tab.offsetWidth) / 2, behavior: reducedMotion() ? "auto" : "smooth" });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const names = tabs.map((t) => t.name);
    const at = names.indexOf(selected);
    let next = -1;
    if (e.key === "ArrowRight") next = (at + 1) % names.length;
    else if (e.key === "ArrowLeft") next = (at - 1 + names.length) % names.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = names.length - 1;
    if (next < 0) return;
    e.preventDefault();
    choose(names[next], true);
  };

  const tabId = (name: string) => `${base}-tab-${tabs.findIndex((t) => t.name === name)}`;
  const common = { project, detail, lang };
  return (
    <section className="rail" aria-label="Branch rail">
      <div className="rail-strip" ref={strip}>
        <div className="rail-inner">
          <div role="tablist" aria-label="Branches" className="rail-list" onKeyDown={onKeyDown}>
            {tabs.map((t, i) => (
              <button
                key={t.name}
                id={`${base}-tab-${i}`}
                ref={(el) => { tabRefs.current[t.name] = el; }}
                type="button"
                role="tab"
                className="rail-tab"
                aria-selected={t.name === selected}
                aria-controls={`${base}-panel`}
                tabIndex={t.name === selected ? 0 : -1}
                onClick={() => choose(t.name, false)}
              >
                <span className="rail-label">{t.name}</span>
              </button>
            ))}
          </div>
          {indicator && <span className={cx("rail-indicator", ready && "ready")} style={{ transform: `translateX(${indicator.left}px)`, width: `${indicator.width}px` }} aria-hidden="true" />}
        </div>
      </div>
      <div className="rail-panels card">
        {leaving && (
          <div className="rail-panel leaving" aria-hidden="true" onAnimationEnd={() => setLeaving(null)}>
            <PanelBody {...common} branch={leaving.branch} preview={leaving.preview} ghost />
          </div>
        )}
        <div
          key={selected}
          id={`${base}-panel`}
          role="tabpanel"
          aria-labelledby={tabId(selected)}
          className={cx("rail-panel", animate.current && "entering")}
        >
          <PanelBody {...common} branch={selected} preview={view.branch === selected ? view.preview : undefined} />
        </div>
      </div>
    </section>
  );
}

function Health({ project, detail, refresh, selected }: { project: Project; detail: ProjectDetail; refresh: number; selected: string }) {
  const imports = useLoad(() => api<{ imports: ImportReport[] }>("GET", `${projectPath(project.slug)}/tm/imports`), [project.slug, refresh]);
  const ops = useLoad(() => api<{ operations: Operation[] }>("GET", `${projectPath(project.slug)}/operations`), [project.slug, refresh]);
  const live = detail.branches.filter((b) => !b.is_main && (b.state === "open" || b.state === "in_review"));
  const previews = useLoad(
    () => Promise.all(live.map((b) => api<Preview>("GET", `${branchPath(project.slug, b.name)}/merge-preview`))),
    [project.slug, refresh, live.map((b) => b.name).join("|")],
  );
  const latest = imports.data?.imports.find((i) => !i.restored_at);
  const conflicts = (previews.data ?? []).reduce((n, pv) => n + pv.conflicts.filter((c) => !c.resolution).length, 0);
  const lastMerge = ops.data?.operations.find((o) => o.kind === "merge");
  const mergeTarget = selected !== "main" ? selected : live[0]?.name;
  const loading = imports.loading && !imports.data;
  return (
    <div className="health-grid">
      <section className="card health" aria-label="Import health">
        <div className="tile-row"><GradientTile icon={FileUp} size={60} glyph={26} /><GradientTile icon={Layers} size={60} glyph={26} /><GradientTile icon={ListChecks} size={60} glyph={26} /></div>
        <h2 className="h4">Import health</h2>
        <p>What the latest translation memory import added, merged and reused.</p>
        <p className="living">Living with</p>
        {loading ? <Skeleton lines={4} /> : (
          <ul className="figures">
            <li><span>Entries added</span><strong>{latest?.added ?? 0}</strong></li>
            <li><span>Duplicates merged</span><strong>{latest?.duplicates ?? 0}</strong></li>
            <li><span>Exact matches reused</span><strong>{latest?.applied ?? 0}</strong></li>
            <li><span>Rows needing attention</span><strong>{latest?.rows.length ?? 0}</strong></li>
          </ul>
        )}
        {!latest && !loading && <p className="muted">No imports yet.</p>}
        <LinkButton variant="outline" arrow className="block" href={projectHref(project.slug, "tm")}>Open import report</LinkButton>
      </section>
      <section className="card health" aria-label="Merge health">
        <div className="tile-row"><GradientTile icon={GitMerge} size={60} glyph={26} /><GradientTile icon={RotateCcw} size={60} glyph={26} /><GradientTile icon={Users} size={60} glyph={26} /></div>
        <h2 className="h4">Merge health</h2>
        <p>Where the open branches stand against main, and what you can still undo.</p>
        <p className="living">Living with</p>
        <ul className="figures">
          <li><span>Conflicts open</span><strong>{conflicts}</strong></li>
          <li><span>Branches in review</span><strong>{live.filter((b) => b.state === "in_review").length}</strong></li>
          <li><span>Last merge</span><strong>{lastMerge ? lastMerge.at.slice(0, 10) : "Never"}</strong></li>
          <li><span>Restorable operations</span><strong>{(ops.data?.operations ?? []).filter((o) => o.restorable).length}</strong></li>
        </ul>
        <LinkButton variant="outline" arrow className="block" href={mergeTarget ? projectHref(project.slug, "merge", { branch: mergeTarget }) : projectHref(project.slug, "merge")}>Open merge preview</LinkButton>
      </section>
    </div>
  );
}

type DialogName = "branch" | "upload" | "draft" | "assign" | "publish";

interface WorkflowProps { slug: string; selected: string; onOpen: (d: DialogName) => void; detail: ProjectDetail }

function Workflows({ slug, selected, onOpen, detail }: WorkflowProps) {
  const narrow = useMediaQuery("(max-width: 767px)");
  const [index, setIndex] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const target = useRef<number | null>(null);
  const feature = detail.branches.find((b) => !b.is_main && (b.state === "open" || b.state === "in_review"));
  const cards: { icon: Glyph; title: string; text: string; button: string; run: () => void }[] = [
    { icon: FileUp, title: "Bring in a legacy TM", text: "Import a TMX file or a spreadsheet and fill untranslated segments from exact matches.", button: "Import translation memory", run: () => navigate(projectHref(slug, "tm")) },
    { icon: Upload, title: "Update source strings", text: "Upload a JSON locale file to an open branch; the original is kept as submitted.", button: "Upload source file", run: () => onOpen("upload") },
    { icon: Sparkles, title: "Draft a language", text: "Reuse exact matches first, then ask the AI route set for that language.", button: "Draft with AI", run: () => onOpen("draft") },
    { icon: UserCheck, title: "Hand segments to a reviewer", text: "Give a client reviewer every segment that needs review in one language.", button: "Assign review", run: () => onOpen("assign") },
    { icon: GitMerge, title: "Bring a branch home", text: "Review the preview, resolve conflicts and merge into main.", button: "Merge a branch", run: () => navigate(projectHref(slug, "merge", selected !== "main" ? { branch: selected } : feature ? { branch: feature.name } : {})) },
    { icon: Send, title: "Publish approved strings", text: "Open a pull request with approved locale files and wait for the host to confirm it.", button: "Publish", run: () => onOpen("publish") },
  ];
  useLayoutEffect(() => { if (!narrow) setIndex(0); }, [narrow]);
  const go = (n: number) => {
    const i = Math.max(0, Math.min(cards.length - 1, n));
    const el = viewport.current;
    setIndex(i);
    if (!el) return;
    target.current = Math.abs(el.scrollLeft - i * el.clientWidth) > 1 ? i : null;
    el.scrollTo({ left: i * el.clientWidth, behavior: reducedMotion() ? "auto" : "smooth" });
  };
  const onScroll = () => {
    const el = viewport.current;
    if (!el || !narrow) return;
    const at = Math.round(el.scrollLeft / el.clientWidth);
    if (target.current !== null) {
      if (at === target.current) target.current = null;
      return;
    }
    setIndex(at);
  };
  const onScrollEnd = () => {
    const el = viewport.current;
    if (!el || !narrow || target.current !== null) return;
    const at = Math.round(el.scrollLeft / el.clientWidth);
    if (Math.abs(el.scrollLeft - at * el.clientWidth) > 1) el.scrollTo({ left: at * el.clientWidth, behavior: reducedMotion() ? "auto" : "smooth" });
  };
  return (
    <section className="band-inner workflows" aria-label="Workflows">
      <div className="carousel" ref={viewport} onScroll={onScroll} onScrollEnd={onScrollEnd}>
        <div className="carousel-track">
          {cards.map((c, i) => (
            <article key={c.button} className="card workflow">
              <GradientTile icon={c.icon} />
              <h3 className="h4">{c.title}</h3>
              <p>{c.text}</p>
              <Button variant="primary" tabIndex={narrow && i !== index ? -1 : 0} onClick={c.run}>{c.button}</Button>
            </article>
          ))}
        </div>
      </div>
      {narrow && (
        <div className="carousel-controls">
          <button type="button" className="icon-btn" aria-label="Previous workflow" disabled={index === 0} onClick={() => go(index - 1)}><ChevronLeft size={24} strokeWidth={1.5} aria-hidden="true" /></button>
          <div className="dots">
            {cards.map((c, i) => (
              <button key={c.button} type="button" className="dot-btn" aria-label={`Show workflow ${i + 1}`} aria-current={i === index ? "true" : undefined} onClick={() => go(i)}><span className="dot" /></button>
            ))}
          </div>
          <button type="button" className="icon-btn" aria-label="Next workflow" disabled={index === cards.length - 1} onClick={() => go(index + 1)}><ChevronRight size={24} strokeWidth={1.5} aria-hidden="true" /></button>
        </div>
      )}
    </section>
  );
}

function PublishStatus({ project, initial, onChange }: { project: Project; initial: Publish | null; onChange: () => void }) {
  const [current, setCurrent] = useState<Publish | null>(initial);
  useLayoutEffect(() => setCurrent(initial), [initial?.id, initial?.state]);
  useLayoutEffect(() => {
    publishHandle.set = (p) => setCurrent(p);
    return () => { publishHandle.set = () => {}; };
  }, []);
  useLayoutEffect(() => {
    if (!current || !IN_PROGRESS.includes(current.state)) return;
    const timer = setInterval(async () => {
      try {
        const next = await api<Publish>("GET", `${projectPath(project.slug)}/publishes/${current.id}`);
        if (next.state === current.state) return;
        setCurrent(next);
        if (next.state === "published") say(`Published as pull request #${next.pull_request?.number}.`);
        else if (next.state === "failed") complain(publishFailureCopy(next.failure_reason));
        if (!IN_PROGRESS.includes(next.state)) onChange();
      } catch { /* the next tick tries again */ }
    }, 2000);
    return () => clearInterval(timer);
  }, [current?.id, current?.state, project.slug]);
  const sentence = !current ? "" : {
    queued: "Publish queued.",
    awaiting_host_confirmation: "Waiting for the repository host to confirm the pull request.",
    published: `Published as pull request #${current.pull_request?.number}.`,
    failed: publishFailureCopy(current.failure_reason),
  }[current.state];
  return (
    <section className="card publish-status" aria-label="Publish status">
      <h2 className="h4">Publish status</h2>
      {!current ? <p className="muted">No publishes yet.</p> : (
        <>
          <p><StatusWord state={current.state} /> <span className="muted">from {current.branch}</span></p>
          <p>{sentence}</p>
        </>
      )}
    </section>
  );
}

const publishHandle: { set: (p: Publish) => void } = { set: () => {} };

function NewBranchDialog({ slug, onClose, onDone }: { slug: string; onClose: () => void; onDone: (name: string) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    const out = await act("Creating branch.", () => api<Branch>("POST", `${projectPath(slug)}/branches`, { name }), (b) => `Created branch ${b.name}.`);
    setBusy(false);
    if (out.ok) { onDone(out.value.name); onClose(); return; }
    setError(errorCopy(out.error));
    focusFirstError(form.current);
  };
  return (
    <Dialog title="New branch" onClose={onClose}>
      <form ref={form} onSubmit={submit} noValidate className="stack">
        <Field label="Branch name" error={error} hint="Lowercase letters, digits, slashes, hyphens or underscores.">
          {(p) => <input {...p} type="text" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} autocomplete="off" />}
        </Field>
        <div className="dialog-actions"><Button type="submit" busy={busy}>Create branch</Button><Button variant="outline" onClick={onClose}>Cancel</Button></div>
      </form>
    </Dialog>
  );
}

function BranchSelect({ id, branches, value, onChange, props }: { id: string; branches: Branch[]; value: string; onChange: (v: string) => void; props: object }) {
  return (
    <select {...props} id={id} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
      {branches.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
    </select>
  );
}

interface FlowProps { project: ProjectDetail; selected: string; lang: string; onClose: () => void; onDone: () => void }

function UploadDialog({ project, selected, onClose, onDone }: FlowProps) {
  const open = project.branches.filter((b) => b.state === "open");
  const [branch, setBranch] = useState(open.some((b) => b.name === selected) ? selected : "main");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!file) { setError("Choose a file to upload."); complain("Choose a file to upload."); focusFirstError(form.current); return; }
    setBusy(true);
    const data = new FormData();
    data.set("file", file, file.name);
    const out = await act("Uploading source file.", () => upload<{ filename: string; keys_added: number; keys_changed: number; keys_unchanged: number }>(`${branchPath(project.slug, branch)}/source-files`, data),
      (r) => `Stored ${r.filename} as submitted: ${r.keys_added} keys added, ${r.keys_changed} changed, ${r.keys_unchanged} unchanged.`);
    setBusy(false);
    if (out.ok) { onDone(); onClose(); return; }
    setError(errorCopy(out.error));
    focusFirstError(form.current);
  };
  return (
    <Dialog title="Upload source file" onClose={onClose}>
      <form ref={form} onSubmit={submit} noValidate className="stack">
        <Field label="Branch">{(p) => <BranchSelect id={p.id} props={p} branches={open} value={branch} onChange={setBranch} />}</Field>
        <Field label="Source file" error={error} hint="A JSON object whose values are all strings.">
          {(p) => <input {...p} type="file" accept=".json,application/json" onChange={(e) => setFile((e.target as HTMLInputElement).files?.[0] ?? null)} />}
        </Field>
        <div className="dialog-actions"><Button type="submit" busy={busy}>Upload</Button><Button variant="outline" onClick={onClose}>Cancel</Button></div>
      </form>
    </Dialog>
  );
}

function DraftDialog({ project, selected, lang, onClose, onDone }: FlowProps) {
  const open = project.branches.filter((b) => b.state === "open");
  const [branch, setBranch] = useState(open.some((b) => b.name === selected) ? selected : "main");
  const [language, setLanguage] = useState(lang);
  const [busy, setBusy] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    const out = await act(`Drafting ${language} segments.`, () => api<{ tm_reused: number; ai_drafted: number }>("POST", `${branchPath(project.slug, branch)}/drafts`, { language }),
      (r) => `Drafted ${r.ai_drafted} segments with AI and reused ${r.tm_reused} exact matches.`);
    setBusy(false);
    if (out.ok) { onDone(); onClose(); } else if (out.error instanceof ApiError && out.error.code === "ai_engine_unavailable") onDone();
  };
  return (
    <Dialog title="Draft with AI" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <Field label="Branch">{(p) => <BranchSelect id={p.id} props={p} branches={open} value={branch} onChange={setBranch} />}</Field>
        <Field label="Language">
          {(p) => <select {...p} value={language} onChange={(e) => setLanguage((e.target as HTMLSelectElement).value)}>{project.target_languages.map((l) => <option key={l} value={l}>{l}</option>)}</select>}
        </Field>
        <div className="dialog-actions"><Button type="submit" busy={busy}>Draft</Button><Button variant="outline" onClick={onClose}>Cancel</Button></div>
      </form>
    </Dialog>
  );
}

function AssignDialog({ project, selected, lang, onClose, onDone }: FlowProps) {
  const live = project.branches.filter((b) => b.state === "open" || b.state === "in_review");
  const reviewers = useLoad(() => api<{ reviewers: { id: string; name: string; email: string }[] }>("GET", `${projectPath(project.slug)}/reviewers`), [project.slug]);
  const [reviewer, setReviewer] = useState("");
  const [branch, setBranch] = useState(live.some((b) => b.name === selected) ? selected : "main");
  const [language, setLanguage] = useState(lang);
  const [busy, setBusy] = useState(false);
  const list = reviewers.data?.reviewers ?? [];
  const chosen = reviewer || list[0]?.id || "";
  const submit = async (e: Event) => {
    e.preventDefault();
    const who = list.find((r) => r.id === chosen);
    setBusy(true);
    const out = await act("Assigning segments.", () => api<{ segment_ids: string[]; expires_at: string }>("POST", `${projectPath(project.slug)}/assignments`, { reviewer_id: chosen, branch, language }),
      (r) => `Assigned ${r.segment_ids.length} segments to ${who?.name ?? "the reviewer"} until ${new Date(r.expires_at).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit" })}.`,
      { branch, language });
    setBusy(false);
    if (out.ok) { onDone(); onClose(); }
  };
  return (
    <Dialog title="Assign review" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <Field label="Reviewer" hint={list.length === 0 && !reviewers.loading ? "Invite a reviewer in the project settings first." : undefined}>
          {(p) => (
            <select {...p} value={chosen} onChange={(e) => setReviewer((e.target as HTMLSelectElement).value)}>
              {list.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Branch">{(p) => <BranchSelect id={p.id} props={p} branches={live} value={branch} onChange={setBranch} />}</Field>
        <Field label="Language">
          {(p) => <select {...p} value={language} onChange={(e) => setLanguage((e.target as HTMLSelectElement).value)}>{project.target_languages.map((l) => <option key={l} value={l}>{l}</option>)}</select>}
        </Field>
        <div className="dialog-actions"><Button type="submit" busy={busy} disabled={!chosen}>Assign</Button><Button variant="outline" onClick={onClose}>Cancel</Button></div>
      </form>
    </Dialog>
  );
}

function PublishDialog({ project, selected, onClose, onDone }: FlowProps) {
  const live = project.branches.filter((b) => b.state === "open" || b.state === "in_review");
  const [branch, setBranch] = useState(live.some((b) => b.name === selected) ? selected : "main");
  const [busy, setBusy] = useState(false);
  const key = useRef(randomKey());
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    const out = await act("Publish queued.", () => api<Publish>("POST", `${projectPath(project.slug)}/publishes`, { branch }, { "Idempotency-Key": key.current }), "Publish queued.");
    setBusy(false);
    if (out.ok) { publishHandle.set(out.value); onDone(); onClose(); }
    else if (!(out.error instanceof ApiError) || out.error.code !== "network") key.current = randomKey();
  };
  return (
    <Dialog title="Publish" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <Field label="Branch">{(p) => <BranchSelect id={p.id} props={p} branches={live} value={branch} onChange={setBranch} />}</Field>
        <div className="dialog-actions"><Button type="submit" busy={busy}>Publish to repository</Button><Button variant="outline" onClick={onClose}>Cancel</Button></div>
      </form>
    </Dialog>
  );
}

export function ProjectPage({ slug }: { slug: string }) {
  const route = useRoute();
  const detail = useLoad(() => api<ProjectDetail>("GET", projectPath(slug)), [slug]);
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [refresh, setRefresh] = useState(0);
  const d = detail.data;
  useHeadingFocus(d?.name ?? "Project");
  const tabs = (d?.branches ?? []).filter((b) => b.is_main || b.state === "open" || b.state === "in_review");
  const wanted = route.query.get("branch");
  const selected = tabs.find((t) => t.name === wanted)?.name ?? "main";
  useLayoutEffect(() => { if (d && wanted && wanted !== selected) setQuery({ branch: "main" }); }, [d, wanted, selected]);
  if (detail.error?.status === 404) return <NotFound kind="project" />;
  if (!d) return <><h1 className="display page-title">&nbsp;</h1><div className="card"><Skeleton lines={5} /></div></>;
  const lang = route.query.get("lang") ?? d.target_languages[0];
  const changed = () => { detail.reload(); setRefresh((n) => n + 1); void loadProjects(); };
  const flow = { project: d, selected, lang, onClose: () => setDialog(null), onDone: changed };
  return (
    <>
      <div className="title-row">
        <h1 className="display page-title">{d.name}</h1>
        <Button variant="outline" onClick={() => setDialog("branch")}><Plus size={18} strokeWidth={1.75} aria-hidden="true" />New branch</Button>
      </div>
      <p className="muted lede">{d.client} · {d.repository} · {d.source_language} → {d.target_languages.join(", ")}</p>
      <BranchRail project={d} detail={d} tabs={tabs} selected={selected} lang={lang} refresh={refresh} />
      <Health project={d} detail={d} refresh={refresh} selected={selected} />
      <div className="band band-grey bleed">
        <div className="container"><Workflows slug={d.slug} selected={selected} detail={d} onOpen={setDialog} /></div>
      </div>
      <PublishStatus project={d} initial={d.last_publish} onChange={changed} />
      {dialog === "branch" && <NewBranchDialog slug={slug} onClose={() => setDialog(null)} onDone={(name) => { changed(); setQuery({ branch: name }); }} />}
      {dialog === "upload" && <UploadDialog {...flow} />}
      {dialog === "draft" && <DraftDialog {...flow} />}
      {dialog === "assign" && <AssignDialog {...flow} />}
      {dialog === "publish" && <PublishDialog {...flow} />}
    </>
  );
}
