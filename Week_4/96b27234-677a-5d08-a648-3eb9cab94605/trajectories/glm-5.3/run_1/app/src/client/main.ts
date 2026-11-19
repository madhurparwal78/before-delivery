// Client entry: renders the right screen for the path, with the shared shell.
import { api, el, me, navigation, pageNotFound, alertRegion, setStatus, focusMainHeading, prefersReducedMotion, type Me } from './app';
import { renderRoomPage, closeSheet } from './room';
import { renderSessionsPage } from './sessions-page';
import { renderFriendsPage } from './friends-page';
import { renderStudioPage } from './studio-page';
import { renderCommunitiesPage, renderCommunityPage } from './communities-page';
import { renderGatheringPage } from './gathering-page';
import { renderModerationPage } from './moderation-page';
import { renderAuthPages, renderInvitePage, renderConfirmPage } from './auth-pages';

export interface Ctx {
  me: Me | null;
  main: HTMLElement;
  path: string;
}

async function boot(): Promise<void> {
  const m = await me();
  const app = document.getElementById('app') as HTMLElement;
  app.textContent = '';
  if (m) app.append(navigation(m));
  const main = el('main', {});
  app.append(main);
  const path = location.pathname;

  const publicPaths = [/^\/signin$/, /^\/signup$/, /^\/confirm\//, /^\/invites\//, /^\/$/];
  const isPublic = publicPaths.some((re) => re.test(path));
  if (!m && !isPublic) {
    sessionStorage.setItem('hearthtile_return', path);
    location.href = '/signin';
    return;
  }
  const ctx: Ctx = { me: m, main, path };

  if (path === '/' || path === '') {
    if (m) {
      location.href = '/sessions';
      return;
    }
    renderFrontDoor(ctx);
    return;
  }
  if (path === '/signin' || path === '/signup') {
    renderAuthPages(ctx, path === '/signin' ? 'signin' : 'signup');
    return;
  }
  if (path.startsWith('/confirm/')) {
    renderConfirmPage(ctx, path.slice('/confirm/'.length));
    return;
  }
  if (path.startsWith('/invites/')) {
    renderInvitePage(ctx, path.slice('/invites/'.length));
    return;
  }
  if (path === '/sessions') { renderSessionsPage(ctx); return; }
  if (/^\/sessions\/[^/]+$/.test(path)) { renderRoomPage(ctx, path.slice('/sessions/'.length)); return; }
  if (path === '/friends') { renderFriendsPage(ctx); return; }
  if (path === '/studio') { renderStudioPage(ctx); return; }
  if (path === '/communities') { renderCommunitiesPage(ctx); return; }
  if (/^\/communities\/[^/]+$/.test(path)) { renderCommunityPage(ctx, path.slice('/communities/'.length)); return; }
  if (/^\/gatherings\/[^/]+$/.test(path)) { renderGatheringPage(ctx, path.slice('/gatherings/'.length)); return; }
  if (path === '/moderation') {
    if (m?.siteRole !== 'moderator') { pageNotFound(); return; }
    renderModerationPage(ctx);
    return;
  }
  pageNotFound();
}

function renderFrontDoor(ctx: Ctx): void {
  const { main } = ctx;
  main.append(el('h1', {}, 'Hearthtile'));
  main.append(el('p', {}, 'A small paper-cut gathering place for volunteer hosts and hobby 3D creators.'));
  const links = el('div', { class: 'panel' });
  links.append(el('a', { href: '/signin' }, 'Sign in'));
  links.append(' ');
  links.append(el('a', { href: '/signup' }, 'Sign up'));
  main.append(links);
}

void boot();
export { api, setStatus, alertRegion, pageNotFound, closeSheet, el, focusMainHeading, prefersReducedMotion, navigation, me };
export type { Me };
