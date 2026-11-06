import type { StaffFlag } from '../../shared/types.js';
import { ApiFailure, isCurrent, request } from '../api.js';
import type { Mounted, ScreenFactory } from '../app.js';
import { button, el, setText, trapFocus } from '../dom.js';

/** The open client flags, newest first, each replied to once. */
export const flagsScreen: ScreenFactory = (shell): Mounted => {
  const status = el('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Flags status',
    class: 'live-region',
  });
  shell.registerRegion('Flags status', status);

  const list = el('ul', { 'aria-label': 'Open flags', class: 'flag-list' });
  const node = el('section', { class: 'flags' }, [
    el('h1', {}, ['Client flags']),
    status,
    list,
  ]);

  function openReplyDialog(flag: StaffFlag, opener: HTMLButtonElement, item: HTMLElement): void {
    const text = el('textarea', { id: 'flag-reply', rows: '4' });
    const message = el('p', { class: 'field-error' });
    const send = button('Send reply', { class: 'primary' });
    const dialog = el(
      'div',
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Reply to flag', class: 'dialog' },
      [
        el('div', { class: 'dialog-card' }, [
          el('h2', {}, ['Reply to flag']),
          el('div', { class: 'field' }, [
            el('label', { for: 'flag-reply' }, ['Reply']),
            text,
            message,
          ]),
          send,
        ]),
      ],
    );
    const close = (): void => {
      shell.openDialogs.delete(dialog);
      dialog.remove();
      if (document.contains(opener)) opener.focus();
    };
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      trapFocus(dialog, event);
    });
    send.addEventListener('click', () => {
      const at = shell.generation;
      void request(`/api/flags/${flag.id}/reply`, { method: 'POST', body: { text: text.value } })
        .then(() => {
          if (!isCurrent(at)) return;
          setText(status, `Reply sent for ${flag.line_label}`);
          close();
          item.remove();
        })
        .catch((error: unknown) => {
          if (error instanceof ApiFailure) setText(message, error.body.errors?.text ?? error.message);
        });
    });
    shell.openDialogs.add(dialog);
    node.append(dialog);
    text.focus();
  }

  const at = shell.generation;
  void request<StaffFlag[]>('/api/flags?state=open')
    .then((flags) => {
      if (!isCurrent(at)) return;
      list.replaceChildren(
        ...flags.map((flag) => {
          const reply = button(`Reply to ${flag.line_label}`, { class: 'small' });
          const item = el('li', {}, [
            `${flag.client_name} · ${flag.mission_name} · ${flag.line_label} · ${flag.comment}`,
            reply,
          ]);
          reply.addEventListener('click', () => openReplyDialog(flag, reply, item));
          return item;
        }),
      );
    })
    .catch(() => undefined);

  return { node, dispose: () => shell.unregisterRegion('Flags status') };
};
