import { formatShort } from "../../shared/calendar";
import type { Item } from "../../shared/types";
import type { ProjectSession, SessionState } from "../store";

interface Props {
  session: ProjectSession;
  state: SessionState;
  openProgress: (item: Item, opener: HTMLElement) => void;
}

function shortDates(item: Item): string | null {
  if (!item.start || !item.end) return null;
  return item.kind === "milestone" ? formatShort(item.start) : `${formatShort(item.start)} - ${formatShort(item.end)}`;
}

/** The phone timeline: one card per row, with an Update progress button for each task. */
export function Timeline({ session, state, openProgress }: Props) {
  return (
    <ul aria-label="Timeline" className="timeline">
      {(state.project?.items ?? []).map((item) => (
        <li key={item.id} className="card" data-kind={item.kind} data-grouped={item.group ? "true" : undefined} aria-busy={state.busy.has(item.id) ? "true" : undefined}>
          <p className="card-name">{item.name}</p>
          {shortDates(item) ? <p className="card-dates">{shortDates(item)}</p> : null}
          <p className="card-meta">
            <span>{item.percent}% complete</span>
            {item.critical ? <span className="word">Critical</span> : null}
            {item.late ? <span className="word late">Late</span> : null}
          </p>
          <span className="card-bar" aria-hidden="true">
            <span style={{ width: `${item.percent}%` }} />
          </span>
          {item.kind === "task" ? (
            <button type="button" aria-label={`Update progress for ${item.name}`} aria-disabled={session.readOnly ? "true" : undefined} onClick={(event) => (session.readOnly ? session.announceReadOnly() : openProgress(item, event.currentTarget))}>
              Update progress
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
