import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api.ts";
import { store } from "./store.ts";
import { formatDate, type Cycle, type Issue } from "./types.ts";

const FOLD_MS = 200;
const HOLD_MS = 400;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function CycleModule(props: { number: number | null; onNavigate: (path: string) => void }): React.ReactNode {
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [missing, setMissing] = useState(false);
  const [folded, setFolded] = useState(false);
  const [counter, setCounter] = useState("");
  const [unfolded, setUnfolded] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, Issue>>({});
  const [reduced, setReduced] = useState(prefersReducedMotion());

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (): void => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const number = props.number;

  useEffect(() => {
    let cancelled = false;
    setMissing(false);
    const fetchCycle = async (): Promise<void> => {
      try {
        const { data } = number === null ? await api.currentCycle() : await api.cycle(number);
        if (cancelled) return;
        setCycle(data);
        if (reduced) {
          // With reduced motion the ribbon appears already folded.
          setFolded(true);
          setCounter("10 working days");
        } else {
          // One column per calendar day first, then the fold.
          setFolded(false);
          setCounter(`${data.calendar_days} days`);
          window.setTimeout(() => {
            if (!cancelled) setFolded(true);
          }, FOLD_MS);
          window.setTimeout(() => {
            if (!cancelled) setCounter("10 working days");
          }, FOLD_MS + 320);
        }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.code === "not_found") setMissing(true);
      }
    };
    void fetchCycle();
    return () => {
      cancelled = true;
    };
  }, [number, reduced]);

  const reloadIssues = async (): Promise<void> => {
    if (!cycle) return;
    try {
      const { data } = await api.issues("?cycle=all");
      const map: Record<string, Issue> = {};
      for (const issue of data.issues) map[issue.key] = issue;
      setIssues(map);
    } catch {
      // keep the current issues
    }
  };

  useEffect(() => {
    void reloadIssues();
  }, [cycle?.number]);

  useEffect(() => {
    const off = store.onStreamEvent((name) => {
      if (name === "issue" || name === "reset") void reloadIssues();
    });
    return off;
  }, [cycle?.number]);

  // A calendar change seen on the workspace refresh redraws the ribbon already folded.
  useEffect(() => {
    const off = store.onStreamEvent((name) => {
      if (name === "calendar-refresh") {
        void (async () => {
          try {
            const { data } = number === null ? await api.currentCycle() : await api.cycle(number);
            setCycle(data);
            setFolded(true);
            setCounter("10 working days");
          } catch {
            // keep the current cycle
          }
        })();
      }
    });
    return off;
  }, [number]);

  if (missing) {
    return (
      <div className="not-found">
        <h1>Not found</h1>
        <p>That item doesn't exist or isn't shared with you.</p>
      </div>
    );
  }
  if (!cycle) return <div className="not-found">Loading…</div>;

  const cycleIssues = cycle.issue_keys
    .map((k) => issues[k] ?? null)
    .filter((i): i is Issue => i !== null);
  const today = store.workspace?.today ?? "";

  const chipsForDate = (date: string): Issue[] => cycleIssues.filter((i) => i.due_date === date);
  const lastDay = cycle.days[cycle.days.length - 1]?.date ?? "";
  const unplaced = cycleIssues.filter(
    (i) => i.due_date === null || i.due_date < cycle.days[0]?.date || i.due_date > lastDay
  );

  const moveChip = async (issue: Issue, targetDate: string): Promise<void> => {
    const prevDate = issue.due_date;
    setIssues((map) => ({ ...map, [issue.key]: { ...issue, due_date: targetDate } }));
    try {
      const { data } = await api.patchIssue(issue.key, { due_date: targetDate });
      store.upsertIssue(data);
      const snapped = (data as Issue & { due_date_snapped: boolean }).due_date_snapped;
      if (snapped) {
        store.announce(`Due date moved to ${formatDate(data.due_date!)}, the next working day.`);
      } else {
        store.announce(`Due date set to ${formatDate(data.due_date!)}.`);
      }
      setIssues((map) => ({ ...map, [issue.key]: data }));
    } catch {
      // The chip goes back to where it came from and the failure is announced.
      setIssues((map) => ({ ...map, [issue.key]: { ...issue, due_date: prevDate } }));
      store.announce("Due date not saved.");
    }
  };

  const countedDates = cycle.days.filter((d) => d.counted).map((d) => d.date);
  const moveChipByStep = (issue: Issue, direction: 1 | -1): void => {
    if (issue.due_date === null) {
      // Shift+Right on an unplaced chip sets its due date to the first working day.
      void moveChip(issue, countedDates[0]);
      return;
    }
    if (direction === 1) {
      const next = countedDates.find((d) => d > issue.due_date!) ?? countedDates[countedDates.length - 1];
      void moveChip(issue, next);
    } else {
      const prev = [...countedDates].reverse().find((d) => d < issue.due_date!) ?? countedDates[0];
      void moveChip(issue, prev);
    }
  };

  return (
    <div>
      <div className="topbar">
        <h1>{`Cycle ${cycle.number}`}</h1>
        <span className="meta num">
          {formatDate(cycle.first_working_date)} – {formatDate(cycle.last_working_date)}
        </span>
        <span className="meta num" role="status" aria-live="polite" aria-label="Cycle length">
          {counter}
        </span>
        <button
          className="btn"
          aria-label="Previous cycle"
          onClick={() => props.onNavigate(`/cycle/${Math.max(1, cycle.number - 1)}`)}
        >
          Previous cycle
        </button>
        <button
          className="btn"
          aria-label="Next cycle"
          onClick={() => props.onNavigate(`/cycle/${cycle.number + 1}`)}
        >
          Next cycle
        </button>
      </div>
      <div className="meta num" role="status" aria-live="polite">
        {`Today: ${formatDate(today)}`}
      </div>
      <div className="section-label">Unplaced</div>
      <div className="unplaced-tray" role="group" aria-label="Unplaced">
        {unplaced.length === 0 && <span className="meta">Every issue in this cycle is placed.</span>}
        {unplaced.map((issue) => (
          <Chip key={issue.key} issue={issue} date={null} onMove={moveChip} onShift={moveChipByStep} />
        ))}
      </div>
      <div className="section-label">Ribbon</div>
      <Ribbon
        cycle={cycle}
        folded={folded}
        unfolded={unfolded}
        onUnfold={(date) => setUnfolded((prev) => (prev === date ? null : date))}
        chipsForDate={chipsForDate}
        onMove={moveChip}
        onShift={moveChipByStep}
        today={today}
        issuesMap={issues}
      />
      <div className="section-label">Burndown</div>
      <Burndown cycle={cycle} reduced={reduced} />
      <ul aria-label="Burndown values" className="visually-hidden">
        {cycle.burndown.map((b) => (
          <li key={b.date} className="num">{`${formatDate(b.date)}: ${b.open} open`}</li>
        ))}
      </ul>
    </div>
  );
}

