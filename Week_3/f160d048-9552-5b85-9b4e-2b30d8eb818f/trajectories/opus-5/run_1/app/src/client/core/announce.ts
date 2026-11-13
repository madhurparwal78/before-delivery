import { el } from './dom';

let region: HTMLElement | null = null;

/** The one polite announcements region every page carries. */
export function announcementRegion(): HTMLElement {
  if (!region) {
    region = el('div', {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Announcements',
      class: 'visually-hidden',
    });
  }
  return region;
}

export function announce(text: string): void {
  const node = announcementRegion();
  node.textContent = '';
  window.setTimeout(() => {
    node.textContent = text;
  }, 20);
}
