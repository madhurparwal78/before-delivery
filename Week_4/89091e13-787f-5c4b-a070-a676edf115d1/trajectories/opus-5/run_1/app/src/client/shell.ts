import { request, Workspace } from './api.js';
import { drawWave, registerCanvas } from './art.js';
import { el } from './dom.js';
import { navigate } from './router.js';

const PANELS: { label: string; path: string }[] = [
  { label: 'Explorer', path: 'explorer' },
  { label: 'Submit', path: 'submit' },
  { label: 'Nodes', path: 'nodes' },
  { label: 'Stake', path: 'stake' },
  { label: 'Vote', path: 'vote' },
];

export interface Shell {
  main: HTMLElement;
  networkUpdates: HTMLElement;
}

/** The Network updates region outlives each render, so every announcement stays. */
const networkUpdates = el('p', {
  class: 'live-region',
  attrs: { role: 'status', 'aria-label': 'Network updates', 'aria-live': 'polite' },
});

function menuDialog(workspaceId: string | null): { button: HTMLElement; dialog: HTMLDialogElement } {
  const dialog = el('dialog', { attrs: { 'aria-label': 'Menu' } }) as HTMLDialogElement;
  const links = el('div', { class: 'dialog-links' });
  if (workspaceId) {
    links.append(
      el('a', { class: 'pill pill-outline', attrs: { href: `/w/${workspaceId}/members` } }, 'Members'),
      el('a', { class: 'pill pill-outline', attrs: { href: `/w/${workspaceId}/ledger` } }, 'Ledger'),
    );
  }
  links.append(
    el(
      'button',
      {
        class: 'pill pill-outline',
        attrs: { type: 'button' },
        on: {
          click: () => {
            void request('/api/session', { method: 'DELETE' }).then(() => {
              dialog.close();
              navigate('/signin');
            });
          },
        },
      },
      'Sign out',
    ),
  );
  dialog.append(
    el('h2', { text: 'Menu' }),
    links,
    el(
      'button',
      { class: 'pill pill-outline', attrs: { type: 'button' }, on: { click: () => dialog.close() } },
      'Close',
    ),
  );
  const button = el(
    'button',
    {
      class: 'menu-button',
      attrs: { type: 'button', 'aria-label': 'Menu' },
      on: { click: () => dialog.showModal() },
    },
    [el('i'), el('i')],
  );
  dialog.addEventListener('close', () => button.focus());
  return { button, dialog };
}

/** The console top bar, panel tablist and the Network updates live region. */
export function renderShell(workspace: Workspace | null, pathname: string): Shell {
  const app = document.getElementById('app') as HTMLElement;
  app.replaceChildren();

  const brand = el(
    'a',
    { class: 'brand', attrs: { href: workspace ? `/w/${workspace.id}/explorer` : '/', 'aria-label': 'Fernsquare home' } },
    [
      el('span', { class: 'brand-mark', attrs: { 'aria-hidden': 'true' } }, [
        el('i'),
        el('i'),
        el('i'),
        el('i'),
      ]),
      el('span', { text: 'Fernsquare' }),
    ],
  );

  const bar = el('header', { class: 'top-bar' }, brand);
  const panelFor = (path: string): string => `/w/${workspace?.id ?? ''}/${path}`;
  const current = (path: string): boolean =>
    path === 'explorer'
      ? pathname.includes('/explorer') || pathname.includes('/blobs/')
      : pathname.includes(`/${path}`);

  if (workspace) {
    const nav = el('nav', { class: 'workspace-nav', attrs: { 'aria-label': 'Workspace' } });
    for (const panel of PANELS) {
      nav.appendChild(
        el(
          'a',
          {
            attrs: {
              href: panelFor(panel.path),
              'aria-current': current(panel.path) ? 'page' : null,
            },
          },
          panel.label,
        ),
      );
    }
    bar.appendChild(nav);
  }
  bar.appendChild(el('span', { class: 'spacer' }));
  bar.appendChild(
    el(
      'a',
      {
        class: 'pill pill-primary',
        attrs: {
          href: workspace ? panelFor('submit') : '/signin',
          'aria-label': 'Submit blob',
        },
      },
      ['Submit blob', el('span', { class: 'arrow', attrs: { 'aria-hidden': 'true' } }, '\u2192')],
    ),
  );
  const menu = menuDialog(workspace?.id ?? null);
  bar.appendChild(menu.button);
  app.appendChild(bar);
  app.appendChild(menu.dialog);

  document.body.classList.toggle('has-tabs', workspace !== null);
  if (workspace) {
    const tablist = el('div', {
      class: 'panel-tabs',
      attrs: { role: 'tablist', 'aria-label': 'Workspace panels' },
    });
    for (const panel of PANELS) {
      tablist.appendChild(
        el(
          'button',
          {
            attrs: {
              type: 'button',
              role: 'tab',
              'aria-selected': current(panel.path) ? 'true' : 'false',
            },
            on: { click: () => navigate(panelFor(panel.path)) },
          },
          panel.label,
        ),
      );
    }
    app.appendChild(tablist);
  }

  const main = el('main');
  if (workspace) app.appendChild(networkUpdates);
  app.appendChild(main);
  return { main, networkUpdates };
}

export function announce(region: HTMLElement, copy: string): void {
  region.appendChild(el('span', { text: `${copy} ` }));
}

/** The console footer over the share strand wave. */
export function consoleFooter(waveShares: string[]): HTMLElement {
  const canvas = el('canvas', { class: 'footer-wave' });
  const footer = el('footer', { class: 'console-footer' }, [
    canvas,
    el(
      'div',
      { class: 'container footer-note' },
      'Fernsquare — a private, deterministic data availability sandbox by Orrin Fieldworks. FERN is a valueless test token.',
    ),
  ]);
  registerCanvas(canvas, () => drawWave(canvas, waveShares));
  return footer;
}
