import { useEffect } from 'react';
import { ui } from '../../shared/copy.js';
import {
  CREW,
  CYCLE_NAMES,
  DEPARTMENTS,
  isOpenStatus,
  SHOW_TITLE,
  THEATRE_NAME,
} from '../../shared/domain.js';
import { loadAll, loadDetail, loadRequests } from '../actions.js';
import { api, setActor } from '../api.js';
import { SCREEN_PATHS } from '../address.js';
import { handleKeyDown } from '../keys.js';
import { startLiveUpdates } from '../live.js';
import { navigateTo, onPopState, settle } from '../navigation.js';
import { getState, setState, useApp, type State } from '../store.js';
import { Dialogs } from './dialogs.js';
import { Num } from './parts.js';
import { NotFound, RequestsScreen, TasksScreen, TriageScreen } from './screens.js';

const ACTOR_KEY = 'promptside.actor';

function Header({ state }: { state: State }): JSX.Element {
  const days = state.production?.days_to_opening ?? 0;
  const blocked = state.blockedDisplay ?? state.snapshot?.blocked ?? 0;
  const finalBlocked = state.snapshot?.blocked ?? 0;
  return (
    <header className="banner">
      <div className="banner-title">
        <h1>{SHOW_TITLE}</h1>
        <p className="theatre">{THEATRE_NAME}</p>
      </div>
      <p className="countdown">{ui.countdown(days)}</p>
      <a
        className="blocked-link"
        href="/tasks?blocked=1"
        aria-label={`${finalBlocked} blocked`}
        onClick={(event) => {
          event.preventDefault();
          navigateTo('/tasks', { blocked: true, dept: null });
        }}
      >
        <Num>{blocked}</Num> blocked
      </a>
    </header>
  );
}

function openCount(state: State, department: string): number {
  let count = 0;
  for (const task of state.tasks.values()) {
    if (task.department === department && isOpenStatus(task.status)) count += 1;
  }
  return count;
}

export function Rail({ state }: { state: State }): JSX.Element {
  const go = (path: string, dept: string | null): void => {
    navigateTo(path, dept === null ? { dept: null } : { dept: dept as never });
    if (state.dialog.kind === 'drawer') setState({ dialog: { kind: 'none' } });
  };
  const link = (
    path: string,
    dept: string | null,
    href: string,
    children: JSX.Element | string,
    key: string,
  ): JSX.Element => (
    <a
      key={key}
      href={href}
      className="rail-link"
      aria-current={state.address.path === path && (state.address.dept ?? null) === dept ? 'page' : undefined}
      onClick={(event) => {
        event.preventDefault();
        go(path, dept);
      }}
    >
      {children}
    </a>
  );

  return (
    <nav className="rail" aria-label="Departments">
      {link('/tasks', null, '/tasks', 'All tasks', 'all')}
      {link(
        '/triage',
        null,
        '/triage',
        (
          <>
            Triage <Num>{state.snapshot?.triage ?? 0}</Num>
          </>
        ),
        'triage',
      )}
      {link('/requests', null, '/requests', 'Requests', 'requests')}
      <div className="rail-departments">
        {DEPARTMENTS.map((department) =>
          link(
            '/tasks',
            department.key,
            `/tasks?dept=${department.key}`,
            (
              <>
                <span className={`tape tape-${department.key}`}>{department.name}</span>
                <Num>{openCount(state, department.key)}</Num>
              </>
            ),
            department.key,
          ),
        )}
      </div>
      <div className="rail-cycles">
        {(state.snapshot?.cycles ?? []).map((cycle) => (
          <div className="cycle" key={cycle.key}>
            <span className="cycle-name">{CYCLE_NAMES[cycle.key]}</span>
            <div
              className="progress"
              role="progressbar"
              aria-label={`${CYCLE_NAMES[cycle.key]} progress`}
              aria-valuenow={cycle.done}
              aria-valuemin={0}
              aria-valuemax={cycle.total}
            >
              <span
                className="progress-fill"
                style={{
                  width: `${cycle.total === 0 ? 0 : Math.round((cycle.done / cycle.total) * 100)}%`,
                  transitionDelay: state.cascading ? '300ms' : '0ms',
                }}
              />
            </div>
            <span className="cycle-text">
              <Num>{cycle.done}</Num> of <Num>{cycle.total}</Num> done
            </span>
          </div>
        ))}
      </div>
      <label className="working-as">
        Working as
        <select value={state.actor} onChange={(event) => chooseActor(event.target.value)}>
          {CREW.map((member) => (
            <option key={member.handle} value={member.handle}>
              {member.name}
            </option>
          ))}
        </select>
      </label>
    </nav>
  );
}

