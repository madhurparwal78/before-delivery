import { useEffect, useMemo, useRef, useState } from 'react';
import type { LayoutContent, LayoutVersionDetail } from '../shared/protocol.js';
import { BottomEdge } from './components/BottomEdge.js';
import { ConflictSheet, DeadlockSheet, PieceInspector } from './components/Dialogs.js';
import { LoadingScreen } from './components/LoadingScreen.js';
import { RouteChoiceProvider } from './components/RouteChoice.js';
import { BlockSchematic, RightRail, RoutePanel } from './components/RightRail.js';
import { SessionBar } from './components/SessionBar.js';
import { Sheet } from './components/Sheets.js';
import { SignIn, SignInAgain } from './components/SignIn.js';
import { StageItems } from './components/StageItems.js';
import { Walkthrough } from './components/Walkthrough.js';
import { api, layoutPath } from './lib/api.js';
import { writeView } from './lib/viewState.js';
import { Stage } from './stage/Stage.js';
import { StoreProvider, useStore } from './store.js';

function Shell(): JSX.Element {
  const store = useStore();
  const { phase, view, layout, session, status, error, outage, me, actions } = store;
  const [sceneProgress, setSceneProgress] = useState(0);
  const [fading, setFading] = useState(false);
  const [showLoading, setShowLoading] = useState(true);
  const [pinned, setPinned] = useState<LayoutContent | null>(null);
  const [phoneSchematic, setPhoneSchematic] = useState(false);
  const pinnedFor = useRef<string | null>(null);

  const progress = Math.min(100, sceneProgress * 0.5 + store.snapshotProgress * 0.5);

  useEffect(() => {
    if (fading || phase === 'booting') return;
    if (phase === 'ready' && progress < 100) return;
    setFading(true);
    const timer = window.setTimeout(() => setShowLoading(false), 700);
    return () => window.clearTimeout(timer);
  }, [phase, progress, fading]);

  /** Operate mode draws the pinned version's track, never the shared working copy. */
  useEffect(() => {
    if (!session || !view.workspace) {
      setPinned(null);
      pinnedFor.current = null;
      return;
    }
    if (pinnedFor.current === session.layout_version_id) return;
    pinnedFor.current = session.layout_version_id;
    void api
      .get<LayoutVersionDetail>(
        `${layoutPath(view.workspace, session.layout_id)}/versions/${session.layout_version_id}`,
      )
      .then((version) => setPinned(version.content))
      .catch(() => setPinned(null));
  }, [session, view.workspace]);

  const content = useMemo<LayoutContent | null>(
    () => (view.mode === 'operate' && pinned ? pinned : layout?.content ?? null),
    [view.mode, pinned, layout],
  );

  useEffect(() => {
    if (view.mode !== 'operate' || view.session) return;
    if (view.sheet === 'sessions') return;
    writeView({ sheet: 'sessions' });
    void actions.refreshSheet('sessions');
  }, [view.mode, view.sheet, view.session, actions]);

  const walkthroughOpen = phase === 'ready' && me !== null && !me.user.walkthrough_done;
  const sheetName = view.sheet;

  const railVisible = phase === 'ready' && view.mode === 'operate' && session !== null;

  return (
    <div className={railVisible ? 'shell with-rail' : 'shell'}>
      {content ? (
        <Stage content={content} onSceneProgress={setSceneProgress} />
      ) : (
        <div className="stage-host bare-ground" />
      )}
      {walkthroughOpen ? <div className="stage-scrim" /> : null}
      {phase === 'signed-out' ? <SignIn /> : null}

      {/* Tab order follows the stage: items list, bottom edge, then the session bar. */}
      {phase === 'ready' ? (
        <>
          {view.mode === 'build' ? <StageItems /> : null}
          {view.mode === 'operate' && session ? <RightRail /> : null}
          <BottomEdge onOpenSchematic={() => setPhoneSchematic(true)} />
          <SessionBar />
          {phoneSchematic && session ? (
            <div className="sheet-backdrop">
              <div role="dialog" aria-label="Schematic" className="sheet">
                <div className="sheet-head">
                  <h2>Schematic</h2>
                  <button className="mini" onClick={() => setPhoneSchematic(false)}>
                    Close
                  </button>
                </div>
                <div className="sheet-body">
                  <RoutePanel />
                  <BlockSchematic />
                </div>
              </div>
            </div>
          ) : null}

          {sheetName === 'conflict' ? <ConflictSheet /> : null}
          {sheetName === 'deadlock' ? <DeadlockSheet /> : null}
          {sheetName === 'piece-inspector' ? <PieceInspector /> : null}
          {sheetName && !['conflict', 'deadlock', 'piece-inspector'].includes(sheetName) ? (
            <Sheet name={sheetName} />
          ) : null}

          {outage ? (
            <div data-testid="outage-banner" role="alert" className="outage-banner">
              {outage}
            </div>
          ) : null}
          {error ? (
            <div data-testid="error-sheet" role="alert" className="error-sheet">
              <span>{error}</span>
              <button className="mini" onClick={actions.dismissError}>
                Dismiss
              </button>
            </div>
          ) : null}
          <div
            role="status"
            aria-label="Gandyboard status"
            aria-live="polite"
            data-testid="status-region"
            className="status-region"
          >
            {status}
          </div>
          {walkthroughOpen ? <Walkthrough /> : null}
          {store.signInAgain ? <SignInAgain /> : null}
        </>
      ) : null}

      {showLoading ? <LoadingScreen progress={progress} fading={fading} /> : null}
    </div>
  );
}

export function App(): JSX.Element {
  return (
    <StoreProvider>
      <RouteChoiceProvider>
        <Shell />
      </RouteChoiceProvider>
    </StoreProvider>
  );
}
