import { render } from 'preact';
import type { VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { loadSession, loadConfig } from './api.js';
import { useStatus } from './status.js';
import type { Account, AppConfig } from '../shared/types.js';
import { Landing } from './pages/landing.js';
import { SignUp } from './pages/signup.js';
import { SignIn } from './pages/signin.js';
import { Verify } from './pages/verify.js';
import { Join } from './pages/join.js';
import { Dashboard } from './pages/dashboard.js';
import { ClassroomPage } from './pages/classroom.js';
import { ClassHome } from './pages/classHome.js';
import { ProjectsHome } from './pages/projectsHome.js';
import { EditorPage } from './pages/editor.js';

export interface AppCtx {
  account: Account | null;
  pendingJoin: { classroomName: string } | null;
  config: AppConfig | null;
  navigate: (path: string) => void;
  refresh: () => void;
}

function usePath(): [string, (p: string) => void] {
  const [path, setPath] = useState(location.pathname + location.search);
  useEffect(() => {
    const onPop = () => setPath(location.pathname + location.search);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = (p: string) => {
    history.pushState(null, '', p);
    setPath(p);
  };
  return [path, navigate];
}

function StatusRegion(): VNode {
  const lines = useStatus();
  return (
    <div id="qy-status" role="status" aria-live="polite" aria-label="Status">
      {lines.map((l) => <span class="line" key={l.id}>{l.text}</span>)}
    </div>
  );
}

function MenuDialog(props: { account: Account | null; onClose: () => void; navigate: (p: string) => void }): VNode {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const signOut = async () => {
    await fetch('/api/auth/signout', { method: 'POST' });
    props.onClose();
    window.location.href = '/';
  };
  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label="Menu">
      <div class="dialog">
        <h2>Menu</h2>
        <nav aria-label="Main" style="display:flex;flex-direction:column;gap:12px;margin-top:14px;">
          <a href="/#editors">Editors</a>
          <a href="/#classrooms-info">For classrooms</a>
          <a href="/#starter">Starter projects</a>
          <a href="/join">Join a class</a>
          {props.account ? (
            <button class="pill ghost" onClick={signOut}>Sign out</button>
          ) : (
            <span style="display:flex;flex-direction:column;gap:12px;">
              <a class="pill outline" href="/signin">Sign in</a>
              <a class="pill" href="/signup">Sign up</a>
            </span>
          )}
        </nav>
        <div class="row"><button class="pill ghost" onClick={props.onClose}>Close</button></div>
      </div>
    </div>
  );
}

export function Header(props: { account: Account | null; onOpenMenu: () => void }): VNode {
  const home = props.account
    ? props.account.kind === 'educator' ? '/dashboard' : props.account.kind === 'student' ? '/class' : '/projects'
    : '/signin';
  const signOut = async () => {
    await fetch('/api/auth/signout', { method: 'POST' });
    window.location.href = '/';
  };
  return (
    <header class="banner" role="banner">
      <button class="btn narrow-only" aria-label="Menu" onClick={props.onOpenMenu} style="border-color:rgba(255,255,255,0.5);background:transparent;color:#fff;">Menu</button>
      <a href="/" style="display:inline-flex;align-items:center;" aria-label="Quarkyard home">
        <span class="wordmark">
          <span class="mark">
            <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
              <rect x="2" y="2" width="12" height="12" rx="3" fill="#7ef29d" />
              <circle cx="17.5" cy="17.5" r="6.5" fill="#ffd166" />
              <rect x="2" y="16" width="9" height="8" rx="2" fill="#fff" opacity="0.9" />
            </svg>
          </span>
          Quarkyard
        </span>
      </a>
      <nav aria-label="Main">
        <a href="/#editors">Editors</a>
        <a href="/#classrooms-info">For classrooms</a>
        <a href="/#starter">Starter projects</a>
        <a href="/join">Join a class</a>
      </nav>
      <span class="pills">
        {props.account ? (
          <>
            <span class="who">{props.account.displayName ?? props.account.nickname ?? ''}</span>
            <button class="pill outline signout-wide" onClick={signOut}>Sign out</button>
          </>
        ) : (
          <>
            <a class="pill outline" href="/signin">Sign in</a>
            <a class="pill" href="/signup">Sign up</a>
          </>
        )}
      </span>
      <a class="narrow-only" href={home} style="font-weight:600;">Account</a>
    </header>
  );
}

function NoticeBand(props: { items: string[]; actions?: { label: string; onClick: () => void }[] }): VNode | null {
  if (props.items.length === 0) return null;
  return (
    <div class="notice" role="region" aria-label="Notice">
      {props.items.map((item, i) => (
        <span class="item" key={i}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v5"/><path d="M12 16.5v.01"/></svg>
          {item}
        </span>
      ))}
      {props.actions && props.actions.length > 0 && (
        <span class="actions">
          {props.actions.map((a, i) => <button class="pill ghost" key={i} onClick={a.onClick}>{a.label}</button>)}
        </span>
      )}
    </div>
  );
}

function App(): VNode {
  const [path, navigate] = usePath();
  const [account, setAccount] = useState<Account | null>(null);
  const [pendingJoin, setPendingJoin] = useState<{ classroomName: string } | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [noticeActions, setNoticeActions] = useState<{ label: string; onClick: () => void }[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onNotices = (ev: Event) => {
      const detail = (ev as CustomEvent<{ notices: string[]; actions: { label: string; onClick: () => void }[] }>).detail;
      setNotices(detail.notices);
      setNoticeActions(detail.actions ?? []);
    };
    window.addEventListener('qy-notices', onNotices);
    return () => window.removeEventListener('qy-notices', onNotices);
  }, []);

  const refresh = async () => {
    const session = await loadSession();
    if (session.ok) {
      setAccount(session.data.account);
      setPendingJoin(session.data.pendingJoin);
    }
  };

  useEffect(() => {
    void refresh();
    void loadConfig().then((r) => {
      if (r.ok) {
        setConfig(r.data);
        // toastMs drives the removal timing of status lines
        import('./status.js').then((mod) => mod.configureToasts(r.data.toastMs));
      }
    });
  }, []);

  const pathname = path.split('?')[0]!;
  let page: VNode;
  const ctx: AppCtx = { account, pendingJoin, config, navigate, refresh };

  if (pathname.startsWith('/editor')) {
    page = <EditorPage ctx={ctx} />;
  } else if (pathname === '/signup') {
    page = <SignUp ctx={ctx} />;
  } else if (pathname === '/signin') {
    page = <SignIn ctx={ctx} />;
  } else if (pathname === '/verify') {
    page = <Verify ctx={ctx} />;
  } else if (pathname === '/join') {
    page = <Join ctx={ctx} />;
  } else if (pathname === '/dashboard') {
    page = <Dashboard ctx={ctx} />;
  } else if (pathname.startsWith('/classrooms/')) {
    page = <ClassroomPage ctx={ctx} id={pathname.slice('/classrooms/'.length).split('/')[0]!} />;
  } else if (pathname === '/class') {
    page = <ClassHome ctx={ctx} />;
  } else if (pathname === '/projects') {
    page = <ProjectsHome ctx={ctx} />;
  } else {
    page = <Landing ctx={ctx} />;
  }

  return (
    <>
      {pathname.startsWith('/editor') ? null : <Header account={account} onOpenMenu={() => setMenuOpen(true)} />}
      {menuOpen && <MenuDialog account={account} onClose={() => setMenuOpen(false)} navigate={navigate} />}
      {!pathname.startsWith('/editor') && pathname !== '/' && <NoticeBand items={notices} actions={noticeActions} />}
      {page}
      <StatusRegion />
    </>
  );
}

export function setNotices(notices: string[], actions: { label: string; onClick: () => void }[] = []): void {
  window.dispatchEvent(new CustomEvent('qy-notices', { detail: { notices, actions } }));
}

render(<App />, document.getElementById('app')!);
