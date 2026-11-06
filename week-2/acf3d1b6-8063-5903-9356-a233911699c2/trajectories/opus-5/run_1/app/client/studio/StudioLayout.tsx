import { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { CoinIcon, FolderIcon, HomeIcon, MenuLines, PeopleIcon, PlusMark } from '../components/Icons';
import { Drawer } from '../components/ui';
import { useMember } from '../store';
import { creditWords } from '../format';
import { planById } from '../../shared/catalog';

export type StudioPage = 'home' | 'projects' | 'credits' | 'team';

const NAV: { id: StudioPage; label: string; href: string; icon: typeof HomeIcon }[] = [
  { id: 'home', label: 'Home', href: '/studio', icon: HomeIcon },
  { id: 'projects', label: 'Projects', href: '/studio/projects', icon: FolderIcon },
  { id: 'credits', label: 'Credits', href: '/studio/credits', icon: CoinIcon },
  { id: 'team', label: 'Team', href: '/studio/team', icon: PeopleIcon }
];

export function focusPromptBox(): void {
  setTimeout(() => document.getElementById('field-prompt')?.focus(), 60);
}

function SidebarBody({ current, onNavigate }: { current: StudioPage; onNavigate?: () => void }) {
  const { me, signOut } = useMember();
  const { route } = useLocation();

  return (
    <>
      <a class="wordmark" href="/studio" onClick={onNavigate}>
        kinora <span style="color:var(--muted);font-weight:500">Creative</span>
      </a>

      <a
        class="btn btn-accent btn-pill"
        href="/studio"
        onClick={() => {
          onNavigate?.();
          focusPromptBox();
        }}
      >
        <span class="plus-circle">
          <PlusMark />
        </span>
        New generation
      </a>

      <nav class="sidebar-nav" aria-label="Studio">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <a
              key={item.id}
              class="sidebar-link"
              href={item.href}
              aria-current={item.id === current ? 'page' : undefined}
              onClick={onNavigate}
            >
              <Icon />
              {item.label}
            </a>
          );
        })}
      </nav>

      <div class="sidebar-foot">
        {me ? (
          <>
            <p style="margin:0;color:var(--ink);font-weight:500">{me.user.name}</p>
            <p style="margin:0" class="muted">
              {me.workspace.name}
            </p>
            <p style="margin:0 0 8px" class="muted">
              {planById(me.workspace.plan)!.name}
            </p>
            <p class="sidebar-balance" style="margin:0 0 12px">
              {creditWords(me.balance)}
            </p>
          </>
        ) : null}
        <button
          type="button"
          class="btn btn-light"
          onClick={async () => {
            await signOut();
            route('/login');
          }}
        >
          Log out
        </button>
      </div>
    </>
  );
}

export function StudioLayout({ current, children }: { current: StudioPage; children: ComponentChildren }) {
  const { state } = useMember();
  const { route, url } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (state === 'signed-out') route(`/login?next=${encodeURIComponent(url)}`, true);
  }, [state]);

  if (state !== 'signed-in') {
    return (
      <div class="studio">
        <main class="studio-main">
          <p class="muted">Loading your studio…</p>
        </main>
      </div>
    );
  }

  return (
    <div class="studio">
      <aside class="sidebar">
        <SidebarBody current={current} />
      </aside>

      <div class="studio-bar">
        <span class="wordmark">kinora</span>
        <button type="button" class="btn btn-light" onClick={() => setDrawerOpen(true)}>
          <MenuLines />
          Menu
        </button>
      </div>

      {drawerOpen ? (
        <Drawer title="kinora Creative" onClose={() => setDrawerOpen(false)}>
          <div class="sidebar">
            <SidebarBody current={current} onNavigate={() => setDrawerOpen(false)} />
          </div>
        </Drawer>
      ) : null}

      <main class="studio-main" id="main">
        {children}
      </main>
    </div>
  );
}
