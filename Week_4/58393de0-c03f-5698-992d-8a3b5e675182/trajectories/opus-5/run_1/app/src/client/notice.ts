import { el, icon } from './dom.js';
import { say } from './status.js';

export interface NoticeItem {
  id: string;
  text: string;
  actions?: { label: string; run: () => void }[];
}

const items: NoticeItem[] = [];
let band: HTMLElement | null = null;

export const noticeBand = (): HTMLElement => {
  if (!band) band = el('div', { id: 'qy-notice-host' });
  return band;
};

/** Every standing notice is its own item in the one full-width band under the header. */
export const addNotice = (item: NoticeItem): void => {
  const existing = items.findIndex((candidate) => candidate.id === item.id);
  if (existing >= 0) items.splice(existing, 1);
  items.push(item);
  say(item.text);
  renderNotices();
};

export const removeNotice = (id: string): void => {
  const index = items.findIndex((candidate) => candidate.id === id);
  if (index < 0) return;
  items.splice(index, 1);
  renderNotices();
};

export const clearNotices = (): void => {
  items.length = 0;
  renderNotices();
};

export const renderNotices = (): void => {
  const host = noticeBand();
  host.replaceChildren();
  if (items.length === 0) return;
  const region = el('section', { role: 'region', 'aria-label': 'Notice', class: 'qy-notice' });
  const list = el('ul', { class: 'qy-notice-list' });
  for (const item of items) {
    const row = el('li', { class: 'qy-notice-item' }, [icon('info', 'qy-notice-icon'), el('span', { text: item.text })]);
    for (const action of item.actions ?? []) {
      const control = el('button', { type: 'button', class: 'qy-pill qy-pill-quiet', text: action.label });
      control.addEventListener('click', action.run);
      row.append(control);
    }
    list.append(row);
  }
  region.append(list);
  host.append(region);
};
