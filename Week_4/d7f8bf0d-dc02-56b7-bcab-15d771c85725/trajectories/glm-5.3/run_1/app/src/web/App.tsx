import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Wordmark } from './Wordmark';
import { api, get, ApiFailure, newKey, setSignInAgainHandler, flushQueued } from './apiClient';
import { useViewUrl } from './useViewUrl';
import { useStore, useEventStream } from './store/store';
import type { Me, SessionEventData, LayoutEventData } from './store/types';
import { createStage, type StageHandle } from './stage';
import { SessionBar } from './SessionBar';
import { StageOverlays } from './StageOverlays';
import { SignInSheet, SignInAgainDialog } from './SignInSheet';
import { WalkthroughCard } from './WalkthroughCard';
import { ErrorSheet } from './ErrorSheet';

export function App(): React.ReactElement {
  const [url, setUrl] = useViewUrl();
  const store = useStore(url);
  const { state } = store;
  const [booting, setBooting] = useState(true);
  const [bootProgress, setBootProgress] = useState(0);
  const [signInAgainOpen, setSignInAgainOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stageRef = useRef<StageHandle | null>(null);
  const stageElRef = useRef<HTMLDivElement | null>(null);
  const [webglAvailable, setWebglAvailable] = useState(true);
  const [sceneMode, setSceneMode] = useState<'build' | 'operate' | 'paused'>('build');
  const reducedMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  const statusRegionRef = useRef<HTMLDivElement | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const announce = useCallback((message: string) => {
    setStatusMessage(message);
    if (statusRegionRef.current) {
      statusRegionRef.current.textContent = '';
      requestAnimationFrame(() => {
        if (statusRegionRef.current) statusRegionRef.current.textContent = message;
      });
    }
  }, []);

  const [lastAnnounce, setLastAnnounce] = useState<{ message: string; actionId: string } | null>(null);
  const announceFor = useCallback((actionId: string, message: string) => {
    announce(message);
    setLastAnnounce({ message, actionId });
  }, [announce]);

  // ---------- boot: the first load of me, workspace and layout ----------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setBootProgress(10);
        const me = await get<Me>('/api/me');
        if (cancelled) return;
        store.setMe(me);
        setBootProgress(45);
        const firstWorkspace = me.memberships[0]?.workspace_id ?? null;
        if (firstWorkspace) {
          const layouts = await get<{ layouts: { id: string }[] }>(`/api/workspaces/${firstWorkspace}/layouts`);
          const firstLayout = layouts.layouts[0]?.id ?? null;
          if (firstLayout) {
            await store.loadLayout(firstWorkspace, firstLayout);
            setBootProgress(80);
          }
        }
        setBootProgress(100);
        await new Promise((r) => setTimeout(r, 350));
        if (!cancelled) {
          setBooting(false);
          store.markLoaded();
        }
      } catch {
        if (!cancelled) {
          setBootProgress(100);
          setBooting(false);
          store.markLoaded();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After a manual sign-in on the sign-in sheet, load the first workspace and layout.
  useEffect(() => {
    if (!state.me || !state.me.user.id) return;
    const wantedWorkspace = url.workspace ?? state.me.memberships[0]?.workspace_id ?? null;
    if (!wantedWorkspace) return;
    const wantedLayout = url.layout;
    if (wantedLayout) {
      void store.loadLayout(wantedWorkspace, wantedLayout).catch(() => undefined);
      return;
    }
    void (async () => {
      try {
        const layouts = await get<{ layouts: { id: string }[] }>(`/api/workspaces/${wantedWorkspace}/layouts`);
        const firstLayout = layouts.layouts[0]?.id;
        if (firstLayout) await store.loadLayout(wantedWorkspace, firstLayout);
      } catch {
        // signed out mid-flight
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.me?.user.id]);

  // ---------- periodic status probe ----------
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      if (cancelled) return;
      try {
        const status = await get<{ valkey: 'up' | 'down'; gotenberg: 'up' | 'down'; instance: string }>('/api/status');
        store.setStatus(status);
      } catch {
        // ignore while signed out
      }
    };
    void probe();
    const timer = setInterval(probe, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.me?.user.id]);

  // ---------- sign-in again wiring ----------
  const resolveSignIn = useRef<((value: void) => void) | null>(null);
  useEffect(() => {
    setSignInAgainHandler(async () => {
      setSignInAgainOpen(true);
      return new Promise<void>((resolve) => {
        resolveSignIn.current = resolve;
      });
    });
    return () => setSignInAgainHandler(null);
  }, []);

  const handleSignInAgain = useCallback(async (password: string) => {
    try {
      await api('POST', '/api/auth/sign-in', { email: state.me?.user.email ?? '', password });
      setSignInAgainOpen(false);
      resolveSignIn.current?.();
      resolveSignIn.current = null;
      flushQueued();
      announce('Signed in.');
      return true;
    } catch {
      announce('That email and password do not match.');
      return false;
    }
  }, [announce, state.me?.user.email]);

  // ---------- stage ----------
  const stageReady = !booting && bootProgress >= 100 && webglAvailable;
  useEffect(() => {
    if (!stageReady) return;
    if (!stageElRef.current) return;
    if (stageRef.current) return;
    try {
      stageRef.current = createStage(stageElRef.current, reducedMotion);
    } catch {
      setWebglAvailable(false);
      return;
    }
    if (state.layout) {
      stageRef.current.buildFromLayout(state.layout.content);
    }
    return () => {
      stageRef.current?.dispose();
      stageRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageReady, reducedMotion]);

  useEffect(() => {
    if (stageRef.current && state.layout) {
      stageRef.current.buildFromLayout(state.layout.content);
    }
  }, [state.layout?.working_hash, state.layout?.revision]);

  // Watch for WebGL context loss while the app runs.
  const [contextLost, setContextLost] = useState(false);

  useEffect(() => {
    if (!stageRef.current) return;
    stageRef.current.updateSession(url.mode === 'operate' ? state.session : null, () => null);
    const nextMode: 'build' | 'operate' | 'paused' = stageRef.current.isLost() || contextLost ? 'paused' : url.mode === 'operate' ? 'operate' : 'build';
    setSceneMode(nextMode);
  }, [state.session?.revision, url.mode, contextLost]);

  useEffect(() => {
    const canvas = stageElRef.current?.querySelector('canvas');
    if (!canvas) return;
    const onLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onRestored = () => {
      setContextLost(false);
      if (state.layout) stageRef.current?.buildFromLayout(state.layout.content);
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageReady]);

  // The on-screen point of each block's track centre for the current camera.
  const blockPoints = useMemo(() => {
    const stage = stageRef.current;
    if (!stage || !state.layout) return '{}';
    const points: Record<string, [number, number]> = {};
    for (const b of state.layout.content.blocks) {
      const point = stage.blockScreenPoint(state.layout.content, b.id);
      if (point) points[String(b.number)] = [Math.round(point.x), Math.round(point.y)];
    }
    return JSON.stringify(points);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.layout?.working_hash, url.heading, sceneMode, state.session?.revision]);

  // The ribbon shows the granted blocks of the selected train's authority, from committed state.
  const ribbonBlocks = useMemo(() => {
    if (url.mode !== 'operate' || !state.session) return '';
    const train = state.session.trains.find((t) => t.id === url.train);
    if (!train?.authority_id) return '';
    const authority = state.session.authorities.find((a) => a.id === train.authority_id && a.state === 'Granted');
    if (!authority) return '';
    const numbers = authority.remaining_block_ids
      .map((id) => state.session?.blocks.find((b) => b.id === id)?.number)
      .filter((n): n is number => n !== undefined);
    return numbers.join(',');
  }, [url.mode, url.train, state.session]);

  const limitFlagBlock = useMemo(() => {
    if (url.mode !== 'operate' || !state.session) return '';
    const train = state.session.trains.find((t) => t.id === url.train);
    if (!train?.authority_id) return '';
    const authority = state.session.authorities.find((a) => a.id === train.authority_id && a.state === 'Granted');
    if (!authority) return '';
    const number = state.session.blocks.find((b) => b.id === authority.limit_block_id)?.number;
    return number !== undefined ? String(number) : '';
  }, [url.mode, url.train, state.session]);

  useEffect(() => {
    if (stageRef.current && url.heading !== null) {
      stageRef.current.setCamera(url.heading, stageRef.current.controls.zoom, stageRef.current.controls.panX, stageRef.current.controls.panY);
    }
  }, [url.heading, stageReady]);

  // ---------- stage keyboard: arrows pan, Q/E rotate, plus/minus zoom ----------
  const [cameraState, setCameraState] = useState({ panX: 0, panY: 0, zoom: 1 });
  useEffect(() => {
    const stageEl = stageElRef.current;
    if (!stageEl) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const controls = stageRef.current?.controls;
      if (!controls) return;
      let handled = true;
      switch (e.key) {
        case 'ArrowLeft': controls.panBy(-40, 0); break;
        case 'ArrowRight': controls.panBy(40, 0); break;
        case 'ArrowUp': controls.panBy(0, -40); break;
        case 'ArrowDown': controls.panBy(0, 40); break;
        case 'q': case 'Q': controls.rotate(-45); setUrl({ heading: controls.heading }); break;
        case 'e': case 'E': controls.rotate(45); setUrl({ heading: controls.heading }); break;
        case '+': case '=': controls.zoomBy(1.2); break;
        case '-': controls.zoomBy(1 / 1.2); break;
        default: handled = false; break;
      }
      if (handled) {
        e.preventDefault();
        setCameraState({ panX: controls.panX, panY: controls.panY, zoom: controls.zoom });
      }
    };
    stageEl.addEventListener('keydown', onKeyDown);
    return () => stageEl.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageReady]);

  // ---------- touch and mouse camera control ----------
  useEffect(() => {
    const canvas = stageElRef.current?.querySelector('canvas');
    if (!canvas) return;
    const controls = () => stageRef.current?.controls;

    let mouseDragging = false;
    let lastX = 0;
    let lastY = 0;
    let mouseButton = 0;

    const onMouseDown = (e: MouseEvent) => {
      mouseDragging = true;
      mouseButton = e.button;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!mouseDragging) return;
      const c = controls();
      if (!c) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (mouseButton === 2) {
        c.rotate(dx * 0.3);
        setUrl({ heading: c.heading });
      } else {
        c.panBy(dx, dy);
      }
      setCameraState({ panX: c.panX, panY: c.panY, zoom: c.zoom });
    };
    const onMouseUp = () => {
      mouseDragging = false;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = controls();
      if (!c) return;
      c.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
      setCameraState({ panX: c.panX, panY: c.panY, zoom: c.zoom });
    };
    const onContextMenu = (e: Event) => e.preventDefault();

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);

    // Touch: one finger pans, pinch zooms, two fingers rotate.
    const activeTouches = new Map<number, { x: number; y: number }>();
    let pinchStart = 0;
    let rotateStartAngle = 0;

    const onTouchStart = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
      if (e.touches.length === 2) {
        const a = e.touches[0];
        const b = e.touches[1];
        if (a && b) {
          pinchStart = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          rotateStartAngle = Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX);
        }
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      const c = controls();
      if (!c) return;
      e.preventDefault();
      if (e.touches.length === 1) {
        const t = e.touches[0];
        const prev = t ? activeTouches.get(t.identifier) : undefined;
        if (t && prev) {
          c.panBy(t.clientX - prev.x, t.clientY - prev.y);
          activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
        }
      } else if (e.touches.length === 2) {
        const a = e.touches[0];
        const b = e.touches[1];
        if (a && b) {
          const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          if (pinchStart > 0 && dist > 0) {
            c.zoomBy(dist / pinchStart);
            pinchStart = dist;
          }
          const angle = Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX);
          const delta = (angle - rotateStartAngle) * (180 / Math.PI);
          if (Math.abs(delta) > 10) {
            c.rotate(delta);
            rotateStartAngle = angle;
            setUrl({ heading: c.heading });
          }
        }
      }
      setCameraState({ panX: c.panX, panY: c.panY, zoom: c.zoom });
    };
    const onTouchEnd = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        activeTouches.delete(t.identifier);
      }
      pinchStart = 0;
    };

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    canvas.addEventListener('touchcancel', onTouchEnd);

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageReady]);

  // ---------- event streams ----------
  const workspaceId = url.workspace;
  const layoutStreamPath = state.layout && state.me && workspaceId ? `/api/workspaces/${workspaceId}/layouts/${state.layout.id}/events` : null;
  const sessionStreamPath = state.session && state.me && workspaceId ? `/api/workspaces/${workspaceId}/sessions/${state.session.id}/events` : null;

  useEventStream(
    layoutStreamPath,
    (event) => {
      const data = JSON.parse(event.data) as LayoutEventData;
      store.applyLayoutEvent(data);
      // Content-level detail rides on the event; the safest complete answer is a re-read.
      void store.loadLayout(workspaceId ?? '', state.layout?.id ?? '').catch(() => undefined);
    },
    () => store.setOutage({ valkeyDown: true }),
  );

  useEventStream(
    sessionStreamPath,
    (event) => {
      if (event.type === 'resync') {
        store.requestSessionSnapshot();
        return;
      }
      let data: SessionEventData;
      try {
        data = JSON.parse(event.data) as SessionEventData;
      } catch {
        return;
      }
      store.applySessionEvent(data);
      // Server-raised announcements ride on the tick detail.
      if (data.type === 'tick.committed' && data.detail) {
        const deadlocksRaised = data.detail['deadlocks_raised'] as { train_numbers: string[] }[] | undefined;
        if (deadlocksRaised && deadlocksRaised.length > 0) {
          const numbers = deadlocksRaised.map((d) => d.train_numbers.join(', ')).join(', ');
          announce(`Deadlock: Trains ${numbers} are waiting on each other.`);
          setUrl({ dialog: 'deadlock' });
        }
        const revoked = data.detail['authorities_revoked'] as { ended_reason: string }[] | undefined;
        if (revoked && revoked.length > 0) {
          for (const a of revoked) {
            if (a.ended_reason === 'expired') announce('Authority expired.');
          }
        }
      }
      // A refused Highball opens the Conflict sheet naming the other train.
      if (data.type === 'authority.refused' && data.detail) {
        const conflict = data.detail['conflict'] as { train_id: string } | undefined;
        if (conflict) setUrl({ dialog: 'conflict', train: conflict.train_id });
      }
    },
    () => store.setOutage({ valkeyDown: true }),
  );

  // While the stream is unavailable the browser re-reads the session snapshot every 3 seconds.
  useEffect(() => {
    if (!state.outage.valkeyDown || !sessionStreamPath) return;
    const timer = setInterval(() => {
      void store.requestSessionSnapshot();
    }, 3000);
    return () => clearInterval(timer);
  }, [state.outage.valkeyDown, sessionStreamPath, store]);

  // A page joining a session with an open deadlock or an open conflict for the
  // selected train shows that sheet from the snapshot.
  useEffect(() => {
    if (url.mode !== 'operate' || !state.session) return;
    if (url.dialog) return;
    if (state.session.deadlocks.some((d) => d.state === 'Open')) {
      setUrl({ dialog: 'deadlock' });
      return;
    }
    const train = state.session.trains.find((t) => t.id === url.train);
    if (train && state.session.conflicts.some((c) => c.state === 'Open' && c.train_id === train.id)) {
      setUrl({ dialog: 'conflict' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url.mode, url.train, state.session?.revision]);

  // ---------- open the first workspace and layout ----------
  useEffect(() => {
    if (!state.me) return;
    if (!url.workspace && state.workspaces[0]) {
      setUrl({ workspace: state.workspaces[0].id });
    }
  }, [state.me, state.workspaces, url.workspace, setUrl]);

  useEffect(() => {
    if (!url.workspace || !state.me || !url.layout) return;
    if (!state.layout || state.layout.id !== url.layout) {
      void store.loadLayout(url.workspace, url.layout).catch(() => undefined);
    }
  }, [url.workspace, url.layout, state.me, state.layout, store]);

  // ---------- outage banner copy follows the status ----------
  const [valkeyWasDown, setValkeyWasDown] = useState(false);
  useEffect(() => {
    if (state.outage.valkeyDown) {
      if (!valkeyWasDown) {
        setValkeyWasDown(true);
        announce('Live updates are paused. Sessions are held at their last committed tick.');
      }
    } else if (valkeyWasDown) {
      setValkeyWasDown(false);
      announce('Live updates are back.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.outage.valkeyDown]);

  const loading = booting || bootProgress < 100;

  if (loading) {
    return (
      <div className="loading-screen" role="presentation">
        <Wordmark />
        <div
          className="layout-load-pill"
          role="progressbar"
          aria-label="Loading layout"
          aria-valuenow={Math.round(bootProgress)}
          aria-valuemin={0}
          aria-valuemax={100}
          data-testid="layout-load-pill"
        >
          <div className="track">
            <div className="fill" style={{ width: `${bootProgress}%` }} />
          </div>
        </div>
      </div>
    );
  }

  const signedOut = !state.me;

  return (
    <>
      <div
        className="stage"
        role="application"
        aria-label="Club-hall layout stage"
        data-testid="stage"
        tabIndex={0}
        data-scene-revision={state.sceneRevision}
        data-scene-tick={state.session?.tick ?? 0}
        data-scene-mode={sceneMode}
        data-scene-heading={stageRef.current?.controls.heading ?? url.heading ?? 0}
        data-scene-zoom={cameraState.zoom}
        data-scene-pan={`${cameraState.panX},${cameraState.panY}`}
        data-scene-animating="false"
        data-ribbon-blocks={ribbonBlocks}
        data-preview-blocks=""
        data-limit-flag-block={limitFlagBlock}
        data-block-points={blockPoints}
        ref={stageElRef}
      >
        {webglAvailable ? null : <SchematicFallback session={state.session} />}
        {contextLost ? <div className="stage paused-note">The 3D view is paused. Your session is still running.</div> : null}
      </div>

      {signedOut ? (
        <SignInSheet
          onSignedIn={(me) => {
            store.setMe(me);
            void store.refreshWorkspaces();
          }}
          announce={announce}
        />
      ) : (
        <>
          <SessionBar
            url={url}
            setUrl={setUrl}
            state={state}
            announce={announce}
            setError={setError}
          />
          <StageOverlays
            url={url}
            setUrl={setUrl}
            state={state}
            store={store}
            announce={announce}
            announceFor={announceFor}
            setError={setError}
            stageRef={stageRef}
            reducedMotion={reducedMotion}
            lastAnnounce={lastAnnounce}
          />
          {state.me && !state.me.user.walkthrough_done ? <WalkthroughCard announce={announce} /> : null}
        </>
      )}

      <SignInAgainDialog
        open={signInAgainOpen}
        email={state.me?.user.email ?? ''}
        onSubmit={handleSignInAgain}
        onClose={() => {
          setSignInAgainOpen(false);
          resolveSignIn.current?.();
          resolveSignIn.current = null;
        }}
      />

      <ErrorSheet message={error} onDismiss={() => setError(null)} />

      <div ref={statusRegionRef} className="status-region" role="status" aria-live="polite" data-testid="status-region">
        {statusMessage}
      </div>

      {state.outage.valkeyDown ? (
        <div role="alert" data-testid="outage-banner" className="outage-banner">
          Live updates are paused. Sessions are held at their last committed tick.
        </div>
      ) : null}
    </>
  );
}

function SchematicFallback({ session }: { session: import('./store/types').SessionSnapshot | null }): React.ReactElement {
  const blocks = session?.blocks ?? [];
  return (
    <div
      style={{ position: 'absolute', inset: 0, background: '#fff', padding: 20, overflow: 'auto' }}
      aria-label="Track schematic"
    >
      <h2 style={{ marginTop: 0 }}>Track schematic</h2>
      <p>The 3D view needs WebGL. Every command is still here.</p>
      <table aria-label="Block schematic">
        <tbody>
          {blocks.map((b) => (
            <tr key={b.id} data-testid={`block-row-${b.number}`}>
              <td>{b.number}</td>
              <td>{b.name}</td>
              <td data-testid={`block-state-${b.number}`} className={`state-word ${b.state === 'out_of_service' ? 'out-of-service' : b.state}`}>
                {b.state === 'out_of_service' ? 'Out of service' : b.state === 'occupied' ? 'Occupied' : b.state === 'reserved' ? 'Reserved' : 'Free'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
