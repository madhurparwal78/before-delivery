import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { addDays, formatLong, formatShort, mondayOf, type IsoDate } from "../../shared/calendar";
import { formatHours } from "../../shared/format";
import type { Workload, WorkloadDay, WorkloadPerson } from "../../shared/types";
import { call } from "../api";
import { Dialog } from "../components/dialog";
import { setParams } from "../router";
import type { ProjectSession, SessionState } from "../store";

interface Props {
  session: ProjectSession;
  state: SessionState;
  from: string | null;
}

interface Selected {
  person: WorkloadPerson;
  day: WorkloadDay;
}

const LAST_COLUMN = 11;

export function WorkloadGrid({ session, state, from }: Props) {
  const monday: IsoDate = from ?? mondayOf(session.config.today);
  const [workload, setWorkload] = useState<Workload | null>(null);
  const [active, setActive] = useState({ row: 0, column: 1 });
  const [selected, setSelected] = useState<Selected | null>(null);
  const cells = useRef(new Map<string, HTMLElement>());
  const wantsFocus = useRef(false);
  const hasFocus = useRef(false);

  useEffect(() => {
    if (!state.workspaceId) return;
    let current = true;
    call<Workload>("GET", `/api/workspaces/${state.workspaceId}/workload?from=${monday}`)
      .then((result) => {
        if (current) setWorkload(result.body);
      })
      .catch(() => {
        // the next workload tick or workspace change asks again; the grid keeps its last answer
      });
    return () => {
      current = false;
    };
  }, [state.workspaceId, monday, state.workloadTick]);

  useLayoutEffect(() => {
    const element = cells.current.get(`${active.row}:${active.column}`);
    const lost = hasFocus.current && document.activeElement === document.body && selected === null;
    if (element && (wantsFocus.current || lost)) element.focus();
    wantsFocus.current = false;
  });

  const people = workload?.people ?? [];
  const move = (row: number, column: number) => {
    wantsFocus.current = true;
    setActive({ row: Math.max(0, Math.min(people.length - 1, row)), column: Math.max(0, Math.min(LAST_COLUMN, column)) });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, person: WorkloadPerson, row: number, column: number) => {
    const day = column >= 1 && column <= 10 ? person.days[column - 1] : undefined;
    switch (event.key) {
      case "ArrowRight":
        move(row, column + 1);
        break;
      case "ArrowLeft":
        move(row, column - 1);
        break;
      case "ArrowDown":
        move(row + 1, column);
        break;
      case "ArrowUp":
        move(row - 1, column);
        break;
      case "Home":
        move(row, 0);
        break;
      case "End":
        move(row, LAST_COLUMN);
        break;
      case "Enter":
        if (day) setSelected({ person, day });
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const focusProps = (row: number, column: number) => ({
    ref: (element: HTMLElement | null) => {
      if (element) cells.current.set(`${row}:${column}`, element);
      else cells.current.delete(`${row}:${column}`);
    },
    tabIndex: active.row === row && active.column === column ? 0 : -1,
    onFocus: () => {
      hasFocus.current = true;
      setActive({ row, column });
    },
  });

  return (
    <div className="workload-view">
      <div className="workload-nav">
        <button type="button" onClick={() => setParams({ from: addDays(monday, -14) })}>
          Previous two weeks
        </button>
        <button type="button" onClick={() => setParams({ from: addDays(monday, 14) })}>
          Next two weeks
        </button>
      </div>
      {workload ? (
      <div className="grid-region">
        <table role="grid" aria-label="Workload" className="workload">
          <thead>
            <tr role="row">
              <th role="columnheader" scope="col">
                Person
              </th>
              {(workload?.days ?? []).map((day) => (
                <th key={day} role="columnheader" scope="col">
                  {formatShort(day)}
                </th>
              ))}
              <th role="columnheader" scope="col">
                Over-allocated days
              </th>
            </tr>
          </thead>
          <tbody>
            {people.map((person, row) => (
              <tr key={person.userId} role="row">
                <th role="rowheader" scope="row" onKeyDown={(event) => onKeyDown(event, person, row, 0)} {...focusProps(row, 0)}>
                  {person.name}
                </th>
                {person.days.map((day, index) => (
                  <td
                    key={day.date}
                    role="gridcell"
                    data-date={day.date}
                    data-hours={day.hours}
                    data-over={String(day.over)}
                    aria-label={`${person.name}, ${formatLong(day.date)}: ${formatHours(day.hours)} of ${formatHours(person.capacity)} hours${day.over ? ", over-allocated" : ""}`}
                    onKeyDown={(event) => onKeyDown(event, person, row, index + 1)}
                    {...focusProps(row, index + 1)}
                  >
                    {day.hours === 0 ? "" : formatHours(day.hours)}
                  </td>
                ))}
                <td role="gridcell" onKeyDown={(event) => onKeyDown(event, person, row, LAST_COLUMN)} {...focusProps(row, LAST_COLUMN)}>
                  {person.overDays}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      ) : (
        <p className="quiet">Loading the workload.</p>
      )}
      {selected ? (
        <Dialog
          label={`${selected.person.name}, ${formatLong(selected.day.date)}`}
          className="narrow"
          onClose={() => {
            wantsFocus.current = true;
            setSelected(null);
          }}
          returnTo={() => cells.current.get(`${active.row}:${active.column}`) ?? null}
        >
          <h2>
            {selected.person.name}, {formatLong(selected.day.date)}
          </h2>
          <ul aria-label="Assignments">
            {selected.day.assignments.map((assignment) => (
              <li key={`${assignment.project}:${assignment.item}`}>
                {assignment.project}: {assignment.item}, {formatHours(assignment.hours)} hours
              </li>
            ))}
          </ul>
          {selected.day.assignments.length === 0 ? <p>No assignments on this day.</p> : null}
          <div className="dialog-actions">
            <button
              type="button"
              data-autofocus=""
              onClick={() => {
                wantsFocus.current = true;
                setSelected(null);
              }}
            >
              Close
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
