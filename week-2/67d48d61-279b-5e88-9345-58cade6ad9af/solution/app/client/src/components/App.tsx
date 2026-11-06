// The shell: header, department rail (a drawer on phones), service banners, the Notices region,
// and the keys that work from anywhere.

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { CREW, DEPARTMENTS, SHOW, THEATRE, isOpen } from "../../../shared/catalog";
import { copy } from "../copy";
import { DURATION, play } from "../motion";
import { navigate, openPalette, refreshProduction, setWorkingAs, shown, shownBlockedCount, undoLast, useApp } from "../store";
import { DEFAULT_VIEW } from "../url";
import { useWidth } from "../width";
import { Icon, Tape } from "./bits";
import { FileRequestDialog, NewTaskDialog } from "./Forms";
import { Modal, refocus, type ModalHandle } from "./Modal";
import { Palette } from "./Palette";
import { RequestsScreen } from "./Requests";
import { TasksScreen } from "./Tasks";
import { TriageScreen } from "./Triage";

const isTyping = (el: Element | null): boolean =>
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "file"].includes(el.type)) ||
  (el instanceof HTMLElement && el.isContentEditable);

const follow = (e: MouseEvent<HTMLAnchorElement>, go: () => void): void => {
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  go();
};

const Countdown = () => {
  const app = useApp();
  useEffect(() => {
    const timer = setInterval(() => void refreshProduction().catch(() => undefined), 60_000);
    return () => clearInterval(timer);
  }, []);
  return app.production ? <p className="countdown">{copy.countdown(app.production.days_to_opening)}</p> : null;
};

// The blocked count: the link's name always carries the final count; the digits roll one step
// as each freed task is reached.
const BlockedLink = () => {
  const app = useApp();
  const digits = useRef<HTMLSpanElement>(null);
  const rolling = shownBlockedCount();
  const last = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!app.snapshot || last.current === rolling) return;
    const previous = last.current;
    last.current = rolling;
    if (previous === null) return;
    play(digits.current, [{ transform: `translateY(${rolling < previous ? "-0.45em" : "0.45em"})` }, { transform: "none" }], {
      duration: DURATION.hover,
      easing: "ease-out",
    });
  }, [rolling, app.snapshot]);
  const final = app.snapshot?.blocked ?? 0;
  return (
    <a
      className="blocked-link"
      href="/tasks?blocked=1"
      aria-label={`${final} blocked`}
      onClick={(e) => follow(e, () => navigate("/tasks", { ...DEFAULT_VIEW, blocked: true }))}
    >
      <span className="num blocked-digits" ref={digits} aria-hidden="true">
        {rolling}
      </span>
      <span aria-hidden="true"> blocked</span>
    </a>
  );
};

