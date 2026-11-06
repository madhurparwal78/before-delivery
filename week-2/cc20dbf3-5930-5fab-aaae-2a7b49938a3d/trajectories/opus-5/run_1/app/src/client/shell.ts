import { request } from './api.js';
import type { LibrarySettings, User } from '../shared/api.js';
import { rememberLibrary } from './format.js';
import { append, clear, element } from './ui/dom.js';

export interface Screen {
  readonly node: HTMLElement;
  start?(): void;
  stop?(): void;
}

export interface AppState {
  user: User | null;
  library: LibrarySettings | null;
}

export const state: AppState = { user: null, library: null };

export function homePath(user: User): string {
  return user.role === 'member' ? '/catalogue' : '/counter';
}

export function isStaff(user: User | null): boolean {
  return user !== null && (user.role === 'volunteer' || user.role === 'founder');
}

let navigateTo: (path: string, replace?: boolean) => void = () => {};

export function registerNavigate(handler: (path: string, replace?: boolean) => void): void {
  navigateTo = handler;
}

export function navigate(path: string, replace = false): void {
  navigateTo(path, replace);
}

export async function loadLibrary(): Promise<void> {
  if (state.library !== null) return;
  const settings = await request<LibrarySettings>('/api/library');
  state.library = settings;
  rememberLibrary(settings);
}

function navigationLinks(user: User, path: string): HTMLElement {
  const links: Array<[string, string]> = [['Catalogue', '/catalogue']];
  if (user.role === 'member') links.push(['My loans', '/my-loans']);
  else links.push(['Counter', '/counter']);
  if (user.role === 'founder') links.push(['Ledger', '/ledger']);
  const navigation = element('nav', { class: 'main', 'aria-label': 'Main', 'data-open': 'false' });
  for (const [label, href] of links) {
    navigation.appendChild(
      element(
        'a',
        href === path ? { href, 'aria-current': 'page' } : { href },
        [label],
      ),
    );
  }
  return navigation;
}

/** The header band: wordmark, navigation and sign out, in reading order. */
export function buildShell(path: string, content: HTMLElement): HTMLElement {
  const band = element('header', { class: 'band' }, [
    element('a', { class: 'wordmark', href: state.user === null ? '/' : homePath(state.user) }, [
      'Common Shed Co.',
    ]),
  ]);

  if (state.user !== null) {
    const navigation = navigationLinks(state.user, path);
    const menu = element('button', {
      class: 'menu-button',
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': 'main-navigation',
    });
    menu.textContent = 'Menu';
    navigation.id = 'main-navigation';
    const toggle = (open: boolean): void => {
      navigation.setAttribute('data-open', open ? 'true' : 'false');
      menu.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    menu.addEventListener('click', () => {
      toggle(navigation.getAttribute('data-open') !== 'true');
    });
    navigation.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        toggle(false);
        menu.focus();
      }
    });
    menu.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        toggle(false);
        menu.focus();
      }
    });

    const signOut = element('button', { type: 'button' });
    signOut.textContent = 'Sign out';
    signOut.addEventListener('click', () => {
      void request('/api/session', { method: 'DELETE' }).then(() => {
        state.user = null;
        navigate('/', true);
      });
    });

    append(band, [menu, navigation, signOut]);
  }

  const main = element('main', { id: 'content', tabindex: '-1' }, [content]);
  return element('div', { class: 'shell' }, [
    element('a', { class: 'skip', href: '#content' }, ['Skip to content']),
    band,
    main,
  ]);
}

export function mount(root: HTMLElement, node: HTMLElement): void {
  clear(root);
  root.appendChild(node);
}
