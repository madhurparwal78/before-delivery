// The notebook (path /): top bar, file-tree rail, note column and context pane.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { BookOpen, Files, Lock, LockOpen, PanelBottom, Pencil, Plus, RefreshCw, TriangleAlert, User, X } from "lucide-react";
import { AccountDialog, PassphraseDialogs } from "./AccountDialog.tsx";
import { History } from "./History.tsx";
import { createNote, dismissConflict, loadSampleCase, requestUnlock, saveNote, syncNow } from "./sync.ts";
import { byTitle, notesIn, openNote, selectNotebook, useApp, type AppState, type Note } from "./store.ts";
import { CairnMark, useTrap } from "./ui.tsx";
import { Ring } from "./workbench/Ring.tsx";
import { Workbench } from "./workbench/Workbench.tsx";
import { prefersReducedMotion } from "./workbench/crossing.ts";
import { nameIndex, nameKey, wikilinks } from "../shared/boundary.ts";
import { plainText, renderBody } from "../shared/render.ts";

/** The global sync status copy from Feedback states. */
function statusCopy(s: AppState): string {
  if (s.session.kind === "signed_in" && !s.session.device.approved) return "Waiting for device approval — check your email";
  if (s.session.kind !== "signed_in" || !s.notebooks.some((b) => b.vaultId)) return "Local only — not syncing";
  const n = s.queue.length;
  if (s.problem === "read_only") return "Vault is read-only — Sync has lapsed";
  if (s.problem === "storage") return `sync paused: storage unavailable — ${n} queued`;
  if (s.problem === "billing") return `sync paused: billing unavailable — ${n} queued`;
  if (s.problem === "offline") return `Offline — ${n} queued`;
  if (s.inFlight > 0 || n > 0) return `Syncing — ${n} queued`;
  return "All changes synced";
}

type Tab = "Backlinks" | "History" | "Graph" | "Publish";
const TABS: Tab[] = ["Backlinks", "History", "Graph", "Publish"];

let focusTitleFor: string | null = null;

export function Notebook() {
  const app = useApp();
  const [accountOpen, setAccountOpen] = useState(false);
  const railPanel = usePanel();
  const panePanel = usePanel();
  const railOpen = railPanel.phase === "open";
  const paneOpen = panePanel.phase === "open";
  const [tab, setTab] = useState<Tab>("Backlinks");
  const rail = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLElement>(null);
  const narrowRail = useMedia("(max-width: 1023px)");
  const narrowPane = useMedia("(max-width: 759px)");
  useTrap(rail, railOpen && narrowRail, railPanel.close);
  useTrap(pane, paneOpen && narrowPane, panePanel.close);

  const notes = notesIn(app.activeNotebookId).sort(byTitle);
  const open = notes.find((n) => n.id === app.openNoteId);
  const status = statusCopy(app);
  const syncing = app.session.kind === "signed_in" && app.notebooks.some((b) => b.vaultId);

  return (
    <div className={`app-shell${tab === "Publish" ? " publishing" : ""}`}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Cairn notebook"><CairnMark /> <span className="brand-name">Cairn</span></a>
        <button type="button" className="icon-button files-button" aria-label="Files" aria-expanded={railOpen} onClick={railPanel.open}>
          <Files aria-hidden size={18} strokeWidth={1.5} /> <span className="button-text">Files</span>
        </button>
        <div className={`sync-status${app.inFlight > 0 ? " busy" : ""}`} role="status" aria-label="Sync status">
          <span className="pending-dot" aria-hidden="true" />
          <span>{status}</span>
        </div>
        {syncing && (
          <button type="button" className="icon-button" aria-label="Sync now" onClick={syncNow}>
            <RefreshCw aria-hidden size={18} strokeWidth={1.5} /> <span className="button-text">Sync now</span>
          </button>
        )}
        <button type="button" className="icon-button context-button" aria-label="Context" aria-expanded={paneOpen} onClick={panePanel.open}>
          <PanelBottom aria-hidden size={18} strokeWidth={1.5} /> <span className="button-text">Context</span>
        </button>
        <button type="button" className="icon-button account-button" aria-label="Account" onClick={() => setAccountOpen(true)}>
          <User aria-hidden size={18} strokeWidth={1.5} /> <span className="button-text">Account</span>
        </button>
      </header>
      <div className="desk">
        <div ref={rail} className={`rail-wrap ${railPanel.phase}`} onAnimationEnd={railPanel.settle}
          aria-hidden={railPanel.phase === "closing" || undefined} inert={railPanel.phase === "closing" || undefined}>
          <Rail notes={notes} onPicked={railPanel.close} onClose={railPanel.close} />
        </div>
        {railOpen && narrowRail && <div className="scrim" aria-hidden="true" onClick={railPanel.close} />}
        <main className="note-column">
          {open ? <NoteEditor key={open.id} note={open} notes={notes} /> : <EmptyNote hasNotes={notes.length > 0} />}
        </main>
        <aside ref={pane} className={`pane ${panePanel.phase}`} aria-label="Context" onAnimationEnd={panePanel.settle}
          aria-hidden={panePanel.phase === "closing" || undefined} inert={panePanel.phase === "closing" || undefined}>
          <div className="tabs" role="tablist" aria-label="Context">
            {TABS.map((t) => (
              <button key={t} id={`tab-${t}`} type="button" role="tab" aria-selected={tab === t} aria-controls={`panel-${t}`} tabIndex={tab === t ? 0 : -1}
                onClick={() => setTab(t)} onKeyDown={(e) => moveTab(e, t, setTab)}>{t}</button>
            ))}
            <button type="button" className="icon-button sheet-close" aria-label="Close context" onClick={panePanel.close}>
              <X aria-hidden size={18} strokeWidth={1.5} />
            </button>
          </div>
          <div className="tab-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === "Backlinks" && <Backlinks note={open} notes={notes} />}
            {tab === "History" && <History note={open} />}
            {tab === "Graph" && <Graph note={open} notes={notes} />}
            {tab === "Publish" && <Workbench />}
          </div>
        </aside>
      </div>
      {paneOpen && narrowPane && <div className="scrim" aria-hidden="true" onClick={panePanel.close} />}
      {accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} />}
      <PassphraseDialogs />
    </div>
  );
}

