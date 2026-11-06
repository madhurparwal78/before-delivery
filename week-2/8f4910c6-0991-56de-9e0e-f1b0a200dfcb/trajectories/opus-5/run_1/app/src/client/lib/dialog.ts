import { el, focus } from './dom.js';
import { DURATION, reducedMotion } from './motion.js';

export type DialogHandle = {
  node: HTMLElement;
  body: HTMLElement;
  close(): void;
  closed: Promise<void>;
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trap(node: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.offsetParent !== null);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** A dialog or bottom sheet with a focus trap; Escape closes without saving. */
export function openDialog(options: {
  title: string;
  sheet?: boolean;
  alert?: boolean;
  onClose?: () => void;
  returnFocusTo?: HTMLElement | null;
}): DialogHandle {
  const heading = el('h2', { class: 'dialog-title', id: `dialog-title-${Date.now()}`, text: options.title });
  const body = el('div', { class: 'dialog-body' });
  const panel = el(
    'div',
    {
      role: options.alert ? 'alertdialog' : 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': heading.id,
      class: options.sheet ? 'dialog sheet' : 'dialog',
    },
    [heading, body],
  );
  const backdrop = el('div', { class: 'dialog-backdrop' }, [panel]);
  const previous = options.returnFocusTo ?? (document.activeElement as HTMLElement | null);
  let resolveClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  function close(): void {
    backdrop.remove();
    document.removeEventListener('keydown', onKeyDown, true);
    document.body.classList.remove('dialog-open');
    options.onClose?.();
    if (previous && previous.isConnected) previous.focus();
    resolveClosed();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!backdrop.isConnected) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    trap(panel, event);
  }

  document.addEventListener('keydown', onKeyDown, true);
  document.body.classList.add('dialog-open');
  document.body.append(backdrop);
  if (!reducedMotion()) {
    const frames: Keyframe[] = options.sheet
      ? [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }]
      : [{ opacity: 0, transform: 'scale(0.98)' }, { opacity: 1, transform: 'scale(1)' }];
    panel.animate(frames, {
      duration: options.sheet ? DURATION.middle : DURATION.short,
      easing: 'cubic-bezier(0.16, 0.84, 0.28, 1)',
    });
  } else {
    panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION.short });
  }

  return { node: panel, body, close, closed };
}

export function phoneViewport(): boolean {
  return window.matchMedia('(max-width: 640px)').matches;
}

/** The leave confirmation of an unsent cast request. */
export function confirmLeave(onLeave: () => void): void {
  const dialog = openDialog({ title: 'Leave the cast request?', alert: true });
  const stay = el('button', { type: 'button', class: 'button', text: 'Stay on the form' });
  const leave = el('button', { type: 'button', class: 'button button-quiet', text: 'Leave' });
  dialog.body.append(
    el('p', {
      text: 'Your cast request has not been sent. Your draft stays saved on this device.',
    }),
    el('div', { class: 'dialog-actions' }, [stay, leave]),
  );
  stay.addEventListener('click', () => dialog.close());
  leave.addEventListener('click', () => {
    dialog.close();
    onLeave();
  });
  focus(stay);
}
