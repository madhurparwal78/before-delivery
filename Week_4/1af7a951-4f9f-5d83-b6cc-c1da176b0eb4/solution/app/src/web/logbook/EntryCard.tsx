import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { Entry } from "../../shared/api";
import { COPY, notSaved, wallClock } from "../copy";
import { AlertIcon, CheckIcon, TagIcon } from "../ui/icons";
import type { KeptEntry } from "./device";

export interface MarkRange {
  start: number;
  end: number;
}

const NAVIGATION = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "Tab", "Escape", "Shift"]);

/** Splits text at every mark boundary so overlapping signs still render as plain `mark` runs. */
function segments(text: string, marks: readonly MarkRange[]): ReactNode[] {
  const cuts = [...new Set([0, text.length, ...marks.flatMap((m) => [m.start, m.end])])].filter((c) => c >= 0 && c <= text.length).sort((a, b) => a - b);
  const parts: ReactNode[] = [];
  for (let i = 1; i < cuts.length; i++) {
    const from = cuts[i - 1] ?? 0;
    const to = cuts[i] ?? 0;
    const piece = text.slice(from, to);
    const marked = marks.some((m) => m.start <= from && m.end >= to);
    parts.push(marked ? <mark key={from}>{piece}</mark> : piece);
  }
  return parts;
}

/** The read-only, selectable entry text: caret moves and Shift+arrows select, but nothing edits it. */
function EntryText({ entryId, text, marks }: { entryId: string; text: string; marks: readonly MarkRange[] }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const refuse = (event: Event) => event.preventDefault();
    element.addEventListener("beforeinput", refuse);
    return () => element.removeEventListener("beforeinput", refuse);
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      const caret = document.createRange();
      caret.selectNodeContents(event.currentTarget);
      caret.collapse(event.key === "Home");
      const selection = document.getSelection();
      if (event.shiftKey && selection?.anchorNode) {
        selection.extend(caret.startContainer, caret.startOffset);
      } else {
        selection?.removeAllRanges();
        selection?.addRange(caret);
      }
      return;
    }
    const copying = (event.ctrlKey || event.metaKey) && ["a", "c"].includes(event.key.toLowerCase());
    if (!NAVIGATION.has(event.key) && !copying) event.preventDefault();
  };
  return (
    <div
      ref={box}
      className="entry-text"
      role="textbox"
      aria-label="Entry text"
      aria-readonly="true"
      aria-multiline="true"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      tabIndex={0}
      data-entry-text={entryId}
      onKeyDown={onKeyDown}
      onPaste={(event) => event.preventDefault()}
      onCut={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
    >
      {segments(text, marks)}
    </div>
  );
}

interface SavedEntryProps {
  entry: Entry;
  /** The dreamer's current home time zone from the night endpoint, for the logged time. */
  homeTz: string;
  pendingMarks: readonly MarkRange[];
  memoWaiting: boolean;
  sharing: boolean;
  onTag: (entry: Entry, opener: HTMLButtonElement | null) => void;
  onShare: (entry: Entry) => void;
  onMemoError: () => void;
}

export function SavedEntry({ entry, homeTz, pendingMarks, memoWaiting, sharing, onTag, onShare, onMemoError }: SavedEntryProps) {
  const titleId = useId();
  const tagButton = useRef<HTMLButtonElement>(null);
  const marks = [...entry.signs.map((s) => ({ start: s.start, end: s.end })), ...pendingMarks];
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key.toLowerCase() !== "t" || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    onTag(entry, tagButton.current);
  };
  return (
    <article className="entry panel" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <div className="entry-head">
        <h3 id={titleId}>{entry.title || COPY.untitled}</h3>
        <div className="entry-badges">
          <span className="pill saved">
            <CheckIcon />
            {COPY.saved}
          </span>
          {entry.late_recall ? <span className="pill">{COPY.lateRecall}</span> : null}
          {entry.lucid ? <span className="pill">Lucid</span> : null}
        </div>
      </div>
      <p className="entry-logged">{`Logged ${wallClock(entry.created_at, homeTz)}`}</p>
      <EntryText entryId={entry.id} text={entry.text} marks={marks} />
      {entry.memo ? (
        <audio controls preload="none" aria-label="Voice memo" src={`/api/me/entries/${entry.id}/memo`} onError={onMemoError} />
      ) : null}
      {memoWaiting ? <p className="memo-kept">Voice memo waiting to upload</p> : null}
      <div className="entry-actions">
        <button ref={tagButton} type="button" className="button quiet" onClick={() => onTag(entry, tagButton.current)}>
          <TagIcon />
          Tag as dream sign
        </button>
        <button type="button" className="button quiet" aria-pressed={entry.shared} disabled={sharing} onClick={() => onShare(entry)}>
          {entry.shared ? "Shared with coach" : "Share with coach"}
        </button>
      </div>
    </article>
  );
}

interface KeptEntryProps {
  entry: KeptEntry;
  onEdit: (entry: KeptEntry) => void;
  onDiscard: (entry: KeptEntry) => void;
}

export function KeptEntryCard({ entry, onEdit, onDiscard }: KeptEntryProps) {
  const titleId = useId();
  return (
    <article className="entry panel" aria-labelledby={titleId}>
      <div className="entry-head">
        <h3 id={titleId}>{entry.fields.title || COPY.untitled}</h3>
        <span className="pill kept">{COPY.kept}</span>
      </div>
      {entry.rejection === null ? <p className="entry-text">{entry.fields.text}</p> : null}
      {entry.memo ? <p className="memo-kept">Voice memo waiting to upload</p> : null}
      {entry.rejection !== null ? (
        <>
          <p className="field-error">
            <AlertIcon />
            <span>{notSaved(entry.rejection)}</span>
          </p>
          <div className="entry-actions">
            <button type="button" className="button" onClick={() => onEdit(entry)}>
              Edit as new entry
            </button>
            <button type="button" className="button quiet" onClick={() => onDiscard(entry)}>
              Discard
            </button>
          </div>
        </>
      ) : null}
    </article>
  );
}
