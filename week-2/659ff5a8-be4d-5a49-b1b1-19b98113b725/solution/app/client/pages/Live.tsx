import { ChevronDown } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  RunView,
  StandingRow,
  Standings,
  View,
} from "../../shared/api.js";
import { api } from "../api.js";
import { useEvent } from "../components/EventFrame.js";
import { Skeleton, StatusRegion } from "../components/ui.js";
import { coneLabel } from "../format.js";
import { prefersReducedMotion, useMediaQuery, useRefresh } from "../hooks.js";
import {
  SLIDE_HOLD_MS,
  SLIDE_MS,
  type Settle,
  changedEntry,
  frameAt,
  isRerunGrant,
  planSettle,
  positionOf,
  slideEase,
} from "../settle.js";

const VIEWS: { view: View; label: string }[] = [
  { view: "indexed", label: "Indexed" },
  { view: "class", label: "Class" },
  { view: "raw", label: "Raw" },
];

const badgeOf = (row: StandingRow, view: View): string =>
  row.lastChange?.rankChange[view] ?? "";
const positionText = (row: StandingRow, view: View): string => {
  const position = positionOf(row, view);
  return position === null ? "No time" : `P${position}`;
};

export function Live() {
  const { event } = useEvent();
  const wide = useMediaQuery("(min-width: 1024px)");
  const [view, setView] = useState<View>("indexed");
  const [classCode, setClassCode] = useState("");
  const [rows, setRows] = useState<StandingRow[] | null>(null);
  const [expanded, setExpanded] = useState<number[]>([]);
  const [news, setNews] = useState("");
  const [settle, setSettle] = useState<Settle | null>(null);
  const [note, setNote] = useState<{
    registrationId: number;
    text: string;
  } | null>(null);

  const shown = useRef<StandingRow[] | null>(null);
  const current = useRef<Settle | null>(null);
  const key = useRef("");
  const wanted = useRef("");
  const elements = useRef(new Map<number, HTMLElement>());
  const flip = useRef<Map<number, number> | null>(null);
  const classes = event.heats.flatMap((h) => h.classes);

  const show = (next: StandingRow[] | null): void => {
    shown.current = next;
    setRows(next);
  };
  const finish = (): void => {
    if (current.current) show(current.current.after);
    current.current = null;
    setSettle(null);
  };

  const apply = (next: StandingRow[]): void => {
    if (current.current) finish();
    const before = shown.current;
    const subject = before === null ? null : changedEntry(before, next);
    if (before === null || subject === null) {
      show(next);
      return;
    }
    setNews(
      `Car ${subject.carNumber} ${subject.classCode}: ${badgeOf(subject, view)}`,
    );
    if (isRerunGrant(subject)) {
      setNote(null);
      show(next);
      return;
    }
    const plan = planSettle(before, next, subject);
    if (prefersReducedMotion()) {
      show(next);
      setNote(
        plan.cones > 0
          ? {
              registrationId: subject.registrationId,
              text: coneLabel(plan.cones),
            }
          : null,
      );
      return;
    }
    setNote(null);
    current.current = plan;
    setSettle(plan);
  };

  useRefresh(
    async () => {
      const requested = `${view}:${classCode}`;
      wanted.current = requested;
      const query = `view=${view}${classCode ? `&class=${classCode}` : ""}`;
      const standings = await api.get<Standings>(
        `/api/events/${event.id}/standings?${query}`,
      );
      if (requested !== wanted.current) return;
      if (key.current === requested) apply(standings.rows);
      else {
        key.current = requested;
        current.current = null;
        setSettle(null);
        setNote(null);
        show(standings.rows);
      }
    },
    1,
    [event.id, view, classCode],
  );

  const reveal = (): void => {
    const plan = current.current;
    if (!plan) return;
    flip.current = new Map(
      [...elements.current].map(([id, el]) => [
        id,
        el.getBoundingClientRect().top,
      ]),
    );
    shown.current = plan.after;
    setRows(plan.after);
  };

  useLayoutEffect(() => {
    const first = flip.current;
    if (!first) return;
    flip.current = null;
    const moves = [...elements.current]
      .map(([id, el]) => ({
        el,
        delta:
          (first.get(id) ?? el.getBoundingClientRect().top) -
          el.getBoundingClientRect().top,
      }))
      .filter((m) => Math.abs(m.delta) > 0.5);
    for (const m of moves) m.el.style.transform = `translateY(${m.delta}px)`;
    let start: number | null = null;
    let frame = 0;
    const duration = moves.length > 0 ? SLIDE_MS : SLIDE_HOLD_MS;
    const step = (now: number): void => {
      start ??= now;
      const progress = Math.min(1, (now - start) / duration);
      for (const m of moves)
        m.el.style.transform = `translateY(${m.delta * (1 - slideEase(progress))}px)`;
      if (progress < 1) frame = requestAnimationFrame(step);
      else {
        for (const m of moves) m.el.style.transform = "";
        current.current = null;
        setSettle(null);
      }
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      for (const m of moves) m.el.style.transform = "";
    };
  }, [rows]);

  const toggle = (id: number): void =>
    setExpanded((now) =>
      now.includes(id) ? now.filter((x) => x !== id) : [...now, id],
    );
  const register =
    (id: number) =>
    (el: HTMLElement | null): void => {
      if (el) elements.current.set(id, el);
      else elements.current.delete(id);
    };
  const descriptionOf = (row: StandingRow): React.ReactNode =>
    settle?.registrationId === row.registrationId ? (
      <Readout settle={settle} onReveal={reveal} />
    ) : note?.registrationId === row.registrationId ? (
      <span className="note">{note.text}</span>
    ) : (
      row.carDescription
    );

  return (
    <>
      <div className="page-head">
        <h1>Live results</h1>
      </div>
      <div className="live-controls">
        <div role="tablist" aria-label="Standings view" className="tabs">
          {VIEWS.map((v) => (
            <button
              key={v.view}
              type="button"
              role="tab"
              aria-selected={view === v.view}
              className="tab"
              onClick={() => {
                setView(v.view);
                setExpanded([]);
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="filter">
          <label htmlFor="class-filter">Class filter</label>
          <select
            id="class-filter"
            value={classCode}
            onChange={(e) => setClassCode(e.target.value)}
          >
            <option value="">All classes</option>
            {classes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
      </div>
      <StatusRegion name="Standings updates" reserve>{news}</StatusRegion>
      {rows === null ? (
        <Skeleton rows={6} />
      ) : wide ? (
        <div className="table-wrap">
          <table aria-label="Live standings" className="standings">
            <thead>
              <tr>
                <th scope="col" className="num">
                  Pos
                </th>
                <th scope="col" className="num">
                  Car
                </th>
                <th scope="col">Class</th>
                <th scope="col">Driver</th>
                <th scope="col">Car description</th>
                <th scope="col" className="num">
                  Best adjusted
                </th>
                <th scope="col" className="num">
                  Best indexed
                </th>
                <th scope="col">Change</th>
                <th scope="col">Runs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.registrationId}>
                  <tr
                    ref={register(row.registrationId)}
                    className={
                      settle?.registrationId === row.registrationId
                        ? "settling"
                        : undefined
                    }
                  >
                    <td className="num">{positionText(row, view)}</td>
                    <td className="num">{row.carNumber}</td>
                    <td>{row.classCode}</td>
                    <td>{row.driverName}</td>
                    <td className="description">{descriptionOf(row)}</td>
                    <td className="num">{row.bestAdjusted ?? ""}</td>
                    <td className="num">{row.bestIndexed ?? ""}</td>
                    <td>
                      <Badge text={badgeOf(row, view)} />
                    </td>
                    <td>
                      <RunsButton
                        row={row}
                        open={expanded.includes(row.registrationId)}
                        onToggle={toggle}
                      />
                    </td>
                  </tr>
                  {expanded.includes(row.registrationId) ? (
                    <tr className="details">
                      <td colSpan={9}>
                        <RunDetails runs={row.runs} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul aria-label="Live standings" className="cards">
          {rows.map((row) => (
            <li
              key={row.registrationId}
              ref={register(row.registrationId)}
              className={
                settle?.registrationId === row.registrationId
                  ? "card settling"
                  : "card"
              }
            >
              <div className="card-top">
                <span className="num pos">{positionText(row, view)}</span>
                <span className="num car">
                  {row.carNumber} {row.classCode}
                </span>
                <Badge text={badgeOf(row, view)} />
              </div>
              <div className="card-driver">{row.driverName}</div>
              <div className="description">{descriptionOf(row)}</div>
              <div className="card-bottom">
                <span className="num best">
                  {(view === "indexed" ? row.bestIndexed : row.bestAdjusted) ??
                    ""}
                </span>
                <RunsButton
                  row={row}
                  open={expanded.includes(row.registrationId)}
                  onToggle={toggle}
                />
              </div>
              {expanded.includes(row.registrationId) ? (
                <RunDetails runs={row.runs} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function RunsButton({
  row,
  open,
  onToggle,
}: {
  row: StandingRow;
  open: boolean;
  onToggle: (id: number) => void;
}) {
  return (
    <button
      type="button"
      className="btn btn-icon"
      aria-label={`Runs for car ${row.carNumber} ${row.classCode}`}
      aria-expanded={open}
      onClick={() => onToggle(row.registrationId)}
    >
      <ChevronDown
        size={18}
        aria-hidden="true"
        className={open ? "chevron open" : "chevron"}
      />
    </button>
  );
}

/** The server's rank-change text, or a muted dash before the entry's first commit or correction. */
function Badge({ text }: { text: string }) {
  return text ? (
    <span className="badge">{text}</span>
  ) : (
    <span className="no-change" aria-label="No change yet">
      —
    </span>
  );
}

/** Each run as a row of right-aligned numbers: raw, cones, adjusted, indexed. */
function RunDetails({ runs }: { runs: RunView[] }) {
  return (
    <table className="run-details">
      <thead>
        <tr>
          <th scope="col">Run</th>
          <th scope="col" className="num">
            Raw
          </th>
          <th scope="col" className="num">
            Cones
          </th>
          <th scope="col" className="num">
            Adjusted
          </th>
          <th scope="col" className="num">
            Indexed
          </th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.runNumber}>
            <td className="num run-number">{run.runNumber}</td>
            {run.outcome === "dnf" ? (
              <>
                <td className="num">
                  <s className="strike">DNF</s>
                </td>
                <td className="num muted" colSpan={3}>
                  —
                </td>
              </>
            ) : run.status === "rerun_granted" ? (
              <td className="num muted" colSpan={4}>
                RRN
              </td>
            ) : run.rawTime === null ? (
              <td className="muted" colSpan={4}>
                Pending
              </td>
            ) : (
              <>
                <td className="num">{run.rawTime}</td>
                <td className={run.cones ? "num penalty" : "num muted"}>
                  +{run.cones ?? 0}
                </td>
                <td className="num">{run.adjustedTime}</td>
                <td className="num">{run.indexedTime}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The raw time rolls, one cone chip drops per cone, the penalty readout steps up by 2.000 per chip. */
function Readout({
  settle,
  onReveal,
}: {
  settle: Settle;
  onReveal: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const latest = useRef(onReveal);
  latest.current = onReveal;
  useEffect(() => {
    let start: number | null = null;
    let frame = 0;
    const step = (now: number): void => {
      start ??= now;
      const t = now - start;
      setElapsed(t);
      if (t >= settle.revealAt) latest.current();
      else frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [settle]);
  const frame = frameAt(settle, elapsed);
  return (
    <span className="readout" aria-hidden="true">
      {settle.outcome === "dnf" ? (
        <>
          <s className="num strike">{settle.struck}</s>
          <span className="num strike-label">DNF</span>
        </>
      ) : (
        <span className="num roll">{frame.roll}</span>
      )}
      {frame.drops.map((drop, index) => (
        <span
          key={index}
          className="chip"
          style={{
            opacity: drop,
            transform: `translateY(${(1 - drop) * -8}px)`,
          }}
        />
      ))}
      {frame.penalty ? (
        <span className="num penalty">{frame.penalty}</span>
      ) : null}
    </span>
  );
}
