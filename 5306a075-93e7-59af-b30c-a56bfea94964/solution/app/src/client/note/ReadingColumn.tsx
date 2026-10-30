import { AlarmClock, CheckCheck, FileText, Link2, Paperclip, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Insight, InsightChange, Me, Note } from "../../shared/api.js";
import { noteTransition } from "../../shared/lifecycles.js";
import { api } from "../api.js";
import { useFeedback } from "../feedback.js";
import { calendarDate, IMPORTANCE_LABELS, shortDate, SOURCE_LABELS } from "../format.js";
import { DragThread } from "./EvidenceThread.js";
import { LinkDialog, type Linked } from "./LinkDialog.js";
import { NoteBody, type Pending } from "./NoteBody.js";
import { DeleteNoteDialog, EditNoteDialog, SnoozeDialog } from "./NoteDialogs.js";
import { restoreSelection, selectionSpan } from "./selection.js";

type DialogName = "link" | "snooze" | "edit" | "delete" | null;
interface Point { x: number; y: number }

interface Props {
  me: Me;
  note: Note;
  hiddenTicks: ReadonlySet<string>;
  onChanged: (note: Note) => void;
  onDeleted: () => void;
  onLinked: (linked: Linked) => void;
  onUnlinked: (insight: Insight, change: InsightChange) => void;
}