function Chip(props: {
  issue: Issue;
  date: string | null;
  onMove: (issue: Issue, targetDate: string) => void;
  onShift: (issue: Issue, direction: 1 | -1) => void;
}): React.ReactNode {
  const { issue, date, onMove, onShift } = props;
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touch = useRef<{ x: number; y: number; started: boolean } | null>(null);

  const label = date === null ? `${issue.key}, no due date` : `${issue.key} due ${formatDate(date)}`;

  const clearHold = (): void => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  return (
    <button
      className="chip"
      aria-label={label}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", issue.key);
      }}
      onKeyDown={(e) => {
        if (e.shiftKey && e.key === "ArrowRight") {
          e.preventDefault();
          onShift(issue, 1);
        } else if (e.shiftKey && e.key === "ArrowLeft") {
          e.preventDefault();
          onShift(issue, -1);
        }
      }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        touch.current = { x: t.clientX, y: t.clientY, started: false };
        clearHold();
        // A finger held for 400ms with no more than 10px of movement starts the drag.
        holdTimer.current = setTimeout(() => {
          if (touch.current) touch.current.started = true;
        }, HOLD_MS);
      }}
      onTouchMove={(e) => {
        const st = touch.current;
        if (!st) return;
        const t = e.touches[0];
        if (!st.started && Math.hypot(t.clientX - st.x, t.clientY - st.y) > 10) {
          clearHold();
          return;
        }
        if (st.started) e.preventDefault();
      }}
      onTouchEnd={(e) => {
        const st = touch.current;
        touch.current = null;
        clearHold();
        if (!st || !st.started) return;
        const t = e.changedTouches[0];
        const el = document.elementFromPoint(t.clientX, t.clientY);
        const target = el?.closest<HTMLElement>("[data-drop-date]");
        if (target?.dataset.dropDate) {
          onMove(issue, target.dataset.dropDate);
        }
      }}
    >
      {issue.key}
    </button>
  );
}