function currentActorHandle(): string {
  return window.localStorage.getItem(ACTOR_KEY) ?? 'maya';
}

function chooseActor(handle: string): void {
  window.localStorage.setItem(ACTOR_KEY, handle);
  setActor(handle);
  setState({ actor: handle });
}

function Notices({ state }: { state: State }): JSX.Element {
  return (
    <div className="notices" role="status" aria-label="Notices">
      {state.notice}
    </div>
  );
}

function ServiceStatus({ state }: { state: State }): JSX.Element {
  return (
    <section className="service-status" aria-label="Service status">
      {state.status.intake === 'down' ? (
        <div role="alert" className="outage">
          {ui.intakeDown}
        </div>
      ) : null}
      {state.status.plot_storage === 'down' ? (
        <div role="alert" className="outage">
          {ui.storageDown}
        </div>
      ) : null}
    </section>
  );
}

function Drawer({ state }: { state: State }): JSX.Element | null {
  if (state.dialog.kind !== 'drawer') return null;
  return (
    <div className="scrim drawer-scrim" onMouseDown={() => setState({ dialog: { kind: 'none' } })}>
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Departments"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setState({ dialog: { kind: 'none' } });
        }}
      >
        <Rail state={state} />
      </div>
    </div>
  );
}

export function App(): JSX.Element {
  const state = useApp();

  useEffect(() => {
    const handle = currentActorHandle();
    setActor(handle);
    setState({ actor: handle });
    void loadAll().then(() => {
      settle();
      void loadDetail(getState().address.task);
    });
    startLiveUpdates();
    const onKey = (event: KeyboardEvent): void => handleKeyDown(event);
    const onResize = (): void => setState({ width: window.innerWidth });
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = (): void => setState({ reducedMotion: motion.matches });
    window.addEventListener('keydown', onKey);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('resize', onResize);
    motion.addEventListener('change', onMotion);
    const countdown = window.setInterval(() => {
      void api.production().then((production) => setState({ production }));
    }, 60_000);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('resize', onResize);
      motion.removeEventListener('change', onMotion);
      window.clearInterval(countdown);
    };
  }, []);

  useEffect(() => {
    if (state.address.path === '/requests') void loadRequests();
  }, [state.address.path, state.status.intake]);

  useEffect(() => {
    settle();
  }, [state.tasks, state.address]);

  const known = SCREEN_PATHS.includes(state.address.path as never);
  const phone = state.width < 768;

  return (
    <div className={`app ${phone ? 'phone' : ''}`}>
      <Header state={state} />
      <ServiceStatus state={state} />
      <div className="layout">
        {phone ? (
          <button
            type="button"
            className="departments-button"
            onClick={() => setState({ dialog: { kind: 'drawer' } })}
          >
            Departments
          </button>
        ) : (
          <Rail state={state} />
        )}
        <main className="screen">
          {!known ? (
            <NotFound />
          ) : state.address.path === '/triage' ? (
            <TriageScreen state={state} />
          ) : state.address.path === '/requests' ? (
            <RequestsScreen state={state} />
          ) : (
            <TasksScreen state={state} />
          )}
        </main>
      </div>
      <Notices state={state} />
      <Drawer state={state} />
      <Dialogs state={state} />
    </div>
  );
}