const editable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export function ReadingColumn({ me, note, hiddenTicks, onChanged, onDeleted, onLinked, onUnlinked }: Props) {
  const feedback = useFeedback();
  const body = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const keyboardSelection = useRef(false);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [toolbar, setToolbar] = useState<{ top: number; left: number } | null>(null);
  const [popover, setPopover] = useState<{ ids: string[]; top: number; left: number } | null>(null);
  const [drag, setDrag] = useState<{ from: Point; to: Point; retracting: boolean } | null>(null);
  const dragging = useRef(false);
  const canEdit = me.user.role !== "customer_success";

  useEffect(() => {
    setPending(null);
    setPopover(null);
  }, [note.id]);

  // Keyboard selections keep extending: put the browser selection back over the re-rendered marks.
  useLayoutEffect(() => {
    const root = body.current;
    const columnEl = column.current;
    if (pending && root && keyboardSelection.current) restoreSelection(root, pending);
    const marks = root?.querySelectorAll<HTMLElement>("mark[data-pending]");
    const firstLine = marks?.[0]?.getClientRects()[0];
    const lastMark = marks?.[marks.length - 1];
    const lastRects = lastMark?.getClientRects();
    const lastLine = lastRects?.[lastRects.length - 1];
    const head = columnEl?.querySelector<HTMLElement>(".reading-head");
    if (!pending || !firstLine || !lastLine || !columnEl) {
      setToolbar(null);
      return;
    }
    // Above the selection's first line, unless that would cover the note's own controls; then below its last line.
    const box = columnEl.getBoundingClientRect();
    const above = firstLine.top - box.top - 52;
    const clear = head ? head.offsetTop + head.offsetHeight + 4 : 0;
    const line = above >= clear ? firstLine : lastLine;
    const top = above >= clear ? above : lastLine.bottom - box.top + 8;
    setToolbar({ top, left: Math.max(0, Math.min(line.left - box.left, box.width - 220)) });
  }, [pending, note]);

  const readSelection = (fromKeyboard: boolean): void => {
    const root = body.current;
    if (!root || dragging.current) return;
    const span = selectionSpan(root, note.text);
    if (!span) return;
    keyboardSelection.current = fromKeyboard;
    if (!fromKeyboard) getSelection()?.removeAllRanges();
    setPending(span);
  };

  const clearPending = useCallback(() => {
    setPending(null);
    keyboardSelection.current = false;
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (dialog !== null) return;
      if (event.key === "Escape") {
        clearPending();
        setPopover(null);
      } else if ((event.key === "l" || event.key === "L") && pending && canEdit && !editable(event.target) && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setDialog("link");
      }
    };
    const onDown = (event: PointerEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".selection-toolbar, mark[data-pending], .mark-popover, dialog")) return;
      clearPending();
      if (!target?.closest("mark")) setPopover(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [dialog, pending, canEdit, clearPending]);

  // Attachments still pending upload: look again every 5 seconds.
  useEffect(() => {
    if (!note.attachments.some((a) => a.status === "pending")) return;
    const timer = setInterval(() => {
      api.get<{ note: Note }>(`/api/notes/${note.id}`).then((r) => onChanged(r.note), () => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [note, onChanged]);

  const commitByDrag = async (featureId: string, span: Pending): Promise<void> => {
    try {
      const linked = await api.post<Linked>("/api/insights", { noteId: note.id, featureId, start: span.start, end: span.end, importance: "important" });
      clearPending();
      onLinked(linked);
    } catch (error) {
      feedback.fail(error);
    }
  };

  const onPendingPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (!canEdit || !pending || event.button !== 0) return;
    event.preventDefault();
    const span = pending;
    const marks = body.current?.querySelectorAll<HTMLElement>("mark[data-pending]");
    const last = marks?.[marks.length - 1]?.getBoundingClientRect();
    const from = last ? { x: last.right, y: last.top + last.height / 2 } : { x: event.clientX, y: event.clientY };
    const start = { x: event.clientX, y: event.clientY };
    dragging.current = true;
    let moved = false;
    const move = (e: PointerEvent): void => {
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) return;
      moved = true;
      setDrag({ from, to: { x: e.clientX, y: e.clientY }, retracting: false });
    };
    const up = (e: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setTimeout(() => { dragging.current = false; }, 0);
      if (!moved) return;
      const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-feature-row]");
      if (row?.dataset.featureRow) {
        setDrag(null);
        void commitByDrag(row.dataset.featureRow, span);
      } else {
        setDrag((d) => (d ? { ...d, retracting: true } : null));
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onMarkClick = (ids: string[], mark: HTMLElement): void => {
    const columnEl = column.current;
    if (!columnEl) return;
    const rect = mark.getBoundingClientRect();
    const box = columnEl.getBoundingClientRect();
    setPopover({ ids, top: rect.bottom - box.top + columnEl.scrollTop + 6, left: Math.max(0, Math.min(rect.left - box.left, box.width - 280)) });
  };

  const changeStatus = async (to: "processed" | "unprocessed"): Promise<void> => {
    feedback.clearAlert();
    try {
      const updated = (await api.post<{ note: Note }>(`/api/notes/${note.id}/status`, { to })).note;
      feedback.say("save", to === "processed" ? "Marked processed." : "Moved back to Unprocessed.");
      onChanged(updated);
    } catch (error) {
      feedback.fail(error);
    }
  };

  const unlink = async (insight: Insight): Promise<void> => {
    feedback.clearAlert();
    try {
      const change = await api.delete<InsightChange>(`/api/insights/${insight.id}`);
      setPopover(null);
      onUnlinked(insight, change);
    } catch (error) {
      feedback.fail(error);
    }
  };

  const received = note.receivedOn ? calendarDate(note.receivedOn) : shortDate(note.createdAt, me.workspace.timeZone);
  const quote = pending ? note.text.slice(pending.start, pending.end) : "";
  const popoverInsights = popover ? note.insights.filter((i) => popover.ids.includes(i.id)) : [];

  return (
    <article ref={column} aria-label="Note" className="reading">
      <header className="reading-head">
        <h2>{note.title}</h2>
        <dl className="note-meta">
          <div><dt>Source</dt><dd><FileText aria-hidden="true" size={14} />{SOURCE_LABELS[note.source]}</dd></div>
          <div><dt>Contact</dt><dd>{note.contact ? `${note.contact.name} · ${note.contact.email}` : "No contact"}</dd></div>
          <div><dt>Company</dt><dd>{note.company?.name ?? "No company"}</dd></div>
          <div><dt>Received</dt><dd>{received}</dd></div>
        </dl>
        {canEdit && (
          <div className="note-actions">
            {noteTransition(note.status, "processed") !== null && (
              <button type="button" className="button" onClick={() => void changeStatus("processed")}><CheckCheck aria-hidden="true" size={16} />Mark processed</button>
            )}
            {noteTransition(note.status, "unprocessed") !== null && (
              <button type="button" className="button" onClick={() => void changeStatus("unprocessed")}><RotateCcw aria-hidden="true" size={16} />Reopen</button>
            )}
            {noteTransition(note.status, "snooze") !== null && (
              <button type="button" className="button-quiet" onClick={() => setDialog("snooze")}><AlarmClock aria-hidden="true" size={16} />Snooze</button>
            )}
            <button type="button" className="button-quiet" onClick={() => setDialog("edit")}><Pencil aria-hidden="true" size={16} />Edit note</button>
            <button type="button" className="button-quiet button-quiet-danger" onClick={() => setDialog("delete")}><Trash2 aria-hidden="true" size={16} />Delete note</button>
          </div>
        )}
      </header>

      <NoteBody
        ref={body}
        body={note.body}
        insights={note.insights}
        pending={pending}
        hiddenTicks={hiddenTicks}
        onPendingPointerDown={onPendingPointerDown}
        onMarkClick={onMarkClick}
        onSelectionEnd={readSelection}
      />

      {toolbar && canEdit && (
        <div className="selection-toolbar" style={{ top: toolbar.top, left: toolbar.left }}>
          <button type="button" className="button" onClick={() => setDialog("link")}>
            <Link2 aria-hidden="true" size={16} />Link to feature<span aria-hidden="true"> · <kbd>L</kbd></span>
          </button>
        </div>
      )}

      {popover && popoverInsights.length > 0 && (
        <div className="mark-popover" style={{ top: popover.top, left: popover.left }}>
          <ul aria-label="Insights on this text">
            {popoverInsights.map((insight) => (
              <li key={insight.id}>
                <span><strong>{insight.featureName}</strong> · {IMPORTANCE_LABELS[insight.importance]}</span>
                {canEdit && <button type="button" className="button-quiet" onClick={() => void unlink(insight)}>Unlink {insight.featureName}</button>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="note-section">
        <h3>Linked evidence</h3>
        {note.insights.length === 0 ? <p className="empty-line">No linked evidence yet. Select a sentence to link it to a feature.</p> : (
          <ul aria-label="Linked evidence" className="evidence-list">
            {note.insights.map((insight) => (
              <li key={insight.id}>
                <blockquote>{insight.quote}</blockquote>
                <p className="evidence-meta"><span>{insight.featureName}</span><span className="badge">{IMPORTANCE_LABELS[insight.importance]}</span></p>
                {canEdit && <button type="button" className="button-quiet" onClick={() => void unlink(insight)}>Unlink {insight.featureName}</button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {note.attachments.length > 0 && (
        <section className="note-section">
          <h3>Attachments</h3>
          <ul aria-label="Attachments" className="attachment-list">
            {note.attachments.map((a) => (
              <li key={a.id}>
                <Paperclip aria-hidden="true" size={14} />
                {a.status === "available" ? <a href={`/api/attachments/${a.id}`} download={a.filename}>{a.filename}</a> : <span>{a.filename} — Pending upload</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {drag && <DragThread from={drag.from} to={drag.to} retracting={drag.retracting} onRetracted={() => setDrag(null)} />}

      {dialog === "link" && pending && (
        <LinkDialog noteId={note.id} quote={quote} span={pending}
          onLinked={(linked) => { clearPending(); onLinked(linked); }}
          onClosed={() => { setDialog(null); clearPending(); }}
          returnFocus={() => body.current} />
      )}
      {dialog === "snooze" && <SnoozeDialog note={note} timeZone={me.workspace.timeZone} onClosed={() => setDialog(null)} onSaved={onChanged} />}
      {dialog === "edit" && <EditNoteDialog note={note} onClosed={() => setDialog(null)} onSaved={onChanged} />}
      {dialog === "delete" && <DeleteNoteDialog note={note} onClosed={() => setDialog(null)} onDeleted={onDeleted} />}
    </article>
  );
}
