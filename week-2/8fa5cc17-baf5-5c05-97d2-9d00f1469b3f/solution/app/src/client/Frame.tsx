// The workspace frame: library rail or drawer, text column, margin pane or sheet, live regions.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { get } from './api.ts';
import { focusables, trapTab } from './Dialog.tsx';
import { COPY, setStorage, useFeedback } from './feedback.ts';
import { useLibrary } from './library.ts';
import { SpringPanel } from './panel.ts';
import { linkHandler, navigate, setRevealHandler, useLocation } from './router.ts';
import { QUIRE_CURVE_CSS, reducedMotion } from './motion.ts';
import { FADE_MS, REVEAL_MS } from '../shared/motion.ts';
import { useSyncStatus } from './sync.ts';
import { Palette } from './Palette.tsx';
import { NewTypeDialog } from './NewTypeDialog.tsx';
import { dateHeading } from '../shared/time.ts';
import './styles/settings.css';

export type Layout = 'laptop' | 'tablet' | 'phone';
const laptopQuery = window.matchMedia('(min-width: 1200px)');
const tabletQuery = window.matchMedia('(min-width: 768px)');
const layoutNow = (): Layout => (laptopQuery.matches ? 'laptop' : tabletQuery.matches ? 'tablet' : 'phone');

export function useLayout(): Layout {
  return useSyncExternalStore((fn) => {
    laptopQuery.addEventListener('change', fn);
    tabletQuery.addEventListener('change', fn);
    return () => {
      laptopQuery.removeEventListener('change', fn);
      tabletQuery.removeEventListener('change', fn);
    };
  }, layoutNow);
}

const STORAGE_POLL_MS = 10_000;

interface FrameApi {
  layout: Layout;
  marginNode: HTMLElement | null;
  /** Opens the phone margin sheet; resolves once it is open. */
  openMargin: () => Promise<void>;
  openNewType: () => void;
  /** Rechecks storage now (after a 503) and keeps polling while it is down. */
  storageFailed: () => void;
  setTopTitle: (title: string) => void;
}

const FrameContext = createContext<FrameApi | null>(null);

export function useFrame(): FrameApi {
  const api = useContext(FrameContext);
  if (!api) throw new Error('outside the frame');
  return api;
}

/** Renders its children into the margin (pane at 1280 and 768, bottom sheet at 375). */
export function Margin({ children }: { children: ReactNode }) {
  const { marginNode } = useFrame();
  return marginNode ? createPortal(children, marginNode) : null;
}

const Icon = ({ d }: { d: string[] }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{d.map((p) => <path key={p} d={p} />)}</svg>
);
const MENU = ['M4 6h16', 'M4 12h16', 'M4 18h16'];
const PANEL_BOTTOM = ['M3 5h18v14H3z', 'M3 14h18', 'M9 17.5l3-2 3 2'];

function Rail({ onNewType, onNavigate }: { onNewType: () => void; onNavigate: () => void }) {
  const lib = useLibrary();
  const { path } = useLocation();
  const go = (to: string, reveal = false) => (e: React.MouseEvent) => {
    linkHandler(to, { reveal })(e);
    onNavigate();
  };
  const current = (to: string) => (path === to ? 'page' : undefined);
  return (
    <nav aria-label="Library" className="rail">
      <div className="wordmark" aria-hidden="true">Quire</div>
      <button type="button" className="rail-today" onClick={() => { onNavigate(); if (path !== '/today') navigate('/today', { reveal: true }); }}>Today</button>
      <h2 className="rail-head small-caps">Types</h2>
      <ul>
        {lib.types.map((t) => (
          <li key={t.id}><a href={`/types/${t.id}`} aria-current={current(`/types/${t.id}`)} onClick={go(`/types/${t.id}`)}>{t.name}</a></li>
        ))}
      </ul>
      <button type="button" className="quiet rail-new" onClick={onNewType}>New type</button>
      <h2 className="rail-head small-caps">Collections</h2>
      <ul>
        {lib.collections.map((c) => (
          <li key={c.id}><a href={`/collections/${c.id}`} aria-current={current(`/collections/${c.id}`)} onClick={go(`/collections/${c.id}`)}>{c.name}</a></li>
        ))}
      </ul>
      <h2 className="rail-head small-caps">Daily notes</h2>
      <ul className="rail-days">
        {lib.recent.map((d) => (
          <li key={d.object_id}><a href={`/o/${d.object_id}`} aria-current={current(`/o/${d.object_id}`)} onClick={go(`/o/${d.object_id}`, true)}>{dateHeading(d.date)}</a></li>
        ))}
      </ul>
      <ul className="rail-tools">
        <li><a href="/timeline" aria-current={current('/timeline')} onClick={go('/timeline')}>Timeline</a></li>
        <li><a href="/queries" aria-current={current('/queries')} onClick={go('/queries')}>Queries</a></li>
        <li><a href="/graph" aria-current={current('/graph')} onClick={go('/graph')}>Graph</a></li>
        <li><a href="/settings" aria-current={current('/settings')} onClick={go('/settings')}>Settings</a></li>
      </ul>
    </nav>
  );
}