function moveTab(event: KeyboardEvent, current: Tab, setTab: (t: Tab) => void): void {
  const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
  if (!step) return;
  const next = TABS[(TABS.indexOf(current) + step + TABS.length) % TABS.length];
  setTab(next);
  document.getElementById(`tab-${next}`)?.focus();
}

type PanelPhase = "closed" | "open" | "closing";

/** A drawer or sheet: slides in on open, plays its exit animation on close, then hides. */
function usePanel() {
  const [phase, setPhase] = useState<PanelPhase>("closed");
  return {
    phase,
    open: () => setPhase("open"),
    close: () => setPhase((p) => (p === "open" ? (prefersReducedMotion() ? "closed" : "closing") : p)),
    settle: (event: React.AnimationEvent) => {
      if (event.target === event.currentTarget) setPhase((p) => (p === "closing" ? "closed" : p));
    },
  };
}

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function Rail({ notes, onPicked, onClose }: { notes: Note[]; onPicked: () => void; onClose: () => void }) {
  const app = useApp();
  const unlockedVaults = new Set(app.notebooks.map((b) => b.vaultId));
  const locked = app.vaults.filter((v) => !unlockedVaults.has(v.id));
  const choose = (value: string) => {
    if (value.startsWith("locked:")) requestUnlock(value.slice("locked:".length));
    else selectNotebook(value);
  };
  const onTreeKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[role=treeitem]")];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[event.key];
    if (next !== undefined && items[next]) {
      event.preventDefault();
      items[next].focus();
    }
  };
  return (
    <nav className="rail" aria-label="Case files">
      <div className="rail-head">
        <label className="field">
          <span>Notebook</span>
          <select aria-label="Notebook" value={app.activeNotebookId} onChange={(e) => choose(e.target.value)}>
            {app.notebooks.map((b) => <option key={b.id} value={b.id}>{b.vaultId ? `${b.name} · synced` : `${b.name} · this device`}</option>)}
            {locked.map((v) => <option key={v.id} value={`locked:${v.id}`}>{v.name} · locked</option>)}
          </select>
        </label>
        <button type="button" className="icon-button drawer-close" aria-label="Close files" onClick={onClose}>
          <X aria-hidden size={18} strokeWidth={1.5} />
        </button>
      </div>
      <ul className="tree" role="tree" aria-label="Notes" onKeyDown={onTreeKey}>
        {notes.map((note) => (
          <li key={note.id} role="treeitem" aria-label={note.title || "Untitled"} aria-selected={note.id === app.openNoteId}
            tabIndex={note.id === app.openNoteId || (!app.openNoteId && note === notes[0]) ? 0 : -1}
            className={`tree-item${note.isConflictCopy ? " conflict-copy" : ""}`}
            onClick={() => { openNote(note.id); onPicked(); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openNote(note.id); onPicked(); } }}>
            {note.isConflictCopy && <TriangleAlert className="conflict-mark" aria-hidden size={14} strokeWidth={1.5} />}
            {note.private && <Lock className="private-mark" aria-hidden size={13} strokeWidth={1.5} />}
            <span className="tree-title">{note.title || "Untitled"}</span>
            <span className={`badge badge-${note.badge.replace(" ", "-")}`} key={note.badge}>{note.badge}</span>
          </li>
        ))}
      </ul>
      <div className="rail-foot">
        <button type="button" className="button" onClick={() => { rememberedMode = "edit"; focusTitleFor = createNote().id; onPicked(); }}>
          <Plus aria-hidden size={16} strokeWidth={1.5} /> New note
        </button>
        {notes.length === 0 && (
          <div className="empty-notebook">
            <CairnMark size={56} />
            <p>This notebook is empty. Start a note, or load the sample case to see how linked notes and the publish boundary work.</p>
            <button type="button" className="button" onClick={loadSampleCase}>Load sample case</button>
          </div>
        )}
      </div>
    </nav>
  );
}

