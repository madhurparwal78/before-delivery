import { type KeyboardEvent, useState } from "react";
import { dateWords } from "../../shared/calendar";
import type { Status } from "../../shared/types";
import { EmptyTile, ReturnTile } from "../components/Tile";
import { useReturnList } from "../hooks";
import { Link } from "../router";
import { useApp } from "../store";

const NEXT_STEP: Record<Status, string> = {
  not_started: "Prepare return", prepared: "Check approval", client_approved: "File return", filed: "Check packet",
  packeted: "Open return", amended: "Open return",
};

export function Today() {
  const clock = useApp((s) => s.clock);
  const list = useReturnList("/api/returns");
  const [picked, setPicked] = useState<string | null>(null);
  const week = clock && list ? list.returns.filter((r) => r.due_date >= clock.week_start && r.due_date <= clock.week_end) : [];
  const selected = week.find((r) => r.id === picked) ?? week[0];

  const walk = (event: KeyboardEvent<HTMLUListElement>): void => {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    const names = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    names[names.indexOf(document.activeElement as HTMLButtonElement) + step]?.focus();
    event.preventDefault();
  };

  return (
    <main className="today">
      <div className="hero-head">
        <h1 className="wordmark">Duefield</h1>
        <p className="sentence">Every return, due in its own state's time.</p>
      </div>
      {/* Nothing below the head paints until the list is in, so the hero never pushes the counts down. */}
      {list && clock && (selected ? (
        <div className="hero">
          <ul aria-label="This week" className="week-names" onKeyDown={walk}>
            {week.map((r, index) => (
              <li key={r.id} data-step={Math.min(index, 3)}>
                <button type="button" aria-pressed={r.id === selected.id} onClick={() => setPicked(r.id)}>
                  {`${r.client.name} · ${r.state_name} ${r.period_label}`}
                </button>
              </li>
            ))}
          </ul>
          <div className="specimen">
            <ReturnTile view={selected} className="hero-tile" />
            <p className="caption">
              <strong>{selected.client.name}</strong>
              <span className="due-line">{selected.due_line}</span>
              {selected.carried_from && <span>{`Carried from ${dateWords(selected.carried_from)}`}</span>}
            </p>
            <p className="next-deadline">{`${selected.state} · ${dateWords(selected.due_date)}`}</p>
            <Link href={`/returns/${selected.id}`} className="button primary action">{NEXT_STEP[selected.status]}</Link>
          </div>
        </div>
      ) : <EmptyTile>No returns due this week.</EmptyTile>)}
      {list && clock && (
        <div className="counts">
          <p role="status" aria-label="Overdue count">{`${list.counts.overdue} overdue`}</p>
          <p role="status" aria-label="Awaiting approval count">{`${list.counts.awaiting_approval} awaiting approval`}</p>
        </div>
      )}
    </main>
  );
}