type PanelPhase = 'closed' | 'open' | 'closing';

/** A drawer (from the left) or sheet (from the bottom) moved by the spring. */
function useSpringPanel(axis: 'x' | 'y') {
  const ref = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<PanelPhase>('closed');
  const phaseRef = useRef<PanelPhase>('closed');
  const spring = useRef<SpringPanel | null>(null);
  const settleResolvers = useRef<Array<() => void>>([]);
  const setBoth = (p: PanelPhase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  if (!spring.current) {
    spring.current = new SpringPanel(
      (offset, progress) => {
        const el = ref.current;
        if (el) el.style.transform = axis === 'x' ? `translateX(${offset}px)` : `translateY(${offset}px)`;
        if (backdrop.current) backdrop.current.style.opacity = String(progress);
      },
      () => {
        const el = ref.current;
        if (!el) return 0;
        return axis === 'x' ? -el.offsetWidth : el.offsetHeight;
      },
      (open) => {
        if (open) {
          for (const r of settleResolvers.current) r();
          settleResolvers.current = [];
        } else if (phaseRef.current === 'closing') setBoth('closed');
      },
    );
  }
  useEffect(() => () => spring.current?.dispose(), []);
  const [request, setRequest] = useState<{ n: number; fromRest: boolean }>({ n: 0, fromRest: true });
  const open = useCallback((): Promise<void> => {
    const fromRest = phaseRef.current === 'closed';
    if (phaseRef.current === 'open') return Promise.resolve();
    setBoth('open');
    setRequest((r) => ({ n: r.n + 1, fromRest }));
    return new Promise((resolve) => settleResolvers.current.push(resolve));
  }, []);
  // The spring starts once the opened panel is laid out, so it has a size to move from.
  useLayoutEffect(() => {
    if (request.n) spring.current?.retarget(true, request.fromRest);
  }, [request]);
  const close = useCallback(() => {
    if (phaseRef.current !== 'open') return;
    setBoth('closing');
    spring.current?.retarget(false, false);
  }, []);
  return { ref, backdrop, phase, open, close, spring };
}

export function Frame({ children, wide = false, bleed = false }: { children: ReactNode; wide?: boolean; bleed?: boolean }) {
  const layout = useLayout();
  const feedback = useFeedback();
  const sync = useSyncStatus();
  const [marginNode, setMarginNode] = useState<HTMLElement | null>(null);
  const [newType, setNewType] = useState(false);
  const [topTitle, setTopTitle] = useState('');
  const drawer = useSpringPanel('x');
  const sheet = useSpringPanel('y');
  const drawerOpener = useRef<HTMLElement | null>(null);
  const sheetOpener = useRef<HTMLElement | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const sheetDrag = useRef<{ y: number; t: number; start: number; v: number } | null>(null);

  const checkStorage = useCallback(async () => {
    try {
      const r = await get<{ storage: 'available' | 'unavailable' }>('/api/storage');
      if (r.status !== 200) return;
      setStorage(r.data.storage);
      if (r.data.storage === 'available' && poll.current) {
        clearInterval(poll.current);
        poll.current = null;
      }
      if (r.data.storage === 'unavailable' && !poll.current) poll.current = setInterval(() => void checkStorage(), STORAGE_POLL_MS);
    } catch {
      // offline: the next poll tries again
    }
  }, []);
  useEffect(() => {
    void checkStorage();
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, [checkStorage]);

  const openDrawer = () => {
    if (drawer.phase === 'closed') drawerOpener.current = document.activeElement as HTMLElement | null;
    void drawer.open();
  };
  // Focus goes back once the page behind the panel is no longer inert (the next commit).
  const returnFocus = useRef<HTMLElement | null>(null);
  const closeDrawer = () => {
    drawer.close();
    returnFocus.current = drawerOpener.current;
  };
  const openMargin = useCallback(async () => {
    if (sheet.phase === 'closed') sheetOpener.current = document.activeElement as HTMLElement | null;
    await sheet.open();
  }, [sheet]);
  const closeSheet = () => {
    sheet.close();
    returnFocus.current = sheetOpener.current;
  };
  useLayoutEffect(() => {
    if (drawer.phase === 'open' || sheet.phase === 'open' || !returnFocus.current) return;
    if (returnFocus.current.isConnected) returnFocus.current.focus();
    returnFocus.current = null;
  }, [drawer.phase, sheet.phase]);

  // Close panels that no longer belong to the layout.
  useEffect(() => {
    if (layout === 'laptop' && drawer.phase !== 'closed') drawer.close();
    if (layout !== 'phone' && sheet.phase !== 'closed') sheet.close();
  }, [layout, drawer, sheet]);

  // Focus moves into an opened panel.
  useLayoutEffect(() => {
    for (const panel of [drawer, sheet]) {
      const el = panel.ref.current;
      if (panel.phase === 'open' && el && !el.contains(document.activeElement)) (focusables(el)[0] ?? el).focus();
    }
  }, [drawer.phase, sheet.phase, drawer, sheet]);

  // Native listeners: the margin's content is a React portal, so its key events never reach a
  // React handler on the sheet; the DOM still bubbles them through it.
  const closers = useRef({ drawer: closeDrawer, sheet: closeSheet });
  closers.current = { drawer: closeDrawer, sheet: closeSheet };
  useEffect(() => {
    const bind = (el: HTMLDivElement | null, which: 'drawer' | 'sheet') => {
      if (!el) return () => undefined;
      const onKey = (e: KeyboardEvent) => {
        if (el.getAttribute('role') !== 'dialog') return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          closers.current[which]();
        } else trapTab(e, el);
      };
      el.addEventListener('keydown', onKey);
      return () => el.removeEventListener('keydown', onKey);
    };
    const offDrawer = bind(drawer.ref.current, 'drawer');
    const offSheet = bind(sheet.ref.current, 'sheet');
    return () => {
      offDrawer();
      offSheet();
    };
  }, [layout, wide, drawer.ref, sheet.ref]);

  // The daily note reveal: one animation on main, a left-hand part growing to its full width.
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    setRevealHandler(() => {
      const main = mainRef.current;
      if (!main) return;
      for (const a of main.getAnimations()) a.cancel();
      if (reducedMotion()) main.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'linear' });
      else main.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: REVEAL_MS, easing: QUIRE_CURVE_CSS });
    });
  }, []);

  const anyPanelOpen = drawer.phase === 'open' || sheet.phase === 'open';
  const frameApi: FrameApi = {
    layout, marginNode, openMargin, openNewType: () => setNewType(true), storageFailed: () => void checkStorage(), setTopTitle,
  };
  const marginRef = useCallback((node: HTMLElement | null) => setMarginNode(node), []);

  const onSheetPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('a,button,input,select,textarea,[contenteditable]')) return;
    sheetDrag.current = { y: e.clientY, t: performance.now(), start: sheet.spring.current?.offset ?? 0, v: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onSheetPointerMove = (e: React.PointerEvent) => {
    const d = sheetDrag.current;
    if (!d || !sheet.spring.current) return;
    const now = performance.now();
    const offset = Math.max(0, d.start + (e.clientY - d.y));
    const v = now > d.t ? ((offset - sheet.spring.current.offset) / (now - d.t)) * 1000 : d.v;
    d.t = now;
    d.v = v;
    sheet.spring.current.drag(offset, v);
  };
  const onSheetPointerUp = () => {
    const d = sheetDrag.current;
    sheetDrag.current = null;
    const el = sheet.ref.current;
    if (!d || !el || !sheet.spring.current) return;
    if (sheet.spring.current.offset > el.offsetHeight / 3) closeSheet();
    else sheet.spring.current.retarget(true, false);
  };

  return (
    <FrameContext.Provider value={frameApi}>
      <div className={`frame layout-${layout}${wide ? ' frame-wide' : ''}${bleed ? ' frame-bleed' : ''}`} inert={anyPanelOpen ? true : undefined} aria-hidden={anyPanelOpen ? true : undefined}>
        {layout === 'laptop' && <Rail onNewType={() => setNewType(true)} onNavigate={() => undefined} />}
        {layout === 'phone' && (
          <header className="topbar">
            <button type="button" className="icon quiet" aria-label="Open library" onClick={openDrawer}><Icon d={MENU} /></button>
            <span className="topbar-title" aria-hidden="true">{topTitle}</span>
            {!wide && <button type="button" className="icon quiet" aria-label="Open margin" onClick={() => void openMargin()}><Icon d={PANEL_BOTTOM} /></button>}
          </header>
        )}
        <div className="page">
          <main className="column" ref={mainRef}>
            {layout === 'tablet' && (
              <button type="button" className="icon quiet open-library" aria-label="Open library" onClick={openDrawer}><Icon d={MENU} /></button>
            )}
            <div className="running-head mono">
              <span role="status" aria-label="Save status">{feedback.saveStatus}</span>
              <span role="status" aria-label="Sync status" className={sync === 'live' ? 'sync-live' : 'sync-paused'}>
                {sync === 'live' ? COPY.syncLive : sync === 'paused' ? COPY.syncPaused : ''}
              </span>
            </div>
            {feedback.storage === 'unavailable' && <div role="alert" aria-label="Storage status" className="storage-banner">{COPY.storageBanner}</div>}
            <div role="alert" className="alert-band" key={feedback.alertSeq}>{feedback.alert}</div>
            {children}
          </main>
          {layout !== 'phone' && !wide && <aside aria-label="Margin" className="margin" ref={marginRef} />}
        </div>
        <div role="status" aria-live="polite" aria-label="Announcements" className="sr-only">
          <span key={feedback.announceSeq}>{feedback.announcement}</span>
        </div>
      </div>
      {layout !== 'laptop' && (
        <>
          <div ref={drawer.backdrop} className={`backdrop${drawer.phase === 'closing' ? ' closing' : ''}`} hidden={drawer.phase === 'closed'} onClick={closeDrawer} aria-hidden="true" />
          <div
            ref={drawer.ref} className="drawer" hidden={drawer.phase === 'closed'}
            role={drawer.phase === 'open' ? 'dialog' : undefined} aria-modal={drawer.phase === 'open' ? true : undefined}
            aria-label={drawer.phase === 'open' ? 'Library' : undefined}
            aria-hidden={drawer.phase === 'closing' ? true : undefined} inert={drawer.phase === 'closing' ? true : undefined}
          >
            {drawer.phase !== 'closed' && <Rail onNewType={() => { closeDrawer(); setNewType(true); }} onNavigate={() => drawer.close()} />}
          </div>
        </>
      )}
      {layout === 'phone' && !wide && (
        <>
          <div ref={sheet.backdrop} className={`backdrop${sheet.phase === 'closing' ? ' closing' : ''}`} hidden={sheet.phase === 'closed'} onClick={closeSheet} aria-hidden="true" />
          <div
            ref={sheet.ref} className="sheet" hidden={sheet.phase === 'closed'} tabIndex={-1}
            role={sheet.phase === 'open' ? 'dialog' : undefined} aria-modal={sheet.phase === 'open' ? true : undefined}
            aria-label={sheet.phase === 'open' ? 'Margin' : undefined}
            aria-hidden={sheet.phase === 'closing' ? true : undefined} inert={sheet.phase === 'closing' ? true : undefined}
            onPointerDown={onSheetPointerDown} onPointerMove={onSheetPointerMove} onPointerUp={onSheetPointerUp} onPointerCancel={onSheetPointerUp}
          >
            <div className="sheet-grip" aria-hidden="true" />
            <div className="sheet-body" ref={marginRef} />
          </div>
        </>
      )}
      <Palette onNewType={() => setNewType(true)} />
      {newType && <NewTypeDialog onClose={() => setNewType(false)} />}
    </FrameContext.Provider>
  );
}
