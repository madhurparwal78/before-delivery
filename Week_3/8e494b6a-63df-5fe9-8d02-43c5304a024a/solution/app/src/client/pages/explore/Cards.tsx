// The phone's list "Events": article cards with the same labels as the grid rows, loaded as the list scrolls.
import { useLayoutEffect, useRef } from "react";
import { useShown } from "../../lib/format";
import { Skeleton } from "../../lib/ui";
import { marked } from "./Grid";
import { cellText, type ApiEvent } from "./model";

interface Props {
  events: ApiEvent[];
  total: number;
  state: "loading" | "done" | "error";
  selected: number | null;
  loadThrough: (index: number) => Promise<void>;
  onOpen: (index: number) => void;
}

export function Cards({ events, total, state, selected, loadThrough, onOpen }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const shown = useShown();
  const more = (): void => {
    const element = box.current;
    if (element && events.length < total && element.scrollHeight - element.scrollTop - element.clientHeight < 240) void loadThrough(events.length);
  };
  useLayoutEffect(more);
  return (
    <div ref={box} role="list" aria-label="Events" data-search-state={state} className="cards" onScroll={more}>
      {state === "loading" && events.length === 0 ? <Skeleton rows={4} /> : null}
      {events.map((event, index) => {
        const host = cellText(event.fields.host) || "none";
        const level = cellText(event.fields.level) || "none";
        const label = `Event ${index + 1} of ${total}, ${shown(event["@timestamp"])}, ${host}, ${level}`;
        return (
          <div key={event._id} role="listitem">
            <article
              aria-label={label}
              tabIndex={0}
              data-source={event._phase === "archive" ? "archive" : undefined}
              className={`card event-card${selected === index ? " row-selected" : ""}`}
              onClick={() => onOpen(index)}
              onKeyDown={(keyboard) => { if (keyboard.key === "Enter") onOpen(index); }}
            >
              <p className="mono small muted">{shown(event["@timestamp"])}</p>
              <p className="mono small"><strong>{host}</strong> {level}</p>
              <p className="mono">{marked(cellText(event.fields.message), event.highlights.message)}</p>
              {event._phase === "archive" ? <span className="badge badge-info">From archive</span> : null}
            </article>
          </div>
        );
      })}
    </div>
  );
}
