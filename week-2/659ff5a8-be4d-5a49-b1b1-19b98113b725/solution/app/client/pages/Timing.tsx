import { Fragment, type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { CommitResult, CorrectionEntry, RunEntry, RunView } from "../../shared/api.js";
import { canCommit, canCorrect } from "../../shared/lifecycle.js";
import { ApiFailure, api } from "../api.js";
import { EMPTY_ENTRY, commitSentence, correctionSentence } from "../announce.js";
import { Dialog } from "../components/Dialog.js";
import { useEvent } from "../components/EventFrame.js";
import { Field, type FieldErrors, FixFields } from "../components/Forms.js";
import { Skeleton, StatusRegion } from "../components/ui.js";
import { formatRunTime } from "../format.js";
import { useRefresh } from "../hooks.js";

interface Draft {
  time: string;
  cones: string;
}

const DNF_DRAFT = "DNF";
const RERUN_DRAFT = "RRN";
const FIRST_RUN_COLUMN = 3;
const NO_DRAFT: Draft = { time: "", cones: "" };

const draftKey = (registrationId: number, runNumber: number): string => `${registrationId}:${runNumber}`;
const isTimeColumn = (column: number): boolean => (column - FIRST_RUN_COLUMN) % 2 === 0;
const runOfColumn = (column: number): number => Math.floor((column - FIRST_RUN_COLUMN) / 2) + 1;
const timeColumn = (runNumber: number): number => FIRST_RUN_COLUMN + (runNumber - 1) * 2;

export function Timing() {
  const { event, reload } = useEvent();
  const [heat, setHeat] = useState(event.runningHeat ?? 1);
  useEffect(() => setHeat(event.runningHeat ?? 1), [event.runningHeat]);
  const [entries, setEntries] = useState<RunEntry[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [waiting, setWaiting] = useState<string[]>([]);
  const [news, setNews] = useState("");
  const [active, setActive] = useState({ row: 0, column: FIRST_RUN_COLUMN });
  const [correcting, setCorrecting] = useState<{ entry: RunEntry; run: RunView } | null>(null);
  const [switching, setSwitching] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const lastColumn = FIRST_RUN_COLUMN + event.runsPerDriver * 2 - 1;

  const reloadEntries = useRefresh(
    async () => setEntries((await api.get<{ entries: RunEntry[] }>(`/api/events/${event.id}/runs?heat=${heat}`)).entries),
    3,
    [event.id, heat],
  );

  const focusCell = (row: number, column: number): void => {
    setActive({ row, column });
    grid.current?.querySelector<HTMLElement>(`[data-row="${row}"][data-column="${column}"]`)?.focus();
  };

  const jumpRequested = useRef(false);

  const jumpToFirstOpenRun = (rows: RunEntry[]): void => {
    jumpRequested.current = false;
    for (const [row, entry] of rows.entries()) {
      const run = entry.runs.find((r) => canCommit(r.status));
      if (run) {
        focusCell(row, timeColumn(run.runNumber));
        return;
      }
    }
  };

  useEffect(() => {
    const jump = (key: globalThis.KeyboardEvent): void => {
      if (!key.altKey || key.code !== "KeyG") return;
      key.preventDefault();
      if (entries) jumpToFirstOpenRun(entries);
      else jumpRequested.current = true;
    };
    window.addEventListener("keydown", jump);
    return () => window.removeEventListener("keydown", jump);
  });

  useEffect(() => {
    if (entries && jumpRequested.current) jumpToFirstOpenRun(entries);
  }, [entries]);

  const setDraft = (key: string, change: (draft: Draft) => Draft): void =>
    setDrafts((current) => ({ ...current, [key]: change(current[key] ?? NO_DRAFT) }));

  const replaceRun = (registrationId: number, run: RunView): void =>
    setEntries((current) =>
      current?.map((e) =>
        e.registrationId === registrationId ? { ...e, runs: e.runs.map((r) => (r.runNumber === run.runNumber ? run : r)) } : e,
      ) ?? null,
    );

  const commit = async (row: number, entry: RunEntry, runNumber: number, origin: Element | null): Promise<void> => {
    const key = draftKey(entry.registrationId, runNumber);
    const draft = drafts[key] ?? NO_DRAFT;
    if (draft.time === "") {
      setNews(EMPTY_ENTRY);
      return;
    }
    const cones = draft.cones === "" ? undefined : Number(draft.cones);
    const body =
      draft.time === DNF_DRAFT
        ? { outcome: "dnf", cones }
        : draft.time === RERUN_DRAFT
          ? { outcome: "rerun" }
          : { outcome: "time", rawTime: draft.time, cones: cones ?? 0 };
    setWaiting((current) => [...current, key]);
    try {
      const result = await api.post<CommitResult>(`/api/registrations/${entry.registrationId}/runs/${runNumber}`, body);
      replaceRun(entry.registrationId, result.run);
      setDrafts(({ [key]: _done, ...rest }) => rest);
      setNews(commitSentence(result));
      if (document.activeElement === origin) focusCell(Math.min(row + 1, (entries?.length ?? 1) - 1), timeColumn(runNumber));
      reloadEntries();
    } catch (error) {
      setNews(commitFailure(error, entry, runNumber));
      reloadEntries();
    } finally {
      setWaiting((current) => current.filter((k) => k !== key));
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[role="gridcell"]');
    if (!cell || !entries || event.altKey || event.ctrlKey || event.metaKey) return;
    const row = Number(cell.dataset["row"]);
    const column = Number(cell.dataset["column"]);
    const moves: Record<string, [number, number]> = {
      ArrowRight: [row, Math.min(column + 1, lastColumn)],
      ArrowLeft: [row, Math.max(column - 1, 0)],
      ArrowDown: [Math.min(row + 1, entries.length - 1), column],
      ArrowUp: [Math.max(row - 1, 0), column],
      Home: [row, 0],
      End: [row, lastColumn],
    };
    const target = moves[event.key];
    if (target) {
      event.preventDefault();
      focusCell(target[0], target[1]);
      return;
    }
    const entry = entries[row];
    if (!entry || column < FIRST_RUN_COLUMN) return;
    const runNumber = runOfColumn(column);
    const run = entry.runs[runNumber - 1];
    if (!run) return;
    const key = draftKey(entry.registrationId, runNumber);
    if (event.key === "Enter") {
      event.preventDefault();
      if (canCommit(run.status)) void commit(row, entry, runNumber, cell);
      else if (canCorrect(run.status)) setCorrecting({ entry, run });
      return;
    }
    if (!canCommit(run.status)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setDrafts(({ [key]: _cleared, ...rest }) => rest);
    } else if (event.key === "Backspace") {
      event.preventDefault();
      setDraft(key, (d) =>
        isTimeColumn(column)
          ? { ...d, time: d.time === DNF_DRAFT || d.time === RERUN_DRAFT ? "" : d.time.slice(0, -1) }
          : { ...d, cones: d.cones.slice(0, -1) },
      );
    } else if (isTimeColumn(column) && /^[0-9.]$/.test(event.key)) {
      event.preventDefault();
      setDraft(key, (d) => ({ ...d, time: d.time === DNF_DRAFT || d.time === RERUN_DRAFT ? event.key : d.time + event.key }));
    } else if (isTimeColumn(column) && /^[dD]$/.test(event.key)) {
      event.preventDefault();
      setDraft(key, (d) => ({ ...d, time: DNF_DRAFT }));
    } else if (isTimeColumn(column) && /^[rR]$/.test(event.key)) {
      event.preventDefault();
      setDraft(key, (d) => ({ ...d, time: RERUN_DRAFT }));
    } else if (!isTimeColumn(column) && /^[0-9]$/.test(event.key)) {
      event.preventDefault();
      setDraft(key, (d) => (d.cones.length < 2 ? { ...d, cones: d.cones + event.key } : d));
    }
  };

  const changeHeat = async (value: number): Promise<void> => {
    setHeat(value);
    setSwitching(true);
    try {
      await api.post(`/api/events/${event.id}/running-heat`, { heat: value });
    } catch {
      setNews("The heat could not be changed. Try again.");
    } finally {
      setSwitching(false);
      reload();
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>Timing</h1>
        <div className="heat-select">
          <label htmlFor="running-heat">Running heat</label>
          <select
            id="running-heat"
            value={heat}
            disabled={event.status !== "running" || switching}
            onChange={(e) => void changeHeat(Number(e.target.value))}
          >
            {event.heats.map((h) => (
              <option key={h.number} value={h.number}>
                Heat {h.number}
              </option>
            ))}
          </select>
        </div>
      </div>
      <StatusRegion name="Timing announcements" reserve>{news}</StatusRegion>
      {entries === null ? (
        <Skeleton />
      ) : (
        <div className="grid-scroll">
          <div
            ref={grid}
            role="grid"
            aria-label="Run grid"
            className="run-grid"
            style={{ "--runs": event.runsPerDriver } as React.CSSProperties}
            onKeyDown={onKeyDown}
          >
            <div role="row" className="grid-row grid-head">
              <span role="columnheader">Car</span>
              <span role="columnheader">Class</span>
              <span role="columnheader">Driver</span>
              {Array.from({ length: event.runsPerDriver }, (_, index) => (
                <Fragment key={index}>
                  <span role="columnheader" className="num">
                    Run {index + 1}
                  </span>
                  <span role="columnheader" className="num">
                    Cones
                  </span>
                </Fragment>
              ))}
            </div>
            {entries.map((entry, row) => (
              <div role="row" className="grid-row" key={entry.registrationId}>
                <Cell row={row} column={0} active={active} className="num" label={`Car ${entry.carNumber}`}>
                  {entry.carNumber}
                </Cell>
                <Cell row={row} column={1} active={active} label={`Class ${entry.classCode}`}>
                  {entry.classCode}
                </Cell>
                <Cell row={row} column={2} active={active} label={entry.checkedIn ? `Driver ${entry.driverName}` : `Driver ${entry.driverName} Not checked in`}>
                  {entry.driverName}
                  {entry.checkedIn ? null : (
                    <>
                      {" "}
                      <span className="tag">Not checked in</span>
                    </>
                  )}
                </Cell>
                {entry.runs.flatMap((run) => {
                  const key = draftKey(entry.registrationId, run.runNumber);
                  const draft = canCommit(run.status) ? (drafts[key] ?? NO_DRAFT) : NO_DRAFT;
                  const dim = waiting.includes(key);
                  const name = `Car ${entry.carNumber} ${entry.classCode} run ${run.runNumber}`;
                  return [
                    <Cell
                      key={`${key}:time`}
                      row={row}
                      column={timeColumn(run.runNumber)}
                      active={active}
                      label={`${name} time`}
                      value={draft.time !== "" ? draft.time : formatRunTime(run)}
                      className={`num${draft.time !== "" ? " drafting" : ""}${dim ? " dim" : ""}`}
                    >
                      {draft.time !== "" ? draft.time : formatRunTime(run)}
                    </Cell>,
                    <Cell
                      key={`${key}:cones`}
                      row={row}
                      column={timeColumn(run.runNumber) + 1}
                      active={active}
                      label={`${name} cones`}
                      value={String(draft.cones !== "" ? draft.cones : run.outcome === "time" ? (run.cones ?? 0) : "")}
                      className={`num${draft.cones !== "" ? " drafting" : ""}${dim ? " dim" : ""}`}
                    >
                      {draft.cones !== "" ? draft.cones : run.outcome === "time" ? (run.cones ?? 0) : ""}
                    </Cell>,
                  ];
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="hint">Arrow keys move between cells. Type a time, press Enter to record it. Alt+G jumps to the first open run.</p>
      {correcting ? (
        <CorrectRun
          entry={correcting.entry}
          run={correcting.run}
          onClose={() => setCorrecting(null)}
          onNews={setNews}
          onSaved={() => {
            setCorrecting(null);
            reloadEntries();
          }}
        />
      ) : null}
    </>
  );
}

interface CellProps {
  row: number;
  column: number;
  active: { row: number; column: number };
  label: string;
  /**
   * The cell's value, when its name is fixed by the brief and cannot carry it. It is spoken as the description and drawn
   * by the stylesheet, so the fixed name is the cell's only text (the visible value is not part of a label that differs).
   */
  value?: string;
  className?: string;
  children: React.ReactNode;
}

function Cell({ row, column, active, label, value, className, children }: CellProps) {
  const current = active.row === row && active.column === column;
  return (
    <div
      role="gridcell"
      aria-label={label}
      aria-description={value === undefined || value === "" ? undefined : value}
      data-value={value}
      tabIndex={current ? 0 : -1}
      data-row={row}
      data-column={column}
      className={`cell ${value === undefined ? "" : "valued "}${className ?? ""}`}
    >
      {value === undefined ? children : null}
    </div>
  );
}

function commitFailure(error: unknown, entry: RunEntry, runNumber: number): string {
  if (!(error instanceof ApiFailure)) return "Could not record the run. Try again.";
  if (error.status === 422) return error.fields["rawTime"] ?? error.fields["cones"] ?? error.message;
  if (error.code === "heat_not_running") return `Car ${entry.carNumber} runs in heat ${entry.runHeat}, which is not running.`;
  if (error.code === "not_checked_in") return `Car ${entry.carNumber} is not checked in.`;
  if (error.code === "run_already_committed") return `Run ${runNumber} for car ${entry.carNumber} is already recorded. Press Enter to correct it.`;
  return error.message;
}

interface CorrectProps {
  entry: RunEntry;
  run: RunView;
  onClose: () => void;
  onNews: (text: string) => void;
  onSaved: () => void;
}

function CorrectRun({ entry, run, onClose, onNews, onSaved }: CorrectProps) {
  const [outcome, setOutcome] = useState<"time" | "dnf">(run.outcome === "dnf" ? "dnf" : "time");
  const [rawTime, setRawTime] = useState(run.rawTime ?? "");
  const [cones, setCones] = useState(String(run.cones ?? 0));
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setErrors({});
    onNews("Saving correction");
    try {
      const body = { outcome, rawTime: outcome === "time" ? rawTime : undefined, cones: Number(cones), reason };
      const result = await api.post<CommitResult & { correction: CorrectionEntry }>(`/api/runs/${run.id}/corrections`, body);
      onNews(correctionSentence(result));
      onSaved();
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) {
        setErrors(error.fields);
        onNews("");
      } else {
        onNews(error instanceof ApiFailure && error.code === "results_locked" ? "Results are final. Times can no longer change." : "Could not save the correction. Try again.");
        onClose();
      }
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog title={`Correct car ${entry.carNumber} ${entry.classCode} run ${run.runNumber}`} label="Correct run" onClose={onClose}>
      <form aria-label="Correction form" onSubmit={(e) => void submit(e)} noValidate>
        <FixFields form="correct" errors={errors} />
        <fieldset id="correct-change" className="radio-group">
          <legend>Outcome</legend>
          <label className="radio">
            <input type="radio" name="outcome" checked={outcome === "time"} onChange={() => setOutcome("time")} />
            Time
          </label>
          <label className="radio">
            <input type="radio" name="outcome" checked={outcome === "dnf"} onChange={() => setOutcome("dnf")} />
            DNF
          </label>
          {errors["change"] ? <p className="field-error">{errors["change"]}</p> : null}
        </fieldset>
        <Field form="correct" name="rawTime" label="Raw time" error={errors["rawTime"]}>
          {(p) => <input type="text" disabled={outcome === "dnf"} {...p} value={rawTime} onChange={(e) => setRawTime(e.target.value)} />}
        </Field>
        <Field form="correct" name="cones" label="Cones" error={errors["cones"]}>
          {(p) => <input type="number" min={0} max={30} {...p} value={cones} onChange={(e) => setCones(e.target.value)} />}
        </Field>
        <Field form="correct" name="reason" label="Reason" error={errors["reason"]}>
          {(p) => <input type="text" {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>
            Save correction
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
