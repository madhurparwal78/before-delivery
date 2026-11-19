import { ApiRequest, errorText } from './api.js';
import { el, status } from './ui.js';
import type { TimelineRoom } from './types.js';
import { setNotice, refreshDeskData, renderTimeline, renderToday } from './desk.js';
import { trapTab } from './newStay.js';

export function openRoomStatusDialog(room: TimelineRoom, opener: HTMLElement): void {
  const dialog = el('div', { class: 'dialog overlay-full', role: 'dialog', 'aria-label': 'Room status' });
  const openerEl = document.activeElement as HTMLElement | null;
  const close = () => {
    dialog.remove();
    if (openerEl && document.contains(openerEl)) openerEl.focus();
  };
  const mk = (label: string, value: string) => {
    const btn = el('button', { text: label }) as HTMLButtonElement;
    btn.addEventListener('click', async () => {
      setNotice('Saving status…');
      const res = await ApiRequest.post(`/api/rooms/${room.id}/status`, { status: value });
      if (res.status === 200) {
        setNotice(`Room ${room.number} is now ${value.replace('_', ' ')}.`);
        close();
        await refreshDeskData();
        renderTimeline();
        renderToday();
      } else {
        setNotice(errorText(res.data) ?? 'Status failed.');
      }
    });
    return btn;
  };
  const buttons = [mk('Dirty', 'dirty'), mk('Clean', 'clean'), mk('Inspected', 'inspected'), mk('Out of order', 'out_of_order')];
  const closeBtn = el('button', { text: 'Close' }) as HTMLButtonElement;
  closeBtn.addEventListener('click', close);
  dialog.append(el('h2', { text: `Room ${room.number} status` }), ...buttons, closeBtn);
  dialog.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); }
    if (ev.key === 'Tab') trapTab(ev, dialog);
  });
  document.body.append(dialog);
  buttons[0].focus();
}
