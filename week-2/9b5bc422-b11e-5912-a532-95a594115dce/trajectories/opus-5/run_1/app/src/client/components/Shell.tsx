import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FileText, FolderOpen, NotebookPen, Settings as SettingsIcon, Table2, Trash2 } from 'lucide-react';
import { notices as noticeCopy, syncStatus } from '../../domain/copy.ts';
import { useStore, useViewport } from '../hooks.ts';
import { navigate, useRoute } from '../router.ts';
import { announce, dismissNotice, notice, syncing } from '../store/store.ts';
import { SignInDialog } from './SignInDialog.tsx';
import { UploadDialog } from './UploadDialog.tsx';

type InspectorApi = {
  slot: HTMLElement | null;
  visible: boolean;
  setPresent: (present: boolean) => void;
  setForceClosed: (closed: boolean) => void;
};

const InspectorContext = createContext<InspectorApi>({
  slot: null,
  visible: false,
  setPresent: () => undefined,
  setForceClosed: () => undefined,
});

export function InspectorPanel(props: { children: ReactNode; forceClosed?: boolean }) {
  const api = useContext(InspectorContext);
  useEffect(() => {
    api.setPresent(true);
    return () => api.setPresent(false);
  }, [api]);
  useEffect(() => {
    api.setForceClosed(props.forceClosed === true);
  }, [api, props.forceClosed]);
  if (!api.slot || !api.visible) return null;
  return createPortal(props.children, api.slot);
}

const NAV_ITEMS = [
  { label: 'Documents', to: '/', icon: FileText },
  { label: 'Journal', to: '/journal', icon: NotebookPen },
  { label: 'Records', to: '/records', icon: Table2 },
  { label: 'Templates', to: '/templates', icon: FolderOpen },
  { label: 'Trash', to: '/trash', icon: Trash2 },
  { label: 'Settings', to: '/settings', icon: SettingsIcon },
];

function Navigation(props: { onNavigate?: () => void; firstRef?: (element: HTMLAnchorElement | null) => void }) {
  const route = useRoute();
  return (
    <nav aria-label="Workspace" className="workspace-nav">
      <ul>
        {NAV_ITEMS.map((item, index) => {
          const Icon = item.icon;
          const current = route.path === item.to || (item.to !== '/' && route.path.startsWith(item.to));
          return (
            <li key={item.to}>
              <a
                href={item.to}
                ref={index === 0 ? props.firstRef : undefined}
                aria-current={current ? 'page' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(item.to);
                  props.onNavigate?.();
                }}
              >
                <Icon aria-hidden="true" size={18} />
                <span>{item.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SyncStatusRow() {
  const state = useStore();
  const held = useRef<{ sentence: string; since: number } | null>(null);
  const [, setBeat] = useState(0);

  const current = syncStatus({
    syncing: syncing(),
    online: state.online,
    serviceAvailable: state.serviceAvailable,
    waiting: state.pending.items,
  });

  const now = Date.now();
  const previous = held.current;
  let shown = current;
  if (previous && previous.sentence.startsWith('Syncing ') && now - previous.since < 500 && current.state === 'synced') {
    shown = { state: 'syncing', sentence: previous.sentence };
  }
  if (!previous || previous.sentence !== shown.sentence) {
    held.current = { sentence: shown.sentence, since: now };
  }

  useEffect(() => {
    if (shown.state === 'syncing') {
      const timer = window.setTimeout(() => setBeat((beat) => beat + 1), 520);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [shown.sentence, shown.state]);

  const spoken = useRef('');
  useEffect(() => {
    if (spoken.current !== shown.sentence) {
      spoken.current = shown.sentence;
      announce(shown.sentence);
    }
  }, [shown.sentence]);

  return (
    <p role="status" aria-label="Sync status" className="sync-status" data-sync-state={shown.state}>
      {shown.sentence}
    </p>
  );
}

export function Shell(props: { children: ReactNode }) {
  const state = useStore();
  const viewport = useViewport();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [inspectorPresent, setInspectorPresent] = useState(false);
  const [forceClosed, setForceClosed] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(viewport !== 'phone');
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const firstLink = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    setInspectorOpen(viewport !== 'phone');
    if (viewport === 'desktop') setDrawerOpen(false);
  }, [viewport]);

  useEffect(() => {
    const waiting = [...state.files.values()].some((file) => file.state === 'waiting');
    if (state.account && !state.storageAvailable && waiting) notice(noticeCopy.storageUnavailable);
  }, [state.account, state.storageAvailable, state.files]);

  const inspectorVisible = inspectorPresent && !forceClosed && inspectorOpen;

  const api = useMemo<InspectorApi>(
    () => ({ slot, visible: inspectorVisible, setPresent: setInspectorPresent, setForceClosed }),
    [slot, inspectorVisible],
  );

  return (
    <InspectorContext.Provider value={api}>
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          const main = document.getElementById('main');
          main?.focus();
        }}
      >
        Skip to main content
      </a>
      <header className="banner">
        <div className="banner-left">
          {viewport !== 'desktop' && !drawerOpen && (
            <button
              type="button"
              className="button"
              onClick={() => {
                setDrawerOpen(true);
                window.setTimeout(() => firstLink.current?.focus(), 0);
              }}
            >
              Open navigation
            </button>
          )}
          <span className="brand">Oddment</span>
        </div>
        <SyncStatusRow />
        <div className="banner-right">
          {state.account ? (
            <span className="account-email">{state.account.user.email}</span>
          ) : (
            <button type="button" className="button" onClick={() => setSignInOpen(true)}>
              Sign in
            </button>
          )}
        </div>
      </header>

      <div className="frame" data-inspector={inspectorVisible ? 'open' : 'closed'}>
        {viewport === 'desktop' && <Navigation />}
        {viewport !== 'desktop' && drawerOpen && (
          <div className="drawer">
            <button type="button" className="button" onClick={() => setDrawerOpen(false)}>
              Close navigation
            </button>
            <Navigation firstRef={(element) => (firstLink.current = element)} onNavigate={() => setDrawerOpen(false)} />
          </div>
        )}

        <main id="main" tabIndex={-1} className="main">
          {props.children}
        </main>

        {inspectorPresent && !forceClosed && !inspectorOpen && (
          <button type="button" className="button inspector-opener" onClick={() => setInspectorOpen(true)}>
            Open inspector
          </button>
        )}
        {inspectorPresent && forceClosed && (
          <button type="button" className="button inspector-opener" onClick={() => setForceClosed(false)}>
            Open inspector
          </button>
        )}
        {inspectorVisible && (
          <aside
            aria-label="Inspector"
            className={`inspector paper${viewport === 'phone' ? ' inspector-sheet' : ''}`}
          >
            {viewport === 'phone' && (
              <button type="button" className="button" onClick={() => setInspectorOpen(false)}>
                Close inspector
              </button>
            )}
            <div ref={setSlot} className="inspector-slot" />
          </aside>
        )}
      </div>

      <div className="notices" role="region" aria-label="Notices">
        {state.notices.map((item) => (
          <p key={item.id} className="paper notice">
            <span>{item.text}</span>
            <button type="button" className="button" onClick={() => dismissNotice(item.id)}>
              Dismiss notice
            </button>
          </p>
        ))}
      </div>

      <p role="status" aria-label="Announcements" aria-live="polite" className="visually-hidden">
        {state.announcement}
      </p>

      {signInOpen && <SignInDialog onClose={() => setSignInOpen(false)} />}
      {state.uploadDialogOpen && <UploadDialog />}
    </InspectorContext.Provider>
  );
}
