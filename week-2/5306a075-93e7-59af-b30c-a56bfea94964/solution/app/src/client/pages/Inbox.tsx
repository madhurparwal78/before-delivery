import { Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Hierarchy, Insight, InsightChange, Me, Note, NoteCounts, NoteListItem, NotePage } from "../../shared/api.js";
import type { NoteStatus } from "../../shared/lifecycles.js";
import { api, isFailure } from "../api.js";
import { EmptyInbox } from "../art.js";
import { useFeedback } from "../feedback.js";
import { shortDate, SOURCE_LABELS } from "../format.js";
import { isWide, prefersReducedMotion } from "../motion.js";
import { EvidenceThread, type ThreadPlan } from "../note/EvidenceThread.js";
import type { Linked } from "../note/LinkDialog.js";
import { LogNoteDialog } from "../note/NoteDialogs.js";
import { ReadingColumn } from "../note/ReadingColumn.js";
import { HierarchyRail } from "../rail/HierarchyRail.js";
import { navigate } from "../router.js";

const FILTERS: { status: NoteStatus; label: string }[] = [
  { status: "unprocessed", label: "Unprocessed" },
  { status: "snoozed", label: "Snoozed" },
  { status: "processed", label: "Processed" },
];
type Pane = "Inbox" | "Note" | "Hierarchy";

