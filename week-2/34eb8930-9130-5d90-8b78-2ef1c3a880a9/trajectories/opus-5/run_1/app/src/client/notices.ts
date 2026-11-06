import { api } from './api.js';
import { clear, el, escapeCloses, trapFocus } from './dom.js';
import { navigate } from './shell.js';
import type { Connection } from './socket.js';
import type { Notice } from '../shared/types.js';

export interface NoticesControl {
  button: HTMLButtonElement;
  refresh: () => Promise<void>;
}

/** The Notices button and dialog, shared by the home and the editor. */
export function noticesControl(connection: Connection, onOpen?: (notice: Notice) => void): NoticesControl {
  const badge = el('span', { class: 'badge', hidden: true });
  const button = el('button', { type: 'button', class: 'chrome-button', 'aria-label': 'Notices' }, ['Notices', badge]);
  let dialog: HTMLElement | null = null;
  let notices: Notice[] = [];

  const close = (): void => {
    if (!dialog) return;
    dialog.remove();
    dialog = null;
    button.focus();
  };

  const openNotice = async (notice: Notice): Promise<void> => {
    await api.readNotice(notice.id).catch(() => undefined);
    close();
    await refresh();
    if (onOpen) onOpen(notice);
    const target = `/d/${notice.documentId}`;
    if (location.pathname !== target) navigate(target);
  };

  const open = (): void => {
    if (dialog) {
      close();
      return;
    }
    const list = el('ul', { class: 'notice-list', 'aria-label': 'Notices' });
    for (const notice of notices) {
      list.appendChild(
        el('li', {}, [
          el(
            'a',
            {
              href: `/d/${notice.documentId}`,
              class: notice.read ? 'notice read' : 'notice',
              onclick: (event: Event) => {
                event.preventDefault();
                void openNotice(notice);
              },
            },
            [notice.text],
          ),
        ]),
      );
    }
    if (notices.length === 0) list.appendChild(el('li', { class: 'empty', text: 'No notices yet.' }));
    dialog = el('div', { class: 'popover', role: 'dialog', 'aria-label': 'Notices', 'aria-modal': 'false' }, [
      el('h2', { class: 'popover-title', text: 'Notices' }),
      list,
      el('button', { type: 'button', class: 'chrome-button', text: 'Close', onclick: close }),
    ]);
    trapFocus(dialog);
    escapeCloses(dialog, close);
    button.parentElement?.appendChild(dialog);
    const first = dialog.querySelector<HTMLElement>('a, button');
    first?.focus();
  };

  button.addEventListener('click', open);

  const refresh = async (): Promise<void> => {
    const result = await api.notices().catch(() => null);
    if (!result) return;
    notices = result.notices;
    badge.textContent = String(result.unread);
    badge.toggleAttribute('hidden', result.unread === 0);
    if (dialog) {
      const list = dialog.querySelector('.notice-list');
      if (list) {
        clear(list);
        for (const notice of notices) {
          list.appendChild(
            el('li', {}, [
              el(
                'a',
                {
                  href: `/d/${notice.documentId}`,
                  class: notice.read ? 'notice read' : 'notice',
                  onclick: (event: Event) => {
                    event.preventDefault();
                    void openNotice(notice);
                  },
                },
                [notice.text],
              ),
            ]),
          );
        }
      }
    }
  };

  connection.onFrame((frame) => {
    if (frame.type === 'notice' || frame.type === 'lists_changed') void refresh();
  });
  void refresh();
  return { button, refresh };
}
