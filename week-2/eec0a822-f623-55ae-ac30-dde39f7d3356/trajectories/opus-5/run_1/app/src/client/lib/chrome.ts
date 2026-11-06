import { api, failure, type ApiResult } from './api.js';
import { el } from './dom.js';
import { openDialog } from './dialog.js';
import { link, navigate } from './router.js';
import { currentMember, forgetMember, snapshotForm, type Member } from './session.js';
import { MESSAGES } from '../../shared/copy.js';
import { navLinks } from '../../shared/roles.js';
import { raiseHeading } from './motion.js';
import type { MessageBox } from './forms.js';

export interface StaffPage {
  readonly member: Member;
  readonly main: HTMLElement;
  readonly heading: HTMLHeadingElement;
}

export async function staffPage(
  host: HTMLElement,
  workspaceSlug: string,
  title: string,
): Promise<StaffPage | null> {
  const member = await currentMember();
  if (member === null || member.workspaceSlug !== workspaceSlug) {
    navigate(`/sign-in?next=${encodeURIComponent(window.location.pathname + window.location.search)}`, {
      replace: true,
    });
    return null;
  }
  const links = navLinks(member.role);
  const buildNav = (): HTMLElement =>
    el(
      'nav',
      { class: 'workspace-nav', 'aria-label': 'Workspace' },
      el(
        'ul',
        {},
        ...links.map((entry) =>
          el('li', {}, link(entry.label, `/w/${workspaceSlug}/${entry.path}`)),
        ),
      ),
    );

  const menuButton = el('button', { type: 'button', class: 'menu-button' }, 'Menu');
  menuButton.addEventListener('click', () => {
    openDialog({
      name: 'Menu',
      kind: 'menu',
      opener: menuButton,
      build: (handle) => {
        const nav = buildNav();
        nav.addEventListener('click', () => handle.close());
        return { body: [nav], first: () => nav.querySelector<HTMLElement>('a') };
      },
    });
  });

  const signOut = el('button', { type: 'button', class: 'button-quiet' }, 'Sign out');
  signOut.addEventListener('click', () => {
    void api.delete('/api/session').then(() => {
      forgetMember();
      navigate('/sign-in');
    });
  });

  const heading = el('h1', { class: 'page-heading' }, title);
  const main = el('main', { class: 'page-main' });
  host.appendChild(
    el(
      'div',
      { class: 'staff-shell' },
      el(
        'header',
        { class: 'top-bar' },
        el('p', { class: 'brand' }, 'Tidewright'),
        el('p', { class: 'workspace-name' }, member.workspaceName),
        menuButton,
        buildNav(),
        signOut,
      ),
      el('div', { class: 'page' }, heading, main),
    ),
  );
  document.title = `${title} — Tidewright`;
  raiseHeading(heading);
  return { member, main, heading };
}

/**
 * Shows the published copy when an action meets an ended session or removed
 * access, keeping every typed value on screen.
 */
export function handleAccessFailure(result: ApiResult<unknown>, messages: MessageBox): boolean {
  const body = failure(result);
  if (result.status !== 401) return false;
  if (body.error === 'access_removed') {
    messages.show(MESSAGES.accessRemoved, 'problem');
    forgetMember();
    return true;
  }
  const target = `${window.location.pathname}${window.location.search}`;
  snapshotForm();
  messages.show(MESSAGES.sessionEnded, 'problem');
  forgetMember();
  messages.extra.appendChild(
    link('Sign in again', `/sign-in?next=${encodeURIComponent(target)}`, { class: 'sign-in-again' }),
  );
  return true;
}

export function unexpected(result: ApiResult<unknown>, messages: MessageBox): void {
  if (handleAccessFailure(result, messages)) return;
  messages.show(MESSAGES.unexpected, 'problem');
}

export function publicPage(host: HTMLElement, title: string): { main: HTMLElement; heading: HTMLHeadingElement } {
  const heading = el('h1', { class: 'page-heading' }, title);
  const main = el('main', { class: 'page-main' });
  host.appendChild(el('div', { class: 'public-shell' }, el('div', { class: 'page' }, heading, main)));
  document.title = `${title} — Tidewright`;
  raiseHeading(heading);
  return { main, heading };
}
