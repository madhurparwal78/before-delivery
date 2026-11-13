// App bootstrap: routing between the public screens.

import { ApiError, NetworkError, Session, api } from './api.js';
import { DialogHost, makeLive } from './shell.js';
import { SignInScreen } from './signin.js';
import { Workspace } from './workspace.js';
import { WindowsScreen } from './windows.js';
import { ApprovalPage } from './approval.js';

let currentScreen: { unmount?(): void } | null = null;

export function boot(): void {
  const root = document.getElementById('root')!;
  const { root: liveRoot, live } = makeLive();
  document.body.appendChild(liveRoot);

  const onSessionEnded = (): void => {
    const notice = 'Your session ended. Sign in again.';
    currentScreen?.unmount?.();
    window.location.href = `/sign-in?notice=${encodeURIComponent(notice)}`;
  };

  const dialogs = new DialogHost(live, onSessionEnded);

  const showSignIn = (returnTo: string, notice: string | null): void => {
    currentScreen?.unmount?.();
    currentScreen = null;
    document.title = 'Sign in · Keelson';
    const screen = new SignInScreen(root, live, (_session, to) => {
      window.history.pushState({}, '', to);
      void reroute();
    }, notice);
    currentScreen = { unmount: () => { root.innerHTML = ''; } };
    screen.mount(returnTo);
  };

  const showWorkspace = (session: Session, slug: string, promoHash: string | null): void => {
    currentScreen?.unmount?.();
    const ws = new Workspace(session, slug, live, dialogs, onSessionEnded);
    currentScreen = { unmount: () => ws.unmount() };
    ws.mount();
    if (promoHash) {
      const promoId = promoHash.split('=')[1];
      if (promoId) void selectPromotionById(ws, promoId);
    }
  };

  const selectPromotionById = async (ws: Workspace, promoId: string): Promise<void> => {
    try {
      const promo = await api.promotion(promoId) as { id: string; stage: string };
      ws.selectStage(promo.stage);
      ws.selectPromotion(promo.id);
    } catch { /* leave the default selection */ }
  };

  const showWindows = (session: Session, slug: string): void => {
    currentScreen?.unmount?.();
    const role = session.memberships.find((m) => m.project === slug)?.role ?? '';
    const screen = new WindowsScreen(slug, role, live, dialogs, onSessionEnded);
    currentScreen = { unmount: () => screen.unmount() };
    screen.mount();
  };

  const showApproval = (token: string): void => {
    currentScreen?.unmount?.();
    currentScreen = null;
    const page = new ApprovalPage(root, token);
    void page.mount();
  };

  const route = async (session: Session): Promise<void> => {
    const path = window.location.pathname;
    const hash = window.location.hash.replace(/^#/, '');
    const projects = await api.projects() as { projects: { slug: string }[] };
    const promoHash = hash.startsWith('promo=') ? hash : null;
    const projectMatch = /^\/projects\/([^/]+)(\/windows)?$/.exec(path);
    if (projectMatch) {
      const slug = projectMatch[1];
      if (!projects.projects.some((p) => p.slug === slug)) {
        root.innerHTML = `<div class="approval-page"><div class="panel"><h1>The project is unknown.</h1></div></div>`;
        return;
      }
      if (projectMatch[2]) showWindows(session, slug);
      else showWorkspace(session, slug, promoHash);
      return;
    }
    const first = projects.projects[0];
    if (first) {
      window.history.replaceState({}, '', `/projects/${first.slug}`);
      showWorkspace(session, first.slug, null);
    } else {
      showSignIn('/', null);
    }
  };

  const reroute = async (): Promise<void> => {
    const path = window.location.pathname;
    if (path === '/sign-in') {
      try {
        const session = await api.session() as Session;
        const params = new URLSearchParams(window.location.search);
        const returnTo = params.get('return');
        if (returnTo && !returnTo.startsWith('/sign-in')) {
          window.history.replaceState({}, '', returnTo);
        }
        await route(session);
      } catch {
        const params = new URLSearchParams(window.location.search);
        showSignIn(params.get('return') ?? '/', params.get('notice'));
      }
      return;
    }
    if (path.startsWith('/approvals/')) {
      showApproval(path.slice('/approvals/'.length));
      return;
    }
    try {
      const session = await api.session() as Session;
      await route(session);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'unauthenticated') {
        const returnTo = window.location.pathname + window.location.search + window.location.hash;
        window.location.href = `/sign-in?return=${encodeURIComponent(returnTo)}`;
      } else if (err instanceof NetworkError) {
        root.innerHTML = `<div class="sign-in-wrap"><div class="sign-in panel"><h1>Keelson</h1><p class="note">Keelson could not reach the server. Reload to try again.</p></div></div>`;
      }
    }
  };

  window.addEventListener('popstate', () => void reroute());
  window.addEventListener('keelson:session-ended', () => onSessionEnded());
  void reroute();
}
