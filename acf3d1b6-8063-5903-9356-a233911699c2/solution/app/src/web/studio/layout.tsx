import { createContext, type ComponentChildren } from 'preact';
import { useCallback, useContext, useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { formatCredits, planOf } from '../../shared/catalog.js';
import { api } from '../api.js';
import type { Me } from '../data.js';
import { Wordmark } from '../public/chrome.js';
import { Dialog } from '../ui/dialog.js';
import { Coins, Folder, Home, MenuIcon, People, Plus } from '../ui/icons.js';

interface Session {
  me: Me | null;
  /** Reads the balance (and the rest of the profile) again from the server. */
  refresh: () => Promise<void>;
}

const SessionContext = createContext<Session>({ me: null, refresh: async () => {} });

export const useSession = () => useContext(SessionContext);

/** Holds the signed-in person for every studio page, so moving between pages keeps the sidebar steady. */
export function SessionProvider({ initial, children }: { initial?: Me; children: ComponentChildren }) {
  const [me, setMe] = useState<Me | null>(initial ?? null);
  const refresh = useCallback(async () => {
    const reply = await api<Me>('GET', '/me');
    if (reply.ok) setMe(reply.data);
  }, []);
  return <SessionContext.Provider value={{ me, refresh }}>{children}</SessionContext.Provider>;
}

/** Set when "New generation" is pressed; the composer takes focus when it sees it. */
export const promptFocus = { wanted: false };
export const FOCUS_PROMPT_EVENT = 'kinora:focus-prompt';

const NAV = [
  { label: 'Home', href: '/studio', icon: Home, current: (path: string) => path === '/studio' },
  {
    label: 'Projects',
    href: '/studio/projects',
    icon: Folder,
    current: (path: string) => path.startsWith('/studio/projects') || path.startsWith('/studio/generations'),
  },
  { label: 'Credits', href: '/studio/credits', icon: Coins, current: (path: string) => path === '/studio/credits' },
  { label: 'Team', href: '/studio/team', icon: People, current: (path: string) => path === '/studio/team' },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { me } = useSession();
  const { path } = useLocation();
  const [leaving, setLeaving] = useState(false);

  const logOut = async () => {
    setLeaving(true);
    await api('POST', '/auth/logout');
    location.assign('/login');
  };

  const newGeneration = () => {
    promptFocus.wanted = true;
    window.dispatchEvent(new Event(FOCUS_PROMPT_EVENT));
    onNavigate?.();
  };

  return (
    <>
      <a class="pill pill-new" href="/studio" onClick={newGeneration}>
        <span class="plus-circle" aria-hidden="true">
          <Plus size={14} />
        </span>
        New generation
      </a>
      <nav class="sidebar-nav" aria-label="Studio">
        <ul>
          {NAV.map((item) => (
            <li key={item.href}>
              <a href={item.href} aria-current={item.current(path) ? 'page' : undefined} onClick={onNavigate}>
                <item.icon />
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div class="sidebar-foot">
        {me ? (
          <>
            <p class="sidebar-name">{me.user.name}</p>
            <p class="sidebar-workspace">{me.workspace.name}</p>
            <p class="sidebar-plan">
              <span class="badge badge-indigo">{planOf(me.workspace.plan).name}</span>
            </p>
            <p class="sidebar-balance figure">{formatCredits(me.balance)}</p>
          </>
        ) : (
          <div class="skeleton skeleton-foot" />
        )}
        <button type="button" class="button button-light button-block" onClick={logOut} disabled={leaving}>
          Log out
        </button>
      </div>
    </>
  );
}

export function StudioLayout({ children }: { children: ComponentChildren }) {
  const { me, refresh } = useSession();
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    if (!me) void refresh();
  }, []);

  return (
    <div class="studio">
      <aside class="sidebar" aria-label="Studio sidebar">
        <Wordmark suffix="Creative" />
        <SidebarContent />
      </aside>
      <div class="studio-topbar">
        <Wordmark suffix="Creative" />
        <button type="button" class="button button-light menu-toggle" onClick={() => setDrawer(true)} aria-haspopup="dialog">
          <MenuIcon /> Menu
        </button>
      </div>
      {drawer && (
        <Dialog title="Menu" variant="drawer" heading={<Wordmark suffix="Creative" />} onClose={() => setDrawer(false)}>
          <div class="drawer-sidebar">
            <SidebarContent onNavigate={() => setDrawer(false)} />
          </div>
        </Dialog>
      )}
      <main id="main" class="studio-main">
        {children}
      </main>
    </div>
  );
}
