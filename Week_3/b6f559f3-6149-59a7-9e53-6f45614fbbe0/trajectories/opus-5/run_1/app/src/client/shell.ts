import { api } from './api';
import type { MeResponse } from './api';
import { bootstrapMe } from './client-config';
import { el, openDialog } from './dom';

export interface AppState {
  me: MeResponse | null;
}

export const appState: AppState = { me: null };

export function navigate(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new Event('halation:route'));
}

export function link(label: string, href: string, className = ''): HTMLAnchorElement {
  const anchor = el('a', { href, class: className, text: label });
  anchor.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    navigate(href);
  });
  return anchor;
}

export function workspaceHeader(extra: Node[] = []): HTMLElement {
  const home = link('Halation Studio', '/', 'wordmark');
  home.setAttribute('aria-label', 'Halation Studio home');
  home.prepend(el('span', { class: 'wordmark-dot', 'aria-hidden': 'true' }));
  const actions = el('div', { class: 'header-actions' }, extra);
  if (appState.me) {
    actions.append(el('span', { class: 'caption', text: appState.me.user.name }));
    const signOut = el('button', { type: 'button', class: 'button', text: 'Sign out' });
    signOut.addEventListener('click', () => {
      void api.signOut().then(() => {
        appState.me = null;
        navigate('/');
      });
    });
    actions.append(signOut);
  } else {
    actions.append(link('Sign in', '/signin', 'button'));
  }
  return el('header', { role: 'banner', class: 'workspace-header' }, [home, actions]);
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl or Cmd+Z', 'Undo'],
  ['Ctrl or Cmd+Shift+Z', 'Redo'],
  ['Ctrl or Cmd+D', 'Duplicate the selected layer'],
  ['Ctrl or Cmd+G', 'Group the selected rows'],
  ['Ctrl or Cmd+Shift+G', 'Ungroup'],
  ['Delete', 'Remove the selected layer or focused keyframe'],
  ['K', 'Add a keyframe for the focused property'],
  ['Alt+ArrowUp / Alt+ArrowDown', 'Move the focused layer up or down'],
  ['ArrowLeft / ArrowRight', 'Move the playhead one frame'],
];

export function workspaceFooter(): HTMLElement {
  const shortcutsButton = el('button', {
    type: 'button',
    class: 'button',
    text: 'Keyboard shortcuts',
  });
  shortcutsButton.addEventListener('click', () => {
    openDialog({
      name: 'Keyboard shortcuts',
      opener: shortcutsButton,
      content: (close) =>
        el('div', { class: 'form-grid' }, [
          el('h3', { text: 'Keyboard shortcuts' }),
          el(
            'ul',
            { class: 'list-reset' },
            SHORTCUTS.map(([keys, description]) =>
              el('li', {}, [el('strong', { text: keys }), el('span', { text: ` — ${description}` })]),
            ),
          ),
          (() => {
            const done = el('button', { type: 'button', class: 'button', text: 'Close' });
            done.addEventListener('click', close);
            return done;
          })(),
        ]),
    });
  });

  return el('footer', { role: 'contentinfo', class: 'panel' }, [
    el('div', { class: 'footer-groups' }, [
      el('div', { class: 'footer-group' }, [
        el('span', { class: 'wordmark', text: 'Tinderbox Optics' }),
        link('Open editor ↗', '/projects'),
        el('span', { class: 'caption', text: '© 2026 Tinderbox Optics' }),
      ]),
      el('div', { class: 'footer-group' }, [
        el('h4', { text: 'Product' }),
        link('Editor', '/projects'),
        link('Embeds', '/#published-embeds'),
        link('Versions', '/#every-publish-gets-a-number'),
      ]),
      el('div', { class: 'footer-group' }, [
        el('h4', { text: 'Studio' }),
        link('Release notes', '/#release-notes'),
      ]),
      el('div', { class: 'footer-group' }, [el('h4', { text: 'Help' }), shortcutsButton]),
    ]),
  ]);
}

export function panel(title: string | null, children: Node[], attrs: Record<string, string> = {}): HTMLElement {
  return el('section', { class: 'panel', ...attrs }, [
    title ? el('h3', { text: title }) : null,
    ...children,
  ]);
}

/** The signed-in person comes with the page, so a signed-out visit makes no failing request. */
export function loadMe(): void {
  appState.me = bootstrapMe();
}
