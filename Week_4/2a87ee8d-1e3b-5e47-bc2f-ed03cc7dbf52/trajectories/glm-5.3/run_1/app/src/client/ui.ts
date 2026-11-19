/** Shared client view helpers: element building, live regions, focus management. */
import { escapeHtml } from './polyfill.js';

export function el(html: string): HTMLElement {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild as HTMLElement;
}

export function h(tag: string, attrs: Record<string, string | null> = {}, text?: string): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null) continue;
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

export function iconBtn(name: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = h('button', { 'aria-label': label, title: label }) as HTMLButtonElement;
  b.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ICONS.plus}</svg>`;
  b.addEventListener('click', onClick);
  return b;
}

/** Lucide icon bodies (single-file, ISC). */
export const ICONS: Record<string, string> = {
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  cluster: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  zoomIn: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/>',
  fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
};

export interface LiveRegions {
  activity: HTMLElement;
  problems: HTMLElement;
}

export function liveRegions(): LiveRegions {
  const activity = h('div', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Board activity', class: 'visually-hidden' });
  const problems = h('div', { role: 'alert', 'aria-live': 'assertive', 'aria-label': 'Board problems', class: 'visually-hidden' });
  return { activity, problems };
}

export function announceActivity(regions: LiveRegions, message: string): void {
  regions.activity.textContent = message;
}

export function announceProblem(regions: LiveRegions, message: string): void {
  regions.problems.textContent = message;
}

export function escape(s: string): string {
  return escapeHtml(s);
}

/** A focusable modal dialog that traps focus and returns it on close (DP-42). */
export function openDialog(opts: { label: string; onOpen: (dialog: HTMLDialogElement) => void }): HTMLDialogElement {
  const dialog = el(`<dialog class="room-dialog" aria-label="${escape(opts.label)}"></dialog>`) as HTMLDialogElement;
  document.body.appendChild(dialog);
  const opener = document.activeElement as HTMLElement | null;
  opts.onOpen(dialog);
  dialog.showModal();
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (opener && document.contains(opener)) opener.focus();
  });
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // the browser closes the dialog; the close handler returns focus
    }
    if (e.key === 'Tab') {
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'))
        .filter((n) => !n.hasAttribute('disabled'));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  return dialog;
}
