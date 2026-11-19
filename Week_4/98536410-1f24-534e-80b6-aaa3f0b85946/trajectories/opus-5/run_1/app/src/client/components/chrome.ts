import { announce, el, on } from '../lib/dom.js';
import { closeWithMotion, openWithMotion } from '../lib/motion.js';
import { focusFirst, trapFocus } from '../lib/focus.js';
import type { Trap } from '../lib/focus.js';
import { COPY } from '../lib/copy.js';
import { landingRoute, maybeMe } from '../lib/state.js';
import type { Me } from '../lib/state.js';
import { navigate, signOut } from '../router.js';

export function wordmark(): HTMLElement {
  return el('div', { class: 'corner-wordmark', 'aria-hidden': 'true' }, [
    el('span', { class: 'corner-wordmark-top' }, 'TRAMELA'),
    el('span', { class: 'corner-wordmark-bottom' }, 'ESTATE'),
  ]);
}

const storeNames = new Map<string, string>();

export function rememberStoreNames(stores: { id: string; name: string }[]): void {
  for (const store of stores) storeNames.set(store.id, store.name);
  for (const select of document.querySelectorAll<HTMLSelectElement>('select.shop-switcher')) {
    for (const option of select.options) option.textContent = storeName(option.value);
  }
}

function storeName(storeId: string): string {
  return storeNames.get(storeId) ?? storeId;
}

function shopSwitcher(me: Me, focusId: string): HTMLElement {
  const select = el('select', {
    class: 'shop-switcher',
    'aria-label': 'Shop',
    'data-focus-id': focusId,
  });
  const current = location.pathname.startsWith('/shop/') ? location.pathname.slice(6) : '';
  for (const storeId of [...me.store_ids].sort()) {
    const option = el('option', { value: storeId }, storeName(storeId));
    if (storeId === current) option.selected = true;
    select.appendChild(option);
  }
  on(select, 'change', () => navigate(`/shop/${select.value}`));
  return select;
}

export function signedOutHeader(): HTMLElement {
  const link = el(
    'a',
    { class: 'wordmark-link', href: '/', 'data-focus-id': 'wordmark' },
    'Tramela Estate',
  );
  on(link, 'click', (event) => {
    event.preventDefault();
    navigate('/');
  });
  return el('header', { class: 'app-header signed-out' }, [link]);
}

export function signedInHeader(): HTMLElement {
  const me = maybeMe();
  if (!me) return signedOutHeader();

  const home = landingRoute(me.user.role, me.store_ids);
  const link = el(
    'a',
    { class: 'wordmark-link', href: home, 'data-focus-id': 'wordmark' },
    'Tramela Estate',
  );
  on(link, 'click', (event) => {
    event.preventDefault();
    navigate(home);
  });

  const out = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'sign-out' },
    'Sign out',
  );
  on(out, 'click', () => void signOut());

  const menuButton = el(
    'button',
    {
      type: 'button',
      class: 'block-button header-menu-button',
      'aria-expanded': 'false',
      'data-focus-id': 'menu',
    },
    'Menu',
  );

  const sheetSignOut = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'menu-sign-out' },
    'Sign out',
  );
  on(sheetSignOut, 'click', () => void signOut());

  const closeMenu = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'close-menu' },
    'Close menu',
  );

  const sheet = el(
    'div',
    {
      class: 'header-menu',
      role: 'dialog',
      'aria-label': 'Menu',
      'aria-modal': 'true',
      'data-state': 'closed',
    },
    [
      el('p', { class: 'operator-name' }, me.operator.name),
      ...(me.user.role === 'manager'
        ? [el('label', { class: 'field' }, [el('span', {}, 'Shop'), shopSwitcher(me, 'menu-shop')])]
        : []),
      sheetSignOut,
      closeMenu,
    ],
  );

  let trap: Trap | null = null;
  const shut = (): void => {
    menuButton.setAttribute('aria-expanded', 'false');
    trap?.release();
    trap = null;
    closeWithMotion(sheet);
    menuButton.focus();
  };
  on(closeMenu, 'click', shut);
  on(menuButton, 'click', () => {
    if (menuButton.getAttribute('aria-expanded') === 'true') {
      shut();
      return;
    }
    menuButton.setAttribute('aria-expanded', 'true');
    openWithMotion(sheet);
    trap = trapFocus(sheet, shut);
    focusFirst(sheet);
  });

  const desktop = el('div', { class: 'header-desktop' }, [
    el('span', { class: 'operator-name' }, me.operator.name),
    ...(me.user.role === 'manager'
      ? [
          el('label', { class: 'field inline' }, [
            el('span', {}, 'Shop'),
            shopSwitcher(me, 'shop-switcher'),
          ]),
        ]
      : []),
    out,
  ]);

  return el('header', { class: 'app-header' }, [link, desktop, menuButton, sheet]);
}

let noticeNode: HTMLElement | null = null;
let storageDown = false;

export function storageNotice(): HTMLElement {
  const node = el(
    'div',
    {
      class: 'storage-notice',
      role: 'status',
      'aria-label': 'Storage notice',
      'data-state': storageDown ? 'open' : 'closed',
    },
    storageDown ? COPY.storageNotice : '',
  );
  noticeNode = node;
  return node;
}

export function isStorageDown(): boolean {
  return storageDown;
}

type StorageListener = (down: boolean) => void;
const storageListeners = new Set<StorageListener>();

export function onStorageChange(listener: StorageListener): () => void {
  storageListeners.add(listener);
  listener(storageDown);
  return () => {
    storageListeners.delete(listener);
  };
}

export function applyStorageState(down: boolean): void {
  storageDown = down;
  const node = noticeNode;
  if (node && document.contains(node)) {
    if (down) {
      announce(node, COPY.storageNotice);
      if (node.dataset['state'] !== 'open' && node.dataset['state'] !== 'opening') {
        openWithMotion(node);
      }
    } else if (node.dataset['state'] === 'open' || node.dataset['state'] === 'opening') {
      closeWithMotion(node, () => {
        node.textContent = '';
      });
    }
  }
  for (const listener of storageListeners) listener(down);
}

/** The three storage controls stay in place, aria-disabled and described by their reason. */
export function pauseControl(
  control: HTMLElement,
  descriptionId: string,
  sentence: string,
  paused: boolean,
): void {
  control.setAttribute('aria-disabled', paused ? 'true' : 'false');
  let description = document.getElementById(descriptionId);
  if (!description) {
    description = el('span', { id: descriptionId, class: 'pause-reason' });
    control.after(description);
  }
  description.textContent = paused ? sentence : '';
  if (paused) control.setAttribute('aria-describedby', descriptionId);
  else control.removeAttribute('aria-describedby');
}
