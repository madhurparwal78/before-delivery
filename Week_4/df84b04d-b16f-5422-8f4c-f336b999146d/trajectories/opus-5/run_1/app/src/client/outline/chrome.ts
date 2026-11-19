import { el, icon, icons } from '../dom.js';

export interface ToolbarButtons {
  back: HTMLButtonElement;
  forward: HTMLButtonElement;
  home: HTMLButtonElement;
  breadcrumb: HTMLElement;
  search: HTMLInputElement;
  searchCount: HTMLElement;
  searchError: HTMLElement;
  hideCompleted: HTMLButtonElement;
  viewSwitch: HTMLButtonElement;
  share: HTMLButtonElement;
  download: HTMLButtonElement;
  downloadMenu: HTMLElement;
  undo: HTMLButtonElement;
  redo: HTMLButtonElement;
  toolbar: HTMLElement;
}

function iconButton(label: string, path: string, extra = ''): HTMLButtonElement {
  const button = el('button', { type: 'button', class: `icon-button ${extra}`.trim() }, [
    icon(path),
    el('span', { class: 'button-label' }, [label])
  ]);
  button.setAttribute('aria-label', label);
  return button;
}

/** The window toolbar: history, breadcrumb, search, views, share, download and history. */
export function buildToolbar(): ToolbarButtons {
  const back = iconButton('Go back', icons.back, 'compact');
  const forward = iconButton('Go forward', icons.forward, 'compact');
  const home = iconButton('Go home', icons.home, 'compact');
  const breadcrumb = el('nav', { class: 'breadcrumb', 'aria-label': 'Breadcrumb' });
  const search = el('input', {
    type: 'search',
    role: 'searchbox',
    class: 'search-input',
    'aria-label': 'Search outline',
    placeholder: 'Search outline',
    id: 'search-outline',
    autocomplete: 'off'
  });
  const searchCount = el('span', { class: 'search-count' });
  const searchError = el('p', { class: 'field-error search-error' });
  const hideCompleted = el('button', { type: 'button', role: 'switch', class: 'switch' }, [
    el('span', { class: 'switch-track', 'aria-hidden': 'true' }, [el('span', { class: 'switch-knob' })]),
    el('span', { class: 'button-label' }, ['Hide completed'])
  ]);
  hideCompleted.setAttribute('aria-label', 'Hide completed');
  hideCompleted.setAttribute('aria-checked', 'false');
  const viewSwitch = iconButton('Show as board', icons.board);
  const share = iconButton('Share', icons.share);
  const download = iconButton('Download', icons.download);
  download.setAttribute('aria-haspopup', 'menu');
  download.setAttribute('aria-expanded', 'false');
  const downloadMenu = el('div', { role: 'menu', class: 'menu', hidden: true });
  const undo = iconButton('Undo', icons.undo);
  const redo = iconButton('Redo', icons.redo);

  const toolbar = el('div', { class: 'window-toolbar' }, [
    el('div', { class: 'toolbar-group history-group' }, [back, forward, home]),
    breadcrumb,
    el('div', { class: 'toolbar-group search-group' }, [
      el('label', { class: 'visually-hidden', for: 'search-outline' }, ['Search outline']),
      search,
      searchCount,
      searchError
    ]),
    el('div', { class: 'toolbar-group view-group' }, [
      hideCompleted,
      viewSwitch,
      share,
      el('div', { class: 'menu-holder' }, [download, downloadMenu]),
      undo,
      redo
    ])
  ]);

  return {
    back,
    forward,
    home,
    breadcrumb,
    search,
    searchCount,
    searchError,
    hideCompleted,
    viewSwitch,
    share,
    download,
    downloadMenu,
    undo,
    redo,
    toolbar
  };
}

export type BulletAction =
  | 'Indent'
  | 'Outdent'
  | 'Move up'
  | 'Move down'
  | 'Collapse'
  | 'Complete'
  | 'Zoom in'
  | 'Zoom out'
  | 'Mirror'
  | 'Delete bullet';

const ACTION_ICONS: Record<BulletAction, string> = {
  Indent: icons.indent,
  Outdent: icons.outdent,
  'Move up': icons.up,
  'Move down': icons.down,
  Collapse: icons.collapse,
  Complete: icons.complete,
  'Zoom in': icons.zoomIn,
  'Zoom out': icons.zoomOut,
  Mirror: icons.mirror,
  'Delete bullet': icons.trash
};

export interface BulletToolbar {
  element: HTMLElement;
  buttons: Map<BulletAction, HTMLButtonElement>;
}

/** The Bullet actions toolbar, which carries every key's visible equivalent. */
export function buildBulletToolbar(): BulletToolbar {
  const buttons = new Map<BulletAction, HTMLButtonElement>();
  const element = el('div', { role: 'toolbar', class: 'bullet-toolbar', 'aria-label': 'Bullet actions' });
  for (const action of Object.keys(ACTION_ICONS) as BulletAction[]) {
    const button = iconButton(action, ACTION_ICONS[action]);
    if (action === 'Collapse' || action === 'Complete') button.setAttribute('aria-pressed', 'false');
    buttons.set(action, button);
    element.append(button);
  }
  return { element, buttons };
}

export interface AppBar {
  element: HTMLElement;
  sharedButton: HTMLButtonElement;
  sharedMenu: HTMLElement;
  signOut: HTMLButtonElement;
  menuButton: HTMLButtonElement;
}

/** The outline top bar, with the shared-branch menu and sign out. */
export function buildAppBar(): AppBar {
  const sharedButton = el('button', { type: 'button', class: 'text-button shared-button' }, [
    'Shared with you'
  ]);
  sharedButton.setAttribute('aria-haspopup', 'menu');
  sharedButton.setAttribute('aria-expanded', 'false');
  sharedButton.hidden = true;
  const sharedMenu = el('div', { role: 'menu', class: 'menu', hidden: true });
  const signOut = el('button', { type: 'button', class: 'text-button' }, ['Sign out']);
  const menuButton = el('button', { type: 'button', class: 'menu-button' }, [icon(icons.menu)]);
  menuButton.setAttribute('aria-label', 'Menu');
  menuButton.setAttribute('aria-expanded', 'false');
  const links = el('div', { class: 'top-links app-links' }, [
    el('div', { class: 'menu-holder' }, [sharedButton, sharedMenu]),
    signOut
  ]);
  menuButton.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', open ? 'false' : 'true');
    links.classList.toggle('open', !open);
  });
  const element = el('header', { class: 'top-bar' }, [
    el('div', { class: 'top-bar-inner' }, [
      el('a', { class: 'brand', href: '/' }, [
        el('span', { class: 'brand-mark', 'aria-hidden': 'true' }, [
          icon('M12 21V8m0 0L7 4m5 4 5-4M12 14l-4-3m4 3 4-3')
        ]),
        el('span', { class: 'wordmark' }, ['Twigline'])
      ]),
      el('div', { class: 'top-bar-right' }, [links, menuButton])
    ])
  ]);
  return { element, sharedButton, sharedMenu, signOut, menuButton };
}
