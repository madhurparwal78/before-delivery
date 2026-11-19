import { api } from './api';
import { h } from './dom';
import { settings, isWideViewport } from './settings';
import { navigate } from './router';
import type { MeResponse, WorkspaceInfo } from '../shared/types';

export function pillNav(session: MeResponse | null, workspace: WorkspaceInfo | null): HTMLElement {
  const links: HTMLElement[] = [];
  const workspaceId = workspace?.id ?? session?.workspaces[0]?.id ?? null;
  if (session !== null && workspaceId !== null) {
    links.push(
      navLink('Automations', `/w/${workspaceId}`),
      navLink('Runs', `/w/${workspaceId}/runs`),
      navLink('Tables', `/w/${workspaceId}/tables`),
      navLink('Members', `/w/${workspaceId}/members`),
    );
  }
  const actions: HTMLElement[] = [];
  if (session === null) {
    actions.push(
      h('a', { class: 'pill pill-secondary nav-action', href: '/sign-in', onclick: intercept, text: 'Sign in' }),
      h('a', {
        class: 'pill pill-primary nav-action',
        href: '/sign-up',
        onclick: intercept,
        text: 'Create a workspace',
      }),
    );
  } else {
    const selector = h(
      'select',
      {
        class: 'nav-select',
        'aria-label': 'Workspace',
        onchange: (event: Event) => {
          const value = (event.currentTarget as HTMLSelectElement).value;
          navigate(`/w/${value}`);
        },
      },
      ...session.workspaces.map((item) =>
        h('option', { value: item.id, selected: item.id === workspaceId, text: item.name }),
      ),
    );
    actions.push(
      selector,
      h('button', {
        type: 'button',
        class: 'pill pill-primary nav-action',
        text: 'Sign out',
        onclick: () => {
          void api('POST', '/api/auth/sign-out').then(() => {
            window.location.href = '/';
          });
        },
      }),
    );
  }

  const linkGroup = h('div', { class: 'nav-links' }, ...links, ...actions);
  const nav = h(
    'nav',
    { class: 'pill-nav', role: 'navigation', 'aria-label': 'Main' },
    h('a', { class: 'nav-logo', href: '/', onclick: intercept, text: 'Pinbyte Switchyard' }),
    linkGroup,
  );
  if (!isWideViewport()) {
    linkGroup.classList.add('nav-links-collapsed');
    const menu = h('button', {
      type: 'button',
      class: 'pill pill-secondary nav-menu',
      text: 'Menu',
      'aria-expanded': 'false',
      onclick: () => {
        const open = menu.getAttribute('aria-expanded') === 'true';
        menu.setAttribute('aria-expanded', open ? 'false' : 'true');
        linkGroup.classList.toggle('nav-links-open', !open);
      },
      onkeydown: (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          menu.setAttribute('aria-expanded', 'false');
          linkGroup.classList.remove('nav-links-open');
          menu.focus();
        }
      },
    });
    nav.append(menu);
  }
  return nav;
}

function navLink(label: string, href: string): HTMLElement {
  return h('a', { class: 'nav-link', href, onclick: intercept, text: label });
}

export function intercept(event: Event): void {
  const anchor = event.currentTarget as HTMLAnchorElement;
  event.preventDefault();
  navigate(anchor.getAttribute('href') ?? '/');
}

const FOOTER_COLUMNS: { heading: string; links: string[] }[] = [
  { heading: 'Product', links: ['Product tour', 'Changelog', 'Status page'] },
  { heading: 'Operate', links: ['Guides', 'Support desk', 'Release log'] },
  { heading: 'Company', links: ['Our story', 'Careers', 'Contact us'] },
];

export function footer(signedIn: boolean): HTMLElement {
  return h(
    'footer',
    { class: 'site-footer panel panel-dark', role: 'contentinfo' },
    h(
      'div',
      { class: 'footer-columns' },
      ...FOOTER_COLUMNS.map((column) =>
        h(
          'div',
          { class: 'footer-column' },
          h('p', { class: 'footer-heading mono', text: column.heading }),
          ...column.links.map((link) =>
            h('a', { class: 'footer-link mono', href: '/', onclick: intercept, text: link }),
          ),
        ),
      ),
      h('div', { class: 'dot-lattice footer-lattice', 'aria-hidden': 'true' }, h('span', { class: 'lattice-square' })),
    ),
    h(
      'div',
      { class: 'footer-bottom' },
      h('span', { class: 'mono', text: '© 2027 Pinbyte' }),
      h('a', { class: 'footer-link mono', href: '/', onclick: intercept, text: 'Terms of use' }),
      h('a', { class: 'footer-link mono', href: '/', onclick: intercept, text: 'Privacy notice' }),
      h('span', { class: 'footer-marks', 'aria-hidden': 'true' }, '◼ ◻ ◼'),
      signedIn ? h('span', { class: 'footer-zone', text: `Times are shown in ${settings.time_zone}` }) : null,
    ),
  );
}
