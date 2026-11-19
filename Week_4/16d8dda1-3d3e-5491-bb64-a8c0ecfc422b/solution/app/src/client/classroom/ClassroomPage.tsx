import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isLiveState } from '../../shared/states';
import type { SessionSnapshot } from '../../shared/wire';
import { Alert, NotFound, Skeleton } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { BreakoutPanel } from './BreakoutPanel';
import { ChatPanel } from './ChatPanel';
import { ClassroomContext, type ClassroomView } from './context';
import { NewPollDialog, StartBreakoutsDialog } from './dialogs';
import { EndedNotice } from './EndedNotice';
import { HandsPanel } from './HandsPanel';
import { useClassroomKeys } from './keyboard';
import { useLayoutMode, useReducedMotion, type LayoutMode } from './motion';
import { PhoneTabs, type TabId } from './PhoneTabs';
import { PollPanel } from './PollPanel';
import { ClassroomRegion } from './Region';
import { Sheet } from './Sheet';
import { ClassroomStore, type ClassroomState } from './store';
import { TeacherBar } from './TeacherBar';

const TICK_MS = 250;

/** performance.now(), refreshed while something counts down (a breakout, or the Bell Return walks). */
function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return;
    setNow(performance.now());
    const timer = window.setInterval(() => setNow(performance.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

export function ClassroomPage({ sessionId }: { sessionId: string }) {
  return <Classroom key={sessionId} sessionId={sessionId} />;
}

function Classroom({ sessionId }: { sessionId: string }) {
  const [store] = useState(() => new ClassroomStore(sessionId));
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.get);
  const mode = useLayoutMode();
  const reduced = useReducedMotion();
  const now = useTicker(state.snapshot?.breakout != null || state.returningUntil > performance.now());

  if (state.phase === 'missing') return <NotFound />;
  if (state.phase === 'failed') {
    return (
      <main className="page">
        <Alert>{state.failure}</Alert>
      </main>
    );
  }
  if (!state.snapshot) {
    return (
      <main className="page">
        <Skeleton rows={4} label="Loading the classroom" />
      </main>
    );
  }
  return <Ready store={store} state={state} snapshot={state.snapshot} mode={mode} reduced={reduced} now={now} />;
}

interface ReadyProps {
  store: ClassroomStore;
  state: ClassroomState;
  snapshot: SessionSnapshot;
  mode: LayoutMode;
  reduced: boolean;
  now: number;
}

function Ready({ store, state, snapshot, mode, reduced, now }: ReadyProps) {
  const root = useRef<HTMLElement>(null);
  const chatInput = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [tab, setTab] = useState<TabId>('seats');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dialog, setDialog] = useState<'poll' | 'breakouts' | null>(null);
  const [chatRequest, setChatRequest] = useState(0);

  const openChat = () => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (mode === 'phone') setTab('chat');
    if (mode === 'tablet') setSheetOpen(true);
    setChatRequest((count) => count + 1);
  };
  useLayoutEffect(() => {
    if (chatRequest > 0) chatInput.current?.focus();
  }, [chatRequest]);
  useClassroomKeys(store, root, openChat);

  const view: ClassroomView = {
    store,
    state,
    snapshot,
    now,
    reduced,
    mode,
    isOwner: snapshot.you.role === 'teacher',
    canRun: snapshot.you.role !== 'learner',
    openDialog: (kind) => {
      setSheetOpen(false);
      setDialog(kind);
    },
  };
  const live = isLiveState(snapshot.state);
  const closeDialog = () => setDialog(null);

  const head = (
    <header className="classroom-head" data-modal-inert="">
      <h1>{snapshot.classTitle}</h1>
      {live && <span className="live-marker">Live</span>}
    </header>
  );
  const bar = (
    <div className="bar-slot" data-modal-inert="">
      <TeacherBar />
      <EndedNotice />
    </div>
  );
  const panels = (
    <>
      <HandsPanel />
      <PollPanel />
      <BreakoutPanel />
      <ChatPanel inputRef={chatInput} returnFocus={returnFocus} />
    </>
  );

  return (
    <ClassroomContext.Provider value={view}>
      <main className={`classroom classroom-${mode}`} ref={root}>
        {head}
        {mode === 'phone' && (
          <>
            <ClassroomRegion />
            {bar}
            <BreakoutPanel phone />
            <PhoneTabs tab={tab} onSelect={setTab} chatInput={chatInput} returnFocus={returnFocus} />
          </>
        )}
        {mode === 'tablet' && (
          <>
            {bar}
            <ClassroomRegion />
            <footer className="panel-bar">
              <button type="button" className="primary" data-native-enter="" onClick={() => setSheetOpen(true)}>
                <Icon name="slides" size={18} />
                Class panel
              </button>
            </footer>
            {sheetOpen && <Sheet onClosed={() => setSheetOpen(false)}>{panels}</Sheet>}
          </>
        )}
        {mode === 'desktop' && (
          <>
            {bar}
            <ClassroomRegion />
            <aside className="rail">{panels}</aside>
          </>
        )}
      </main>
      {dialog === 'poll' && <NewPollDialog sessionId={snapshot.id} onClose={closeDialog} />}
      {dialog === 'breakouts' && <StartBreakoutsDialog sessionId={snapshot.id} tableCount={snapshot.tables.length} onClose={closeDialog} />}
    </ClassroomContext.Provider>
  );
}
