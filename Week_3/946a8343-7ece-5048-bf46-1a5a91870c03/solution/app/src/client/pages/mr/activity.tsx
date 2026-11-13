// Overview activity: `combobox "Activity filter"` (All activity, Comments only, History only -> GET .../notes?filter=), the notes
// with the system notes among them, and `textbox "Comment"` + `button "Comment"` for a request-level thread (POST .../threads with
// position null).
import { useRef, useState } from "preact/hooks";
import { api, useAction } from "../../api.ts";
import { useLiveResource } from "../../live.ts";
import { Button, Chip, Notice, Select, Skeleton, TextArea, Time } from "../../ui/index.ts";
import { concernsRequest, type MrCaps, type MrPage, type Note, mrBase } from "./data.ts";

type Filter = "all" | "comments" | "history";

const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: "all", label: "All activity" },
  { value: "comments", label: "Comments only" },
  { value: "history", label: "History only" },
];

const ACTIVITY_TYPES = ["merge_request", "thread", "review", "approvals", "checks", "version", "train"] as const;

function isFilter(value: string): value is Filter {
  return FILTERS.some((filter) => filter.value === value);
}

function NoteRow({ note }: { note: Note }) {
  return (
    <li class={`sp-mr-note${note.system ? " sp-mr-note--system" : ""}`}>
      <p class="sp-mr-note__head">
        <span class="sp-mr-note__author">{note.author}</span>
        <Time iso={note.created_at} class="sp-muted sp-small" />
        {note.pending ? <Chip tone="wait">Pending</Chip> : null}
      </p>
      <p class="sp-mr-note__body">{note.body}</p>
    </li>
  );
}

export function Activity({ page, caps }: { page: MrPage; caps: MrCaps }) {
  const { project, iid } = page;
  const [filter, setFilter] = useState<Filter>("all");
  const [body, setBody] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const notes = useLiveResource<Note[]>({
    project,
    types: ACTIVITY_TYPES,
    deps: [project, iid, filter],
    match: (message) => concernsRequest(iid, message.data),
    load: async (signal) => (await api.get<{ notes: Note[] }>(`${mrBase(project, iid)}/notes?filter=${filter}`, { signal })).notes,
  });
  const comment = useAction(async () => {
    await api.post(`${mrBase(project, iid)}/threads`, { body, position: null, pending: false });
    setBody("");
    field.current?.focus();
    await Promise.all([notes.reload(), page.reload()]);
  });
  const bodyError = comment.error?.fieldErrors().body ?? null;
  return (
    <section class="sp-mr-activity" aria-labelledby="mr-activity-title">
      <h2 id="mr-activity-title" class="sp-mr__h2">
        Activity
      </h2>
      <Select label="Activity filter" name="activity-filter" value={filter} options={FILTERS} onChange={(event) => isFilter(event.currentTarget.value) && setFilter(event.currentTarget.value)} />
      {notes.error && notes.data === undefined ? <Notice>{notes.error.message}</Notice> : null}
      {notes.data === undefined ? (
        notes.error ? null : <Skeleton rows={3} height={40} />
      ) : notes.data.length === 0 ? (
        <p class="sp-muted">Nothing here yet.</p>
      ) : (
        <ul aria-label="Activity" class="sp-mr-notes">
          {notes.data.map((note) => (
            <NoteRow key={note.id} note={note} />
          ))}
        </ul>
      )}
      {caps.comment ? (
        <form
          class="sp-mr-activity__form"
          onSubmit={(event) => {
            event.preventDefault();
            void comment.run();
          }}
        >
          {comment.error && bodyError === null ? <Notice>{comment.error.message}</Notice> : null}
          <TextArea label="Comment" name="mr-comment" innerRef={field} value={body} error={bodyError} onInput={(event) => setBody(event.currentTarget.value)} />
          <Button type="submit" pending={comment.pending}>
            Comment
          </Button>
        </form>
      ) : null}
    </section>
  );
}