const useWide = (): boolean => {
  const [wide, setWide] = useState(isWide());
  useEffect(() => {
    const query = matchMedia("(min-width: 900px)");
    const update = (): void => setWide(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
};

/** Merges a fresh first page into the loaded list: known notes update in place, new ones join in order. */
function mergeFirstPage(loaded: NoteListItem[], fresh: NoteListItem[]): NoteListItem[] {
  const freshIds = new Set(fresh.map((n) => n.id));
  const byId = new Map(fresh.map((n) => [n.id, n]));
  const oldestFresh = fresh.at(-1);
  const kept = loaded.filter((n) => !freshIds.has(n.id) && (!oldestFresh || n.createdAt < oldestFresh.createdAt || (n.createdAt === oldestFresh.createdAt && n.id < oldestFresh.id)));
  return [...fresh.map((n) => byId.get(n.id) ?? n), ...kept];
}

const announce = (verb: "Linked to" | "Unlinked from", change: InsightChange): string =>
  `${verb} ${change.feature.name}; impact ${change.before.impact} → ${change.feature.impact}; now rank ${change.feature.rank ?? "–"} of ${change.feature.rankTotal}`;

export function InboxPage({ me, noteId }: { me: Me; noteId: string | null }) {
  const feedback = useFeedback();
  const wide = useWide();
  const [filter, setFilter] = useState<NoteStatus>("unprocessed");
  const [notes, setNotes] = useState<NoteListItem[] | null>(null);
  const [counts, setCounts] = useState<NoteCounts | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [hierarchy, setHierarchy] = useState<Hierarchy | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [pane, setPane] = useState<Pane>(noteId ? "Note" : "Inbox");
  const [logging, setLogging] = useState(false);
  const [thread, setThread] = useState<ThreadPlan | null>(null);
  const [hiddenTicks, setHiddenTicks] = useState<ReadonlySet<string>>(new Set());
  const [linked, setLinked] = useState<ReadonlySet<string>>(new Set());
  const [active, setActive] = useState(0);
  const moreButton = useRef<HTMLButtonElement>(null);
  const listbox = useRef<HTMLUListElement>(null);
  const loadedFilter = useRef(filter);

  const loadFirstPage = useCallback(async (status: NoteStatus, merge: boolean): Promise<void> => {
    try {
      const page = await api.get<NotePage>(`/api/notes?status=${status}`);
      if (loadedFilter.current !== status) return;
      setCounts(page.counts);
      setNotes((current) => (merge && current ? mergeFirstPage(current, page.notes) : page.notes));
      if (!merge) setCursor(page.nextCursor);
    } catch (error) {
      feedback.fail(error);
    }
  }, [feedback]);

  const loadHierarchy = useCallback(async (): Promise<Hierarchy | null> => {
    try {
      return await api.get<Hierarchy>("/api/hierarchy");
    } catch (error) {
      feedback.fail(error);
      return null;
    }
  }, [feedback]);

  useEffect(() => {
    loadedFilter.current = filter;
    setNotes(null);
    setActive(0);
    void loadFirstPage(filter, false);
    const timer = setInterval(() => void loadFirstPage(filter, true), 30_000);
    return () => clearInterval(timer);
  }, [filter, loadFirstPage]);

  useEffect(() => {
    void loadHierarchy().then((h) => h && setHierarchy(h));
  }, [loadHierarchy]);

  useEffect(() => {
    setLinked(new Set());
    if (!noteId) {
      setNote(null);
      return;
    }
    let current = true;
    api.get<{ note: Note }>(`/api/notes/${noteId}`).then((r) => { if (current) setNote(r.note); }, (error: unknown) => {
      if (current) {
        setNote(null);
        feedback.fail(error, (f) => (f.status === 404 ? "This note no longer exists." : null));
      }
    });
    return () => { current = false; };
  }, [noteId, feedback]);

  const loadMore = async (): Promise<void> => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await api.get<NotePage>(`/api/notes?status=${filter}&cursor=${encodeURIComponent(cursor)}`);
      setNotes((current) => {
        const known = new Set((current ?? []).map((n) => n.id));
        return [...(current ?? []), ...page.notes.filter((n) => !known.has(n.id))];
      });
      setCounts(page.counts);
      setCursor(page.nextCursor);
      if (page.nextCursor === null) {
        requestAnimationFrame(() => listbox.current?.focus());
      }
    } catch (error) {
      if (isFailure(error, 422)) {
        feedback.warn("The inbox changed filter. Showing the first page again.");
        void loadFirstPage(filter, false);
      } else feedback.fail(error);
    } finally {
      setLoadingMore(false);
    }
  };

  const open = (id: string): void => {
    navigate(`/inbox/${id}`);
    setPane("Note");
  };

  const refreshAfterChange = useCallback(async (): Promise<void> => {
    const fresh = await loadHierarchy();
    if (fresh) setHierarchy(fresh);
    void loadFirstPage(loadedFilter.current, false);
  }, [loadHierarchy, loadFirstPage]);

  const onNoteChanged = useCallback((updated: Note) => {
    setNote(updated);
    void refreshAfterChange();
  }, [refreshAfterChange]);

  const onLinked = async (result: Linked): Promise<void> => {
    feedback.say("evidence", announce("Linked to", result));
    setNote((n) => (n && n.id === result.insight.noteId ? { ...n, insights: [...n.insights, result.insight].sort((a, b) => a.start - b.start || a.end - b.end || (a.id < b.id ? -1 : 1)) } : n));
    const fresh = loadHierarchy();
    const railShown = wide && !railCollapsed;
    if (prefersReducedMotion() || !railShown) {
      const h = await fresh;
      if (h) setHierarchy(h);
      if (prefersReducedMotion()) setLinked((l) => new Set(l).add(result.feature.id));
      void loadFirstPage(loadedFilter.current, true);
      return;
    }
    setHiddenTicks((t) => new Set(t).add(result.insight.id));
    setThread({
      insightId: result.insight.id,
      featureId: result.feature.id,
      featureName: result.feature.name,
      reached: () => { void fresh.then((h) => h && setHierarchy(h)); },
      done: () => {
        setThread(null);
        setHiddenTicks((t) => {
          const next = new Set(t);
          next.delete(result.insight.id);
          return next;
        });
      },
    });
    void loadFirstPage(loadedFilter.current, true);
  };

  const onUnlinked = async (insight: Insight, change: InsightChange): Promise<void> => {
    feedback.say("evidence", announce("Unlinked from", change));
    const tick = document.querySelector<HTMLElement>(`[data-tick="${CSS.escape(insight.id)}"]`);
    if (tick && !prefersReducedMotion()) await tick.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 167, fill: "forwards" }).finished.catch(() => undefined);
    setNote((n) => (n ? { ...n, insights: n.insights.filter((i) => i.id !== insight.id) } : n));
    const fresh = await loadHierarchy();
    if (fresh) setHierarchy(fresh);
  };

  const onDeleted = (): void => {
    navigate("/inbox");
    setPane("Inbox");
    void refreshAfterChange();
  };

  const onListKey = (event: KeyboardEvent<HTMLUListElement>): void => {
    if (!notes || notes.length === 0) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((i) => Math.min(notes.length - 1, i + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (event.key === "Home") { event.preventDefault(); setActive(0); }
    else if (event.key === "End") { event.preventDefault(); setActive(notes.length - 1); }
    else if (event.key === "Enter") {
      const chosen = notes[active];
      if (chosen) { event.preventDefault(); open(chosen.id); }
    }
  };

  useEffect(() => {
    listbox.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const show = (name: Pane): boolean => wide || pane === name;
  const activeId = notes?.[active] ? `note-option-${notes[active].id}` : undefined;

  return (
    <div className={`inbox ${railCollapsed ? "inbox-rail-collapsed" : ""}`}>
      {!wide && (
        <div role="tablist" aria-label="Panes" className="tabs panes-tabs">
          {(["Inbox", "Note", "Hierarchy"] as const).map((name) => (
            <button key={name} type="button" role="tab" aria-selected={pane === name} tabIndex={pane === name ? 0 : -1} className="tab" onClick={() => setPane(name)}>{name}</button>
          ))}
        </div>
      )}
      <section className="inbox-list" hidden={!show("Inbox")} aria-label="Notes list">
        <div className="inbox-list-head">
          <div role="tablist" aria-label="Inbox filter" className="tabs filter-tabs"
            onKeyDown={(event) => {
              const i = FILTERS.findIndex((f) => f.status === filter);
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                const next = FILTERS[(i + (event.key === "ArrowRight" ? 1 : FILTERS.length - 1)) % FILTERS.length];
                if (next) setFilter(next.status);
              }
            }}>
            {FILTERS.map((f) => (
              <button key={f.status} type="button" role="tab" aria-selected={filter === f.status} tabIndex={filter === f.status ? 0 : -1}
                className="tab" onClick={() => setFilter(f.status)}>
                {f.label} <span className="num tab-count">{counts ? counts[f.status] : ""}</span>
              </button>
            ))}
          </div>
          <button type="button" className="button" onClick={() => setLogging(true)}><Plus aria-hidden="true" size={16} />Log note</button>
        </div>
        {notes === null ? (
          <ul className="skeleton" aria-hidden="true">{[0, 1, 2, 3].map((i) => <li key={i}><span /><span /></li>)}</ul>
        ) : notes.length === 0 ? (
          <div className="empty-state"><EmptyInbox /><p>No {filter} notes.</p></div>
        ) : null}
        {notes !== null && notes.length > 0 && (
          <ul ref={listbox} role="listbox" aria-label="Notes" tabIndex={0} className="note-list" aria-activedescendant={activeId} onKeyDown={onListKey}>
            {notes.map((n, i) => (
              <li key={n.id} id={`note-option-${n.id}`} data-index={i} role="option" aria-selected={n.id === noteId} aria-describedby={`note-meta-${n.id}`}
                className={`note-option ${i === active ? "note-option-active" : ""}`} onClick={() => { setActive(i); open(n.id); }}>
                <span className="note-option-title">{n.title}</span>
                <span id={`note-meta-${n.id}`} aria-hidden="true" className="note-option-details">
                  <span className="note-option-meta">{n.contactName ?? "No contact"} · {SOURCE_LABELS[n.source]}</span>
                  <span className="note-option-meta num">{shortDate(n.createdAt, me.workspace.timeZone)}{n.insightCount > 0 ? ` · ${n.insightCount} linked` : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {cursor && notes !== null && (
          <button ref={moreButton} type="button" className="button-quiet load-more" aria-busy={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? "Loading notes…" : "Load more notes"}
          </button>
        )}
      </section>
      <section className="inbox-reading" hidden={!show("Note")} aria-label="Reading column">
        {note ? (
          <ReadingColumn me={me} note={note} hiddenTicks={hiddenTicks} onChanged={onNoteChanged} onDeleted={onDeleted}
            onLinked={(r) => void onLinked(r)} onUnlinked={(i, c) => void onUnlinked(i, c)} />
        ) : (
          <div className="empty-state reading-empty"><EmptyInbox /><p>Choose a note from the inbox to read it here.</p></div>
        )}
      </section>
      <div className="inbox-rail" hidden={!show("Hierarchy")}>
        <HierarchyRail hierarchy={hierarchy} collapsed={railCollapsed && wide} onToggle={() => setRailCollapsed((c) => !c)} linked={linked} />
      </div>
      {thread && <EvidenceThread plan={thread} />}
      {logging && (
        <LogNoteDialog onClosed={() => setLogging(false)} onSaved={(saved) => { void refreshAfterChange(); navigate(`/inbox/${saved.id}`); setPane("Note"); }} />
      )}
    </div>
  );
}
