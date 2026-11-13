import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Task, TaskType } from '../shared/types.js';
import { ApiFailure } from './api.js';
import { Board, LIST_ORDER, LIST_TITLES, type FocusRequest, type ListKey } from './components/Board.js';
import { Dialog } from './components/Dialog.js';
import { ImportDialog } from './components/ImportDialog.js';
import { NoticeDialog } from './components/Notices.js';
import { PartyRail } from './components/PartyRail.js';
import { PlayerBar } from './components/PlayerBar.js';
import { TaskDialog } from './components/TaskDialog.js';
import { History } from './pages/History.js';
import { Imports } from './pages/Imports.js';
import { Landing } from './pages/Landing.js';
import { NotFound, QuestDetail } from './pages/QuestDetail.js';
import { Settings } from './pages/Settings.js';
import { SignIn } from './pages/SignIn.js';
import { navigate, usePath } from './router.js';
import { closeNotice, connectLive, loadEverything, useAppState } from './store.js';

type Width = 'phone' | 'tablet' | 'desktop';

function measure(): Width {
  if (window.innerWidth < 768) return 'phone';
  if (window.innerWidth < 1280) return 'tablet';
  return 'desktop';
}

function useWidth(): Width {
  const [width, setWidth] = useState<Width>(measure());
  useEffect(() => {
    const update = (): void => setWidth(measure());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return width;
}

function listKeyOf(type: TaskType): ListKey {
  if (type === 'habit') return 'habits';
  if (type === 'daily') return 'dailies';
  if (type === 'todo') return 'todos';
  return 'rewards';
}

function Shell({ feed, alert, children }: { feed: string[]; alert: string | null; children: ReactNode }): JSX.Element {
  return (
    <div className="shell">
      {alert ? (
        <div role="alert" className="alert-strip">
          {alert}
        </div>
      ) : null}
      {children}
      <div role="status" aria-label="Game feed" className="game-feed">
        {feed.map((line, index) => (
          <div key={`${index}-${line}`}>{line}</div>
        ))}
      </div>
    </div>
  );
}

type DialogState =
  | { kind: 'none' }
  | { kind: 'new'; type: TaskType; opener: HTMLElement | null }
  | { kind: 'edit'; task: Task; opener: HTMLElement | null }
  | { kind: 'import'; opener: HTMLElement | null }
  | { kind: 'party'; opener: HTMLElement | null };

function App(): JSX.Element {
  const state = useAppState();
  const path = usePath();
  const width = useWidth();
  const [signedOut, setSignedOut] = useState(false);
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [tab, setTab] = useState<ListKey>('habits');
  const focusHandled = useRef(false);
  const clearFocusRequest = useCallback(() => setFocusRequest(null), []);
  const signedIn = state.player !== null;

  useEffect(() => {
    void loadEverything()
      .then(() => connectLive())
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && error.status === 401) setSignedOut(true);
      });
  }, []);

  useEffect(() => {
    if (signedIn && (path === '/' || path === '/signin')) navigate('/board');
    if (!signedIn && signedOut && path !== '/' && path !== '/signin') navigate('/');
  }, [signedIn, signedOut, path]);

  if (!signedIn) {
    const page = path === '/signin' ? <SignIn /> : signedOut ? <Landing /> : <main className="loading" />;
    return (
      <Shell feed={state.feed} alert={state.alert}>
        {page}
      </Shell>
    );
  }

  const player = state.player;
  if (!player) return <Shell feed={state.feed} alert={state.alert} children={<main className="loading" />} />;

  const openNew = (type: TaskType, opener: HTMLElement | null): void => {
    focusHandled.current = false;
    setDialog({ kind: 'new', type, opener });
  };
  const openEdit = (task: Task, opener: HTMLElement | null): void => {
    focusHandled.current = false;
    setDialog({ kind: 'edit', task, opener });
  };
  const closeDialog = (): void => setDialog({ kind: 'none' });

  const rail = (
    <PartyRail
      player={player}
      party={state.party}
      quest={state.quest}
      invites={state.invites}
      chat={state.chat}
      fixtures={state.fixtures}
    />
  );

  const board = (
    <>
      {width === 'phone' ? (
        <div className="tab-bar" role="tablist" aria-label="Lists">
          {LIST_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              tabIndex={tab === key ? 0 : -1}
              className={tab === key ? 'tab tab-on' : 'tab'}
              onClick={() => setTab(key)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                const step = event.key === 'ArrowRight' ? 1 : -1;
                const place = (LIST_ORDER.indexOf(key) + step + LIST_ORDER.length) % LIST_ORDER.length;
                const next = LIST_ORDER[place];
                if (!next) return;
                setTab(next);
                const buttons = event.currentTarget.parentElement?.children;
                const target = buttons?.[place];
                if (target instanceof HTMLElement) target.focus();
              }}
            >
              {LIST_TITLES[key]}
            </button>
          ))}
        </div>
      ) : null}
      <div className={`board board-${width}`}>
        <Board
          tasks={state.tasks}
          visibleLists={width === 'phone' ? [tab] : LIST_ORDER}
          focusRequest={focusRequest}
          onFocusHandled={clearFocusRequest}
          onNewTask={openNew}
          onEditTask={openEdit}
        />
        {width === 'desktop' ? rail : null}
      </div>
      {width !== 'desktop' ? (
        <button
          type="button"
          className="party-open"
          onClick={(event) => setDialog({ kind: 'party', opener: event.currentTarget })}
        >
          Party
        </button>
      ) : null}
    </>
  );

  let page: JSX.Element = board;
  if (path === '/settings') page = <Settings player={player} />;
  else if (path === '/imports') page = <Imports />;
  else if (path === '/history') page = <History player={player} />;
  else if (path.startsWith('/quests/')) {
    const questId = path.slice('/quests/'.length);
    page = questId === '' ? <NotFound /> : <QuestDetail questId={questId} />;
  }

  return (
    <Shell feed={state.feed} alert={state.alert}>
      <PlayerBar player={player} onImport={(opener) => setDialog({ kind: 'import', opener })} />
      {page}
      {dialog.kind === 'new' ? (
        <TaskDialog
          task={null}
          startType={dialog.type}
          opener={dialog.opener}
          focusHandled={focusHandled}
          onClose={closeDialog}
          onCreated={(task) => {
            focusHandled.current = true;
            closeDialog();
            setFocusRequest({ kind: 'task', id: task.id });
          }}
          onDeleted={closeDialog}
        />
      ) : null}
      {dialog.kind === 'edit' ? (
        <TaskDialog
          task={dialog.task}
          startType={dialog.task.type}
          opener={dialog.opener}
          focusHandled={focusHandled}
          onClose={closeDialog}
          onCreated={closeDialog}
          onDeleted={() => {
            focusHandled.current = true;
            const list = listKeyOf(dialog.task.type);
            const index = dialog.task.position - 1;
            closeDialog();
            setFocusRequest({ kind: 'place', list, index });
          }}
        />
      ) : null}
      {dialog.kind === 'import' ? <ImportDialog onClose={closeDialog} /> : null}
      {dialog.kind === 'party' ? (
        <Dialog name="Party" onClose={closeDialog}>
          {rail}
          <div className="dialog-actions">
            <button type="button" onClick={closeDialog}>
              Cancel
            </button>
          </div>
        </Dialog>
      ) : null}
      {state.notice ? <NoticeDialog notice={state.notice} onClose={closeNotice} /> : null}
    </Shell>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