function EmptyNote({ hasNotes }: { hasNotes: boolean }) {
  return (
    <div className="note-empty">
      <CairnMark size={72} />
      <h1 className="display">{hasNotes ? "Pick a note from the case files" : "A quiet desk"}</h1>
      <p className="muted">Notes live on this device and keep working with the network off.</p>
    </div>
  );
}

function NoteEditor({ note, notes }: { note: Note; notes: Note[] }) {
  const [mode, setMode] = useModeMemory();
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const pending = useRef<{ title?: string; body?: string }>({});
  const timer = useRef(0);
  const titleBox = useRef<HTMLInputElement>(null);

  const flush = () => {
    window.clearTimeout(timer.current);
    timer.current = 0;
    if (Object.keys(pending.current).length) saveNote(note.id, pending.current);
    pending.current = {};
  };
  const schedule = (patch: { title?: string; body?: string }) => {
    pending.current = { ...pending.current, ...patch };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 1000);
  };
  useEffect(() => {
    if (timer.current) return;
    setTitle(note.title);
    setBody(note.body);
  }, [note.title, note.body]);
  useEffect(() => {
    if (focusTitleFor === note.id) {
      focusTitleFor = null;
      titleBox.current?.focus();
    }
    return flush;
  }, []);

  const index = useMemo(() => nameIndex(notes), [notes]);
  const html = mode === "read" ? renderBody(body, (link) => {
    const target = index.get(nameKey(link.target));
    return target
      ? { kind: "link", href: `#note-${target.id}`, text: link.label ?? link.target }
      : { kind: "text", text: link.label ?? link.target, muted: true };
  }) : "";
  const onReadClick = (event: React.MouseEvent) => {
    const anchor = (event.target as Element).closest("a");
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute("href") ?? "";
    if (href.startsWith("#note-")) {
      focusTitleFor = href.slice("#note-".length);
      openNote(focusTitleFor);
    } else {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  };
  const meta = [
    ...(note.aliases.length ? [["aliases", note.aliases.join(", ")]] : []),
    ...Object.entries(note.frontmatter),
  ];

  return (
    <article className="note">
      <input ref={titleBox} className="note-title" aria-label="Note title" placeholder="Untitled" value={title}
        onChange={(e) => { setTitle(e.target.value); schedule({ title: e.target.value }); }} onBlur={flush} />
      <div className="note-toolbar">
        <button type="button" className="button button-quiet" onClick={() => { flush(); setMode(mode === "edit" ? "read" : "edit"); }}>
          {mode === "edit" ? <><BookOpen aria-hidden size={16} strokeWidth={1.5} /> Read</> : <><Pencil aria-hidden size={16} strokeWidth={1.5} /> Edit</>}
        </button>
        <button type="button" className={`button button-quiet pin${note.private ? " pinned" : ""}`} aria-label="Pin as private" aria-pressed={note.private}
          onClick={() => { flush(); saveNote(note.id, { private: !note.private }); }}>
          {note.private ? <><Lock aria-hidden size={16} strokeWidth={1.5} /> Private</> : <><LockOpen aria-hidden size={16} strokeWidth={1.5} /> Pin as private</>}
        </button>
        <span className={`badge badge-${note.badge.replace(" ", "-")}`} role="status" aria-label="Note sync status" key={note.badge}>{note.badge}</span>
      </div>
      {note.badge === "sync error" && note.rejection && (
        <p className="error-line"><TriangleAlert aria-hidden size={16} strokeWidth={1.5} /> This revision was rejected: {note.rejection}</p>
      )}
      {note.conflictCopyId && (
        <section className="conflict" role="region" aria-label="Conflict">
          <TriangleAlert aria-hidden size={18} strokeWidth={1.5} />
          <p>Another device saved this note first. Your version is kept as a conflict copy.</p>
          <a href={`#note-${note.conflictCopyId}`} onClick={(e) => { e.preventDefault(); openNote(note.conflictCopyId); }}>Open conflict copy</a>
          <button type="button" className="button button-quiet" onClick={() => dismissConflict(note.id)}>Dismiss</button>
        </section>
      )}
      {meta.length > 0 && (
        <dl className="note-meta">
          {meta.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
      {mode === "edit"
        ? <textarea className="note-body" aria-label="Note body" value={body} placeholder="Write in Markdown. Link notes with [[Title]]."
          onChange={(e) => { setBody(e.target.value); schedule({ body: e.target.value }); }} onBlur={flush} />
        : <div className="rendered note-rendered" onClick={onReadClick} dangerouslySetInnerHTML={{ __html: html }} />}
    </article>
  );
}

let rememberedMode: "edit" | "read" = "edit";
function useModeMemory(): ["edit" | "read", (m: "edit" | "read") => void] {
  const [mode, setMode] = useState(rememberedMode);
  return [mode, (m) => { rememberedMode = m; setMode(m); }];
}

function linksTo(source: Note, target: Note): boolean {
  const names = new Set([target.title, ...target.aliases].map(nameKey));
  return wikilinks(source.body).some((l) => names.has(nameKey(l.target)));
}

function excerpt(note: Note): string {
  const text = plainText(renderBody(note.body, (link) => ({ kind: "text", text: link.label ?? link.target, muted: false })));
  return text.length > 110 ? `${text.slice(0, 109)}…` : text;
}

function Backlinks({ note, notes }: { note: Note | undefined; notes: Note[] }) {
  if (!note) return <p className="pane-empty">Open a note to see what links to it.</p>;
  const from = notes.filter((n) => n.id !== note.id && linksTo(n, note));
  return from.length === 0
    ? <p className="pane-empty">No notes link here yet.</p>
    : (
      <ul className="backlinks" aria-label="Backlinks">
        {from.map((n) => (
          <li key={n.id}>
            <a href={`#note-${n.id}`} onClick={(e) => { e.preventDefault(); focusTitleFor = n.id; openNote(n.id); }}>{n.title || "Untitled"}</a>
            <span className="muted">{excerpt(n)}</span>
          </li>
        ))}
      </ul>
    );
}

function Graph({ note, notes }: { note: Note | undefined; notes: Note[] }) {
  if (!note) return <p className="pane-empty">Open a note to see its neighbourhood.</p>;
  if (!wikilinks(note.body).length && !notes.some((n) => linksTo(n, note))) return <p className="pane-empty">This note has no links yet.</p>;
  return (
    <div className="graph">
      <p className="muted">Notes this one reaches, by hop. Read-only.</p>
      <Ring notes={notes} rootId={note.id} label="Note graph" />
    </div>
  );
}
