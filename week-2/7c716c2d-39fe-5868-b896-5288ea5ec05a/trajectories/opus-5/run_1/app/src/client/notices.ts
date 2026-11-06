import { copy } from './copy.js';
import { el } from './dom.js';
import { noticesRegion, shellIsBuilt } from './shell.js';
import { isOwner, state } from './store.js';

type Notice = { key: string; text: string };

const shown = new Map<string, HTMLElement>();

function seatLimit(): number {
  return state.workspace?.seats?.limit ?? state.billing?.limit ?? 0;
}

function activeNotices(onSettings: boolean): Notice[] {
  const notices: Notice[] = [];
  if (state.status.database === 'unavailable') notices.push({ key: 'database', text: copy.noticeDatabase });
  if (state.status.storage === 'unavailable' && state.person !== null) {
    notices.push({ key: 'storage', text: copy.noticeStorage });
  }
  if (state.status.billing === 'unavailable' && isOwner() && onSettings) {
    notices.push({ key: 'billing', text: copy.noticeBilling(seatLimit()) });
  }
  const held = state.status.held_mail;
  if (isOwner() && state.status.mail === 'delayed' && held !== null && held > 0) {
    notices.push({ key: 'mail', text: copy.noticeMail(held) });
  }
  return notices;
}

/** Notices appear and clear in place, without touching focus, drafts or scroll. */
export function renderNotices(): void {
  if (!shellIsBuilt()) return;
  const region = noticesRegion();
  const onSettings = window.location.pathname === '/settings';
  const wanted = activeNotices(onSettings);
  const wantedKeys = new Set(wanted.map((notice) => notice.key));
  for (const [key, node] of [...shown]) {
    if (!wantedKeys.has(key)) {
      node.remove();
      shown.delete(key);
    }
  }
  for (const notice of wanted) {
    const existing = shown.get(notice.key);
    if (existing === undefined) {
      const node = el('div', { role: 'alert', class: 'notice', text: notice.text });
      region.append(node);
      shown.set(notice.key, node);
    } else if (existing.textContent !== notice.text) {
      existing.textContent = notice.text;
    }
  }
}

export function clearNotices(): void {
  shown.clear();
}
