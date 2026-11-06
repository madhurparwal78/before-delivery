import { call } from './api.js';
import { el } from './dom.js';
import { rollCount } from './motion.js';
import { navigate, type ScreenResult } from './router.js';
import { cachedMember, setMember } from './session.js';
import { tray } from './store.js';
import type { Member, Role } from '../../shared/types.js';

let trayCountNode: HTMLElement | null = null;

export function refreshTrayCount(roll: boolean): void {
  if (!trayCountNode) return;
  trayCountNode.textContent = `Tray ${tray().length}`;
  if (roll) rollCount(trayCountNode);
}

export function trayLinkNode(): HTMLElement | null {
  return trayCountNode;
}

function publicHeader(): HTMLElement {
  const trayLink = el('a', { class: 'nav-link tray-link', href: '/tray', text: `Tray ${tray().length}` });
  trayCountNode = trayLink;
  return el('header', { class: 'site-header' }, [
    el('a', { class: 'brand', href: '/boards', text: 'Vesper & Rowe Talent' }),
    el('nav', { 'aria-label': 'Site', class: 'site-nav' }, [
      el('a', { class: 'nav-link', href: '/boards', text: 'Boards' }),
      trayLink,
      el('a', { class: 'nav-link', href: '/apply', text: 'Apply' }),
    ]),
  ]);
}

const WORKSPACE_LINKS: Record<Role, Array<{ label: string; href: string }>> = {
  agency_director: [
    { label: 'Overview', href: '/workspace/overview' },
    { label: 'Board', href: '/workspace/board' },
    { label: 'Bookings', href: '/workspace/bookings' },
    { label: 'Licences', href: '/workspace/licences' },
    { label: 'Statements', href: '/workspace/statements' },
    { label: 'Packages', href: '/workspace/packages' },
    { label: 'Applications', href: '/workspace/applications' },
    { label: 'Roster', href: '/workspace/roster' },
    { label: 'Members', href: '/workspace/members' },
    { label: 'Rate cards', href: '/workspace/rate-cards' },
    { label: 'Offices', href: '/workspace/offices' },
  ],
  booker: [
    { label: 'Board', href: '/workspace/board' },
    { label: 'Bookings', href: '/workspace/bookings' },
    { label: 'Packages', href: '/workspace/packages' },
  ],
  accounts_lead: [
    { label: 'Licences', href: '/workspace/licences' },
    { label: 'Bookings', href: '/workspace/bookings' },
    { label: 'Statements', href: '/workspace/statements' },
  ],
  scout: [{ label: 'Applications', href: '/workspace/applications' }],
  talent: [{ label: 'My calendar', href: '/workspace/me' }],
};

function officeRail(member: Member): HTMLElement {
  const signOut = el('button', { type: 'button', class: 'button button-quiet', text: 'Sign out' });
  signOut.addEventListener('click', () => {
    void call('DELETE', '/api/session').then(() => {
      setMember(null);
      navigate('/sign-in');
    });
  });
  const path = window.location.pathname;
  return el('aside', { class: 'office-rail' }, [
    el('p', { class: 'rail-member', text: member.name }),
    el('nav', { 'aria-label': 'Offices', class: 'rail-offices' }, [
      el('a', { class: 'nav-link', href: '/workspace/board?office=toronto', text: 'Toronto' }),
      el('a', { class: 'nav-link', href: '/workspace/board?office=vancouver', text: 'Vancouver' }),
    ]),
    el(
      'nav',
      { 'aria-label': 'Workspace', class: 'rail-nav' },
      WORKSPACE_LINKS[member.role].map((link) =>
        el('a', {
          class: 'nav-link',
          href: link.href,
          text: link.label,
          'aria-current': path === link.href.split('?')[0] ? 'page' : null,
        })),
    ),
    signOut,
  ]);
}

export function shellFor(result: ScreenResult): HTMLElement {
  trayCountNode = null;
  if (result.chrome === 'public') {
    return el('div', { class: 'site' }, [publicHeader(), result.node]);
  }
  if (result.chrome === 'workspace') {
    const member = cachedMember();
    return el('div', { class: 'workspace' }, [member ? officeRail(member) : null, result.node]);
  }
  return el('div', { class: 'site plain' }, [result.node]);
}
