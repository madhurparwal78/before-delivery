import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { formatLong } from "../../shared/calendar";
import { varianceText } from "../../shared/format";
import type { AppConfig, Item, Person } from "../../shared/types";
import { AddLink } from "../dialogs/add-link";
import { SaveBaseline } from "../dialogs/baseline";
import { Holidays } from "../dialogs/holidays";
import { ProgressSheet } from "../dialogs/progress-sheet";
import { TaskDetails } from "../dialogs/task-details";
import { READ_ONLY } from "../messages";
import { setParams, useLocation } from "../router";
import { ProjectSession, type SessionState } from "../store";
import { Gantt } from "../views/gantt";
import { TaskList } from "../views/list";
import { Timeline } from "../views/timeline";
import { WorkloadGrid } from "../views/workload";

type View = "gantt" | "list" | "workload";
const VIEWS: { id: View; label: string }[] = [
  { id: "gantt", label: "Gantt" },
  { id: "list", label: "List" },
  { id: "workload", label: "Workload" },
];

type Open =
  | { kind: "details"; itemId: string; opener: HTMLElement | null }
  | { kind: "link"; item: Item; opener: HTMLElement | null }
  | { kind: "progress"; item: Item; opener: HTMLElement | null }
  | { kind: "holidays" }
  | { kind: "baseline" };

const PHONE = "(max-width: 767px)";

function usePhone(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia(PHONE);
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    () => window.matchMedia(PHONE).matches,
  );
}

function criticalCount(state: SessionState): string {
  const count = state.project?.items.filter((item) => item.critical).length ?? 0;
  return count === 0 ? "No critical tasks" : count === 1 ? "1 critical task" : `${count} critical tasks`;
}

