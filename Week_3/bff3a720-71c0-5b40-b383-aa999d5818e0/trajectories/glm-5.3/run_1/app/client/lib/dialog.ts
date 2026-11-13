import { h } from './els.js';
import { reducedMotion, motionMs } from './announce.js';

/**
 * Dialogs: Tab and Shift+Tab wrap inside, Escape closes, focus returns to the
 * opener. At 375px, `sheet: true` makes it rise from the bottom edge.
 */
export interface DialogOptions {
  label: string;
  sheet?: boolean;
  onClose?: () => void;
  onSwipeDown?: () => void;
}

export function openDialog(opts: DialogOptions, content: HTMLElement | HTMLElement[]): { root: HTMLElement; close: () => void } {
  const opener = document.activeElement as HTMLElement | null;
  const body = Array.isArray(content) ? content : [content];
  const cls = opts.sheet ? 'dialog sheet' : 'dialog';
  const root = h('div', { class: cls, role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.label, 'data-motion': 'sheet', 'data-motion-ms': motionMs(280), 'data-state': opts.sheet ? 'opening' : 'running' },
    h('div', { class: 'dialog-body' }, ...body),
  );
  const overlay = h('div', { class: 'overlay' }, root);

  const close = (): void => {
    root.setAttribute('data-state', opts.sheet ? 'closing' : 'done');
    const finish = (): void => {
      overlay.remove();
      document.body.classList.remove('modal-open');
      opener?.focus();
    };
    if (reducedMotion() || !opts.sheet) finish();
    else window.setTimeout(finish, 280);
    opts.onClose?.();
  };

  root.addEventListener('keydown', (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Escape') {
      ke.preventDefault();
      ke.stopPropagation();
      close();
      return;
    }
    if (ke.key !== 'Tab') return;
    const focusables = Array.from(root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(n => !n.hasAttribute('disabled') && n.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (ke.shiftKey && document.activeElement === first) { ke.preventDefault(); last.focus(); }
    else if (!ke.shiftKey && document.activeElement === last) { ke.preventDefault(); first.focus(); }
  });

  if (opts.sheet) attachSwipeDown(root, () => { if (opts.onSwipeDown) opts.onSwipeDown(); else close(); });

  overlay.addEventListener('mousedown', (e: Event) => {
    if (e.target === overlay) close();
  });
  document.body.append(overlay);
  document.body.classList.add('modal-open');
  window.setTimeout(() => {
    root.setAttribute('data-state', opts.sheet ? 'open' : 'done');
    const focusTarget = root.querySelector<HTMLElement>('[data-autofocus]') ?? firstFocusable(root);
    focusTarget?.focus();
  }, reducedMotion() ? 0 : 30);
  return { root, close };
}

function firstFocusable(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
}

function attachSwipeDown(root: HTMLElement, onClose: () => void): void {
  let startY: number | null = null;
  let curY = 0;
  root.addEventListener('touchstart', (e: TouchEvent) => {
    startY = e.touches[0].clientY;
    curY = startY;
  }, { passive: true });
  root.addEventListener('touchmove', (e: TouchEvent) => {
    if (startY === null) return;
    curY = e.touches[0].clientY;
  }, { passive: true });
  root.addEventListener('touchend', () => {
    if (startY === null) return;
    const dy = curY - startY;
    startY = null;
    if (dy >= 80) onClose();
  });
}
