// Small pieces the planning pages share: the open/closed word, label chips and the note list.
import { ScopedLabel, StatusBadge } from "../../ui/chip.tsx";
import { Time } from "../../ui/time.tsx";
import type { IssueState, NoteItem } from "./types.ts";

export function StateWord({ state }: { state: IssueState }) {
  return state === "closed" ? <StatusBadge status="closed" label="Closed" /> : <StatusBadge status="active" label="Open" />;
}

export function LabelChips({ labels }: { labels: readonly string[] }) {
  if (labels.length === 0) return null;
  return (
    <span class="sp-plan-chips">
      {labels.map((name) => (
        <ScopedLabel key={name} name={name} />
      ))}
    </span>
  );
}

/** Comments and system notes in the order given: author, time and text. */
export function NoteList({ notes, label }: { notes: readonly NoteItem[]; label: string }) {
  return (
    <ol aria-label={label} class="sp-plan-notes">
      {notes.map((note) => (
        <li key={note.id} class={`sp-plan-note${note.system ? " sp-plan-note--system" : ""}`}>
          <p class="sp-plan-note__body">{note.body}</p>
          <p class="sp-plan-note__meta">
            <span class="sp-plan-note__author">{note.author}</span>
            {note.createdAt === "" ? null : <Time iso={note.createdAt} />}
          </p>
        </li>
      ))}
    </ol>
  );
}