function Ribbon(props: {
  cycle: Cycle;
  folded: boolean;
  unfolded: string | null;
  onUnfold: (date: string) => void;
  chipsForDate: (date: string) => Issue[];
  onMove: (issue: Issue, targetDate: string) => void;
  onShift: (issue: Issue, direction: 1 | -1) => void;
  today: string;
  issuesMap: Record<string, Issue>;
}): React.ReactNode {
  const { cycle, folded, unfolded, onUnfold, chipsForDate, onMove, onShift, today, issuesMap } = props;
  const workingCount = Math.max(1, cycle.days.filter((d) => d.counted).length);
  const [hoverDrop, setHoverDrop] = useState<string | null>(null);

  const columnStyle = (day: { counted: boolean; date: string }): React.CSSProperties => {
    if (unfolded === day.date) {
      return { flexBasis: `${(1 / workingCount) * 100}%`, minWidth: "64px" };
    }
    if (!folded) return { flexBasis: 0, flexGrow: 1 };
    return day.counted
      ? { flexBasis: `${(1 / workingCount) * 100}%` }
      : { flexBasis: "8px", minWidth: "8px" };
  };

  const handleDrop = (e: React.DragEvent, date: string): void => {
    e.preventDefault();
    const key = e.dataTransfer.getData("text/plain");
    const issue = issuesMap[key];
    if (issue) onMove(issue, date);
  };

  return (
    <div className="ribbon" role="region" aria-label="Cycle ribbon">
      {cycle.days.map((day) => {
        const isUnfolded = unfolded === day.date;
        const clockCopy =
          day.clock_change === "forward" ? "Clocks go forward" : day.clock_change === "back" ? "Clocks go back" : null;
        if (day.counted) {
          return (
            <div
              key={day.date}
              className={
                "ribbon-col working" +
                (day.date === today ? " today" : "") +
                (hoverDrop === day.date ? " drop-target" : "")
              }
              style={columnStyle(day)}
              role="group"
              aria-label={formatDate(day.date)}
              data-drop-date={day.date}
              onDragOver={(e) => {
                e.preventDefault();
                setHoverDrop(day.date);
              }}
              onDragLeave={() => setHoverDrop(null)}
              onDrop={(e) => {
                setHoverDrop(null);
                handleDrop(e, day.date);
              }}
            >
              <div className="date-label num">{formatDate(day.date)}</div>
              {chipsForDate(day.date).map((issue) => (
                <Chip key={issue.key} issue={issue} date={day.date} onMove={onMove} onShift={onShift} />
              ))}
              {clockCopy && <div className="meta">{clockCopy}</div>}
            </div>
          );
        }
        return (
          <div
            key={day.date}
            className={"ribbon-col crease" + (isUnfolded ? " unfolded" : "") + (hoverDrop === day.date ? " drop-target" : "")}
            style={columnStyle(day)}
            role="button"
            tabIndex={0}
            aria-expanded={isUnfolded}
            aria-label={`${formatDate(day.date)}, not counted`}
            data-drop-date={day.date}
            onClick={() => onUnfold(day.date)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onUnfold(day.date);
              }
            }}
            onBlur={() => {
              if (isUnfolded) onUnfold(day.date);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setHoverDrop(day.date);
            }}
            onDragLeave={() => setHoverDrop(null)}
            onDrop={(e) => {
              setHoverDrop(null);
              handleDrop(e, day.date);
            }}
          >
            <div className="date-label num">{formatDate(day.date)}</div>
            {isUnfolded && (
              <div className="crease-detail">
                <div>Not counted</div>
                <div>{day.reason}</div>
                {clockCopy && <div>{clockCopy}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Burndown(props: { cycle: Cycle; reduced: boolean }): React.ReactNode {
  const { cycle, reduced } = props;
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    setDrawn(false);
    const t = window.setTimeout(() => setDrawn(true), reduced ? 0 : 320);
    return () => window.clearTimeout(t);
  }, [cycle.number, reduced]);
  const entries = cycle.burndown;
  const max = Math.max(1, ...entries.map((e) => e.open));
  const w = 100;
  const h = 100;
  const points = entries.map((e, i) => ({
    x: ((i + 0.5) / Math.max(1, entries.length)) * w,
    y: h - (e.open / max) * h,
  }));
  return (
    <svg
      className="burndown-svg"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Burndown"
      style={{ opacity: drawn ? 1 : 0, transition: reduced ? "none" : "opacity 320ms" }}
    >
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2.4} fill="var(--ink)" />
      ))}
      {points.length > 1 && (
        <polyline points={points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="var(--ink)" strokeWidth={0.6} />
      )}
    </svg>
  );
}
