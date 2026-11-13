// Threads: the `region "Threads"` of the panel and the sheet, and the thread card the diff draws under a line too.
//   <ThreadsRegion project page variant>   every thread as an `article`, the refusal strip, `Apply batch` and `Move to issue`
//   <ThreadCard page thread variant>       one thread: notes (suggestions drawn as before and after), resolve, reply
//   focusThreadRow(thread)                 moves focus to the diff row a thread hangs under, when this page draws one
import { useLayoutEffect, useState } from "preact/hooks";
import { Button } from "../../ui/button.tsx";
import { Notice } from "../../ui/feedback.tsx";
import { TextArea } from "../../ui/fields.tsx";
import { Time } from "../../ui/time.tsx";
import { useStore } from "../../store.ts";
import { useMrCaps, type MrPage, type Note, type Suggestion, type ThreadView } from "./data.ts";
import { threadLabel, threadLines } from "./diff-model.ts";
import { fileLines } from "./diff-source.ts";
import { PanelSection } from "./parts.tsx";
import { applySuggestions, batch, moveToIssue, reply, setResolved, toggleBatch, useRefusal, useThreads } from "./thread-actions.ts";
import { parseBody } from "./thread-body.ts";

type ThreadVariant = "panel" | "sheet" | "inline";

export function focusThreadRow(thread: ThreadView): void {
  const position = thread.position;
  if (position === null) return;
  const { start, end } = threadLines(thread);
  const side = position.old_line !== null ? "old" : "new";
  for (const row of document.querySelectorAll<HTMLElement>("[data-row][data-holds='true']")) {
    if (row.dataset.path === position.path && row.dataset.side === side && row.dataset.n === String(end ?? start)) {
      row.focus();
      return;
    }
  }
}

