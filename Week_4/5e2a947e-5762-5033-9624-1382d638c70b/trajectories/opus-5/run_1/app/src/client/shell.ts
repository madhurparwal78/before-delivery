import { animate, clear, el, on, qs } from './dom.js';
import { api } from './api.js';

let toastMs = 5000;

export function setToastLifetime(ms: number): void {
  toastMs = ms;
}

export function announcements(): HTMLElement {
  let region = qs<HTMLElement>('#announcements');
  if (!region) {
    region = el('div', {
      id: 'announcements',
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Map announcements',
      class: 'sr-only',
    });
    document.body.append(region);
  }
  return region;
}

export function noticesRegion(): HTMLElement {
  let region = qs<HTMLElement>('#notices');
  if (!region) {
    region = el('div', { id: 'notices', role: 'region', 'aria-label': 'Notices', class: 'notices' });
    document.body.append(region);
  }
  return region;
}

export function announce(text: string): void {
  if (text === '') return;
  const region = announcements();
  region.append(el('p', { text }));
  while (region.childElementCount > 24) region.firstElementChild?.remove();
}

export function toast(text: string, kind: 'plain' | 'warning' = 'plain'): void {
  if (text === '') return;
  const node = el('div', { class: `toast toast-${kind}`, role: 'group' }, [
    kind === 'warning' ? el('span', { class: 'toast-mark', 'aria-hidden': 'true' }) : null,
    el('span', { class: 'toast-text', text }),
  ]);
  noticesRegion().append(node);
  animate(node, 'toast-enter', [{ opacity: 0 }, { opacity: 1 }], 120);
  window.setTimeout(() => node.remove(), toastMs);
}

export function notify(text: string, kind: 'plain' | 'warning' = 'plain'): void {
  announce(text);
  toast(text, kind);
}

/** Keeps Tab and Shift+Tab inside a dialog, sheet, drawer or menu while it is open. */
export interface Trap {
  close: () => void;
  node: HTMLElement;
}

const openTraps: Trap[] = [];

function focusables(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((node) => node.offsetParent !== null || node === document.activeElement);
}

export interface TrapOptions {
  escapable?: boolean;
  onClose?: () => void;
  returnFocusTo?: HTMLElement | null;
}

export function trapFocus(node: HTMLElement, options: TrapOptions = {}): Trap {
  const opener =
    options.returnFocusTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const trap: Trap = {
    node,
    close: () => {
      const index = openTraps.indexOf(trap);
      if (index >= 0) openTraps.splice(index, 1);
      node.remove();
      options.onClose?.();
      opener?.focus();
    },
  };
  openTraps.push(trap);
  on(node, 'keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    if (key === 'Escape' && options.escapable !== false) {
      event.stopPropagation();
      event.preventDefault();
      trap.close();
      return;
    }
    if (key !== 'Tab') return;
    const items = focusables(node);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if ((event as KeyboardEvent).shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!(event as KeyboardEvent).shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  });
  const items = focusables(node);
  (items[0] ?? node).focus();
  return trap;
}

export interface DialogOptions extends TrapOptions {
  title: string;
  className?: string;
  role?: 'dialog' | 'menu';
  bottomSheet?: boolean;
}

export function openDialog(
  options: DialogOptions,
  build: (close: () => void, body: HTMLElement) => void,
): Trap {
  const body = el('div', { class: 'dialog-body' });
  const card = el(
    'div',
    {
      class: `dialog-card ${options.className ?? ''} ${options.bottomSheet ? 'sheet' : ''}`,
      role: options.role ?? 'dialog',
      'aria-modal': 'true',
      'aria-label': options.title,
    },
    [body],
  );
  const scrim = el('div', { class: 'scrim' }, [card]);
  document.body.append(scrim);
  const trap = trapFocus(scrim, {
    ...options,
    onClose: options.onClose,
  });
  build(trap.close, body);
  const items = focusables(scrim);
  (items[0] ?? card).focus();
  return trap;
}

export interface InboxItem {
  id: string;
  map_id: string;
  topic_id: string;
  comment_id: string;
  by: string;
  read: boolean;
}

const inboxPainters = new Set<(count: number) => void>();

/** Keeps every `Inbox (<n>)` button current after a live mention. */
export function refreshInbox(): void {
  void api
    .get<{ mentions: InboxItem[]; unread: number }>('/api/inbox')
    .then((result) => {
      for (const paint of inboxPainters) paint(result.unread);
    })
    .catch(() => undefined);
}

export function inboxButton(onOpen?: () => void): HTMLButtonElement {
  const button = el('button', { type: 'button', class: 'inbox-button' });
  const paint = (count: number): void => {
    button.setAttribute('aria-label', `Inbox (${count})`);
    button.textContent = `Inbox (${count})`;
  };
  paint(0);
  inboxPainters.add(paint);
  refreshInbox();
  on(button, 'click', () => {
    onOpen?.();
    void openInbox(button, paint);
  });
  return button;
}

async function openInbox(opener: HTMLElement, paint: (count: number) => void): Promise<void> {
  const result = await api.get<{ mentions: InboxItem[]; unread: number }>('/api/inbox');
  openDialog({ title: 'Inbox', returnFocusTo: opener }, (close, body) => {
    body.append(el('h2', { text: 'Inbox' }));
    const list = el('div', { class: 'inbox-list' });
    for (const mention of result.mentions) {
      const link = el('a', {
        href: `/m/${mention.map_id}?topic=${mention.topic_id}&comment=${mention.comment_id}`,
        class: mention.read ? 'read' : 'unread',
        text: `${mention.by} mentioned you`,
      });
      on(link, 'click', () => {
        void api.post(`/api/inbox/${mention.id}/read`).then((answer) => {
          paint((answer as { unread: number }).unread);
        });
      });
      list.append(link);
    }
    if (result.mentions.length === 0) list.append(el('p', { text: 'No mentions yet.' }));
    body.append(list);
    const done = el('button', { type: 'button', class: 'secondary', text: 'Close' });
    on(done, 'click', close);
    body.append(done);
  });
  paint(result.unread);
}

export function appRoot(): HTMLElement {
  const root = qs<HTMLElement>('#app');
  if (!root) throw new Error('the app root is missing');
  return root;
}

export function resetScreen(): HTMLElement {
  const root = appRoot();
  clear(root);
  for (const scrim of document.querySelectorAll('.scrim')) scrim.remove();
  return root;
}