const Rail = ({ onNavigate }: { onNavigate?: () => void }) => {
  const app = useApp();
  const snap = app.snapshot;
  const openCount = (dept: string): number =>
    [...app.tasks.keys()].filter((id) => {
      const t = shown(id);
      return t !== undefined && t.department === dept && isOpen(t.status);
    }).length;
  const go = (path: string, view = DEFAULT_VIEW) => (e: MouseEvent<HTMLAnchorElement>) =>
    follow(e, () => {
      navigate(path, view);
      onNavigate?.();
    });
  const onTasks = app.path === "/tasks";
  return (
    <nav className="rail" aria-label="Departments">
      <ul className="rail-list">
        <li>
          <a href="/tasks" aria-current={onTasks && !app.view.dept ? "page" : undefined} onClick={go("/tasks", { ...app.view, dept: null, row: null, task: null })}>
            All tasks
          </a>
        </li>
        <li>
          <a href="/triage" aria-label={`Triage ${snap?.triage ?? 0}`} aria-current={app.path === "/triage" ? "page" : undefined} onClick={go("/triage")}>
            <span>Triage</span>{" "}
            <span className="num count">{snap?.triage ?? 0}</span>
          </a>
        </li>
        <li>
          <a href="/requests" aria-current={app.path === "/requests" ? "page" : undefined} onClick={go("/requests")}>
            Requests
          </a>
        </li>
      </ul>
      <h2 className="rail-heading">Departments</h2>
      <ul className="rail-list">
        {DEPARTMENTS.map((d) => {
          const n = openCount(d.key);
          return (
            <li key={d.key}>
              <a
                href={`/tasks?dept=${d.key}`}
                aria-label={`${d.name} ${n}`}
                aria-current={onTasks && app.view.dept === d.key ? "page" : undefined}
                onClick={go("/tasks", { ...app.view, dept: d.key, row: null, task: null })}
              >
                <Tape dept={d.key} />{" "}
                <span className="num count">{n}</span>
              </a>
            </li>
          );
        })}
      </ul>
      <h2 className="rail-heading">Cycles</h2>
      <ul className="rail-cycles">
        {(snap?.cycles ?? []).map((c) => (
          <li key={c.key} className={c.current ? "cycle current" : "cycle"}>
            <span className="cycle-name">
              {c.name}
              {c.current ? <span className="cycle-now">now</span> : null}
            </span>
            <div
              className="progress"
              role="progressbar"
              aria-label={`${c.name} progress`}
              aria-valuemin={0}
              aria-valuemax={c.total}
              aria-valuenow={c.done}
            >
              <span
                className="progress-fill"
                style={{ transform: `scaleX(${c.total ? c.done / c.total : 0})`, transitionDelay: `${app.progressDelay}ms` }}
              />
            </div>
            <span className="num cycle-tally">{copy.cycleProgress(c.done, c.total)}</span>
          </li>
        ))}
      </ul>
      <div className="working-as">
        <label htmlFor="working-as">Working as</label>
        <select id="working-as" value={app.actor} onChange={(e) => setWorkingAs(e.target.value)}>
          {CREW.map((m) => (
            <option key={m.handle} value={m.handle}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
    </nav>
  );
};

const Notices = () => {
  const app = useApp();
  return (
    <div className={app.notice.text ? "notices has-text" : "notices"} role="status" aria-live="polite" aria-label="Notices">
      <span key={app.notice.serial}>{app.notice.text}</span>
    </div>
  );
};

const ServiceStatus = () => {
  const app = useApp();
  return (
    <div className="service-status" role="region" aria-label="Service status">
      {app.status.intake === "down" ? (
        <p className="banner" role="alert">
          {copy.intakeBanner}
        </p>
      ) : null}
      {app.status.plot_storage === "down" ? (
        <p className="banner" role="alert">
          {copy.storageBanner}
        </p>
      ) : null}
    </div>
  );
};

const NotFound = () => (
  <section className="not-found">
    <h1 tabIndex={-1}>{copy.notFound}</h1>
    <a href="/tasks" className="button primary" onClick={(e) => follow(e, () => navigate("/tasks", DEFAULT_VIEW))}>
      Back to tasks
    </a>
  </section>
);

export const App = () => {
  const app = useApp();
  const width = useWidth();
  const [drawer, setDrawer] = useState<{ opener: Element; serial: number } | null>(null);
  const drawerRef = useRef<ModalHandle>(null);
  const lastFocus = useRef<Element | null>(null);

  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      lastFocus.current = e.target as Element;
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (document.querySelector("dialog[open]:not([data-leaving])")) return;
      if (key === "k") {
        e.preventDefault();
        openPalette("", document.activeElement);
      } else if (key === "z" && !e.shiftKey && !isTyping(document.activeElement)) {
        e.preventDefault();
        void undoLast();
      }
    };
    document.addEventListener("focusin", onFocus);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("focusin", onFocus);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  // Focus never lands on the page body: when a re-render removes the focused element, focus
  // goes to the same row if it was redrawn, else the current row, else the screen heading.
  useLayoutEffect(() => {
    const active = document.activeElement;
    if ((active === null || active === document.body) && lastFocus.current && !lastFocus.current.isConnected) {
      refocus(lastFocus.current);
    }
  });

  const screen =
    app.path === "/tasks" ? <TasksScreen /> : app.path === "/triage" ? <TriageScreen /> : app.path === "/requests" ? <RequestsScreen /> : <NotFound />;

  return (
    <div className={`app width-${width}`}>
      <header className="masthead" role="banner">
        {width === "phone" ? (
          <button type="button" className="button icon-button" onClick={(e) => setDrawer({ opener: e.currentTarget, serial: (drawer?.serial ?? 0) + 1 })}>
            <Icon.menu />
            <span>Departments</span>
          </button>
        ) : null}
        <div className="title-block">
          <h1 className="show-title">{SHOW}</h1>
          <p className="theatre">{THEATRE}</p>
        </div>
        <div className="masthead-meta">
          <Countdown />
          <BlockedLink />
        </div>
      </header>
      <ServiceStatus />
      <div className="workspace">
        {width !== "phone" ? <Rail /> : null}
        <main className="screen" id="main">
          {app.loaded || app.path !== "/tasks" ? screen : <p className="loading">Opening the prompt book…</p>}
        </main>
      </div>
      <Notices />
      {drawer && width === "phone" ? (
        <Modal key={drawer.serial} ref={drawerRef} label="Departments" variant="drawer" opener={drawer.opener} onClosed={() => setDrawer((now) => (now?.serial === drawer.serial ? null : now))}>
          <div className="drawer-head">
            <h2>Departments</h2>
            <button type="button" className="button icon-button" aria-label="Close drawer" onClick={() => drawerRef.current?.close()}>
              <Icon.close />
            </button>
          </div>
          <Rail onNavigate={() => drawerRef.current?.close()} />
        </Modal>
      ) : null}
      {app.palette ? <Palette /> : null}
      {app.dialog?.kind === "new-task" ? <NewTaskDialog /> : null}
      {app.dialog?.kind === "file-request" ? <FileRequestDialog /> : null}
    </div>
  );
};

