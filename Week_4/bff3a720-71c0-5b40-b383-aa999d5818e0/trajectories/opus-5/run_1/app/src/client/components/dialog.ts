import { focusables, h } from '../dom.js';
import { runMotion } from '../motion.js';
import { onSwipe } from './swipe.js';

export interface DialogHandle {
  element: HTMLElement;
  close(): void;
}

export interface DialogOptions {
  name: string;
  opener: HTMLElement | null;
  /** The three bottom sheets rise from the bottom edge and close on a downward swipe. */
  sheet?: boolean;
  onClose?: () => void;
  build: (handle: { close: () => void }) => Node[];
  initialFocus?: (element: HTMLElement) => HTMLElement | null;
}

const SWIPE_CLOSE_PX = 80;

export function openDialog(options: DialogOptions): DialogHandle {
  const dialog = h('div', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': options.name,
    class: options.sheet ? 'dialog sheet' : 'dialog',
  });
  const overlay = h('div', { class: 'overlay' }, dialog);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown, true);
    options.onClose?.();
    options.opener?.focus();
    if (options.sheet) {
      // The sheet drops away while already out of reach; it leaves the page when it lands.
      overlay.style.pointerEvents = 'none';
      runMotion(dialog, 'sheet', 'close', () => overlay.remove());
    } else {
      overlay.remove();
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!overlay.isConnected) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables(dialog);
    if (items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  for (const node of options.build({ close })) dialog.appendChild(node);
  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKeyDown, true);

  if (options.sheet) {
    runMotion(dialog, 'sheet', 'open');
    onSwipe(dialog, SWIPE_CLOSE_PX, (direction) => {
      if (direction === 'down') close();
    });
  }

  const target = options.initialFocus?.(dialog) ?? focusables(dialog)[0] ?? dialog;
  target.focus();

  return { element: dialog, close };
}