export function ProjectPage({ projectId, me, config }: { projectId: string; me: Person; config: AppConfig }) {
  const [session] = useState(() => new ProjectSession(projectId, me, config));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { params } = useLocation();
  const phone = usePhone();
  const [open, setOpen] = useState<Open | null>(null);
  const focusAfter = useRef<string | null>(null);
  const holidaysButton = useRef<HTMLButtonElement>(null);
  const baselineButton = useRef<HTMLButtonElement>(null);
  const taskParam = params.get("task");
  const view: View = VIEWS.find((candidate) => candidate.id === params.get("view"))?.id ?? "gantt";
  const showBaseline = params.get("baseline") === "on";
  const highlightCritical = params.get("critical") === "on";

  useEffect(() => {
    void session.start();
    return () => session.stop();
  }, [session]);

  useEffect(() => {
    if (state.phase === "ready" && taskParam && state.project?.items.some((item) => item.id === taskParam) && open === null) {
      setOpen({ kind: "details", itemId: taskParam, opener: null });
    }
  }, [state.phase, taskParam]);

  if (state.phase === "missing") {
    return (
      <main className="project">
        <h1>No such project.</h1>
      </main>
    );
  }
  const project = state.project;
  if (state.phase === "loading" || !project) {
    return (
      <main className="project">
        <p className="quiet">Loading the plan.</p>
      </main>
    );
  }

  const firstBar = (): HTMLElement | null => document.querySelector<HTMLElement>(".chart [data-kind='task'], .chart [data-kind='milestone']");
  const barOf = (itemId: string): HTMLElement | null => document.querySelector<HTMLElement>(`.chart [data-item-id="${itemId}"]:not([data-baseline-bar])`);
  const close = (focusItemId?: string) => {
    focusAfter.current = focusItemId ?? null;
    if (taskParam) setParams({ task: null });
    setOpen(null);
  };
  const returnFor = (opener: HTMLElement | null) => () => {
    const target = focusAfter.current ? barOf(focusAfter.current) : null;
    focusAfter.current = null;
    return target ?? opener ?? firstBar();
  };
  const readOnlyClick = () => session.setAlert(READ_ONLY);

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = VIEWS[(index + step + VIEWS.length) % VIEWS.length];
    setParams({ view: next.id }, true);
    document.getElementById(`tab-${next.id}`)?.focus();
  };

  const people = [...state.people].sort((a, b) => (a.userId === me.id ? -1 : b.userId === me.id ? 1 : a.name.localeCompare(b.name)));
  const empty = project.items.length === 0;
  let body: ReactNode;
  if (view === "list") body = <TaskList session={session} state={state} openDetails={(itemId, opener) => setOpen({ kind: "details", itemId, opener })} />;
  else if (view === "workload") body = <WorkloadGrid session={session} state={state} from={params.get("from")} />;
  else if (empty)
    body = (
      <div className="empty">
        <p>No tasks yet. Add the first task in the list.</p>
        <button type="button" onClick={() => setParams({ view: "list" }, true)}>
          Open the list
        </button>
      </div>
    );
  else if (phone) body = <Timeline session={session} state={state} openProgress={(item, opener) => setOpen({ kind: "progress", item, opener })} />;
  else
    body = (
      <Gantt
        session={session}
        state={state}
        showBaseline={showBaseline}
        highlightCritical={highlightCritical}
        openDetails={(itemId, opener) => setOpen({ kind: "details", itemId, opener })}
        openLink={(item, opener) => setOpen({ kind: "link", item, opener })}
      />
    );

  return (
    <main className="project" data-view={view}>
      <header className="project-head">
        <div className="head-main">
          <h1>{project.name}</h1>
          <p id="project-finish">{project.finish ? `Finishes ${formatLong(project.finish)}` : "No finish date yet"}</p>
          {project.baseline ? <p id="finish-variance">{varianceText(project.baseline.finishVariance)}</p> : null}
          <p id="critical-count">{criticalCount(state)}</p>
        </div>
        <ul aria-label="People here" className="people">
          {people.map((person) => (
            <li key={person.userId}>{person.userId === me.id ? `${person.name} (you)` : person.name}</li>
          ))}
        </ul>
      </header>
      <div role="tablist" aria-label="View" className="tabs">
        {VIEWS.map((entry, index) => (
          <button
            key={entry.id}
            id={`tab-${entry.id}`}
            type="button"
            role="tab"
            aria-selected={view === entry.id}
            tabIndex={view === entry.id ? 0 : -1}
            onClick={() => setParams({ view: entry.id }, true)}
            onKeyDown={(event) => onTabKey(event, index)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <label className="check">
          <input type="checkbox" checked={showBaseline} onChange={(event) => setParams({ baseline: event.target.checked ? "on" : null })} />
          <span>Show baseline</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={highlightCritical} onChange={(event) => setParams({ critical: event.target.checked ? "on" : null })} />
          <span>Highlight critical path</span>
        </label>
        <button type="button" ref={baselineButton} aria-disabled={session.readOnly ? "true" : undefined} onClick={() => (session.readOnly ? readOnlyClick() : setOpen({ kind: "baseline" }))}>
          Save baseline
        </button>
        <button type="button" ref={holidaysButton} aria-disabled={session.readOnly ? "true" : undefined} onClick={() => (session.readOnly ? readOnlyClick() : setOpen({ kind: "holidays" }))}>
          Holidays
        </button>
        <ExportMenu session={session} />
      </div>
      <div className="notes">
        <p role="status" aria-live="polite" aria-label="Schedule updates">
          {state.scheduleStatus}
        </p>
        <p role="status" aria-live="polite" aria-label="Project updates">
          {state.updatesStatus}
        </p>
        <p role="status" aria-live="polite" aria-label="Export status">
          {state.exportStatus}
        </p>
        <div role="alert" className="page-alert">
          {state.pageAlert}
        </div>
      </div>
      {body}
      <section aria-label="Exports" className="exports" data-yellow-ready={view !== "gantt" || phone ? "true" : "false"}>
        <h2>Exports</h2>
        <ul>
          {state.exports.map((entry, index) => (
            <li key={entry.id}>
              <a href={entry.downloadUrl}>Download {entry.filename}</a>
              <span className="format">{entry.format.toUpperCase()}</span>
              <span className="made">{madeAt(entry.createdAt, config.timeZone)}</span>
              {index === 0 ? <span className="ready-tag">Ready</span> : null}
            </li>
          ))}
        </ul>
      </section>
      {open?.kind === "details" ? <TaskDetails session={session} state={state} itemId={open.itemId} returnTo={returnFor(open.opener)} onClose={close} /> : null}
      {open?.kind === "link" ? <AddLink session={session} state={state} from={open.item} returnTo={returnFor(open.opener)} onClose={() => close()} /> : null}
      {open?.kind === "progress" ? <ProgressSheet session={session} item={open.item} returnTo={returnFor(open.opener)} onClose={() => close()} /> : null}
      {open?.kind === "holidays" ? <Holidays session={session} state={state} returnTo={() => holidaysButton.current} onClose={() => close()} /> : null}
      {open?.kind === "baseline" ? <SaveBaseline session={session} state={state} returnTo={() => baselineButton.current} onClose={() => close()} /> : null}
    </main>
  );
}

function madeAt(createdAt: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(Date.parse(createdAt));
}

function ExportMenu({ session }: { session: ProjectSession }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (open) items.current[0]?.focus();
  }, [open]);

  const choose = (format: "csv" | "pdf") => {
    setOpen(false);
    button.current?.focus();
    void session.exportAs(format);
  };

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = items.current.findIndex((element) => element === document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items.current[(at + step + items.current.length) % items.current.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    }
  };

  return (
    <div className="export-menu">
      <button
        type="button"
        ref={button}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        Export
      </button>
      {open ? (
        <div role="menu" aria-label="Export" onKeyDown={onMenuKey} onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== button.current && setOpen(false)}>
          <button type="button" role="menuitem" ref={(element) => { items.current[0] = element; }} onClick={() => choose("csv")}>
            Export CSV
          </button>
          <button type="button" role="menuitem" ref={(element) => { items.current[1] = element; }} onClick={() => choose("pdf")}>
            Export PDF
          </button>
        </div>
      ) : null}
    </div>
  );
}