function useSourceLines(project: string, ref: string | null, path: string): string[] | null {
  const [lines, setLines] = useState<string[] | null>(null);
  useLayoutEffect(() => {
    if (ref === null) return;
    let current = true;
    fileLines(project, ref, path).then(
      (found) => {
        if (current) setLines(found);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [project, ref, path]);
  return lines;
}

function rangeText(suggestion: Suggestion): string {
  return suggestion.start_line === suggestion.end_line ? `Line ${suggestion.start_line}` : `Lines ${suggestion.start_line}-${suggestion.end_line}`;
}

function SuggestionBlock({ page, suggestion, variant }: { page: MrPage; suggestion: Suggestion; variant: ThreadVariant }) {
  const caps = useMrCaps(page.mr, page.settings);
  const picked = useStore(batch);
  const source = useSourceLines(page.project, page.mr?.source_head ?? null, suggestion.path);
  const before = source === null ? [] : source.slice(suggestion.start_line - 1, suggestion.end_line);
  const inBatch = picked.has(suggestion.id);
  return (
    <div class="sp-suggestion" data-state={suggestion.state}>
      <p class="sp-suggestion__title">
        <span>Suggested change</span>
        <span class="sp-mono sp-suggestion__range">{rangeText(suggestion)}</span>
        {suggestion.state === "applied" ? <span class="sp-suggestion__state">Applied</span> : null}
        {suggestion.state === "outdated" ? <span class="sp-suggestion__state">No longer applies</span> : null}
      </p>
      <div class="sp-suggestion__code sp-mono">
        {before.map((text, index) => (
          <p key={`b${index}`} class="sp-suggestion__line sp-suggestion__line--before">
            <span aria-hidden="true">-</span>
            <span>{text}</span>
          </p>
        ))}
        {suggestion.lines.map((text, index) => (
          <p key={`a${index}`} class="sp-suggestion__line sp-suggestion__line--after">
            <span aria-hidden="true">+</span>
            <span>{text}</span>
          </p>
        ))}
      </div>
      {suggestion.state === "open" && caps.write ? (
        <div class="sp-suggestion__actions">
          <Button variant="secondary" onClick={() => void applySuggestions(page, [suggestion.id])}>
            Apply suggestion
          </Button>
          {variant === "inline" ? null : (
            <Button variant="ghost" onClick={() => toggleBatch(suggestion.id)}>
              {inBatch ? "Remove from batch" : "Add to batch"}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function NoteView({ page, thread, note, variant }: { page: MrPage; thread: ThreadView; note: Note; variant: ThreadVariant }) {
  const forNote = thread.suggestions.filter((suggestion) => suggestion.note_id === note.id);
  let used = 0;
  return (
    <li class="sp-thread__note">
      <p class="sp-thread__byline">
        <strong>{note.author}</strong>
        <Time iso={note.created_at} class="sp-small sp-muted" />
        {note.pending ? <span class="sp-thread__flag">Pending review</span> : null}
      </p>
      {parseBody(note.body).map((segment, index) => {
        if (segment.kind === "text") {
          return (
            <p key={index} class="sp-thread__text">
              {segment.text}
            </p>
          );
        }
        if (segment.kind === "code") {
          return (
            <pre key={index} class="sp-thread__code">
              {segment.lines.join("\n")}
            </pre>
          );
        }
        const suggestion = forNote[used++];
        return suggestion ? <SuggestionBlock key={index} page={page} suggestion={suggestion} variant={variant} /> : null;
      })}
    </li>
  );
}

function ReplyForm({ page, thread, variant }: { page: MrPage; thread: ThreadView; variant: ThreadVariant }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (busy) return;
    setBusy(true);
    const sent = await reply(page, thread.id, text);
    setBusy(false);
    if (sent) setText("");
  };
  return (
    <form
      class="sp-thread__reply"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <TextArea
        label="Reply"
        name="reply"
        id={`reply-${variant}-${thread.id}`}
        hideLabel
        rows={2}
        placeholder="Reply"
        value={text}
        onInput={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void send();
          }
        }}
      />
      <Button type="submit" variant="secondary" pending={busy}>
        Reply
      </Button>
    </form>
  );
}

export function ThreadCard({ page, thread, variant }: { page: MrPage; thread: ThreadView; variant: ThreadVariant }) {
  const caps = useMrCaps(page.mr, page.settings);
  const position = thread.position;
  const { start, end } = threadLines(thread);
  const where = position === null ? "Merge request" : `${position.path}:${end === null ? start : `${start}-${end}`}`;
  return (
    <article
      aria-label={threadLabel(thread)}
      tabIndex={-1}
      class={`sp-thread sp-thread--${variant}${thread.resolved ? " sp-thread--resolved" : ""}`}
      data-thread={thread.id}
      data-resolved={thread.resolved ? "true" : "false"}
      data-outdated={thread.outdated ? "true" : undefined}
    >
      <p class="sp-thread__head">
        <span class="sp-mono sp-thread__where">{where}</span>
        {thread.outdated ? <span class="sp-thread__flag">Outdated</span> : null}
      </p>
      <ol class="sp-thread__notes">
        {thread.notes.map((note) => (
          <NoteView key={note.id} page={page} thread={thread} note={note} variant={variant} />
        ))}
      </ol>
      {caps.comment ? (
        <div class="sp-thread__foot">
          {thread.resolved ? (
            <Button variant="ghost" onClick={() => void setResolved(page, thread.id, false)}>
              Reopen thread
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={() => {
                focusThreadRow(thread);
                void setResolved(page, thread.id, true);
              }}
            >
              Resolve thread
            </Button>
          )}
          {variant === "inline" ? null : <ReplyForm page={page} thread={thread} variant={variant} />}
        </div>
      ) : null}
    </article>
  );
}

export function ThreadsRegion({ page, variant }: { project: string; page: MrPage; variant: "panel" | "sheet" }) {
  const threads = useThreads(page);
  const caps = useMrCaps(page.mr, page.settings);
  const refused = useRefusal();
  const picked = useStore(batch);
  const open = new Set(threads.flatMap((thread) => thread.suggestions.filter((suggestion) => suggestion.state === "open").map((suggestion) => suggestion.id)));
  const ids = [...picked].filter((id) => open.has(id));
  const movable = threads.some((thread) => !thread.resolved && thread.notes.some((note) => !note.pending));
  return (
    <PanelSection title="Threads" class={`sp-threads sp-threads--${variant}`}>
      {refused === null ? null : <Notice>{refused}</Notice>}
      {threads.length === 0 ? <p class="sp-muted">No threads on this request yet.</p> : null}
      <div class="sp-threads__list">
        {threads.map((thread) => (
          <ThreadCard key={thread.id} page={page} thread={thread} variant={variant} />
        ))}
      </div>
      {ids.length > 0 || (caps.write && movable) ? (
        <div class="sp-threads__actions">
          {ids.length > 0 ? <Button onClick={() => void applySuggestions(page, ids)}>Apply batch</Button> : null}
          {caps.write && movable ? (
            <Button variant="secondary" onClick={() => void moveToIssue(page)}>
              Move to issue
            </Button>
          ) : null}
        </div>
      ) : null}
    </PanelSection>
  );
}
