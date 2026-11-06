import { append, el, focusables, keepClear, type Child } from './dom.js';
import { reducedMotion, STATE_MS } from './motion.js';

export type DialogKind = 'dialog' | 'sheet' | 'menu';

export interface DialogHandle {
  readonly root: HTMLElement;
  close(): void;
}

export interface DialogSpec {
  readonly name: string;
  readonly kind?: DialogKind;
  readonly opener: HTMLElement | null;
  build(handle: DialogHandle): { body: Child[]; first: () => HTMLElement | null };
}

interface LiveDialog {
  readonly overlay: HTMLElement;
  readonly opener: HTMLElement | null;
  exitTimer: number | null;
}

const open = new Map<string, LiveDialog>();

function app(): HTMLElement | null {
  return document.getElementById('app');
}

function setBackgroundInert(inert: boolean): void {
  const host = app();
  if (host === null) return;
  if (inert) host.setAttribute('inert', '');
  else host.removeAttribute('inert');
}

export function openDialog(spec: DialogSpec): DialogHandle {
  const existing = open.get(spec.name);
  if (existing !== undefined) {
    // Reopening during the exit keeps it open, with no leftover timer.
    if (existing.exitTimer !== null) {
      window.clearTimeout(existing.exitTimer);
      existing.exitTimer = null;
      existing.overlay.classList.remove('is-exiting');
    }
    const first = existing.overlay.querySelector<HTMLElement>('[data-first]');
    first?.focus();
    return { root: existing.overlay, close: () => closeDialog(spec.name) };
  }

  const headingId = `dialog-heading-${open.size}-${Date.now()}`;
  const panel = el('div', {
    class: `dialog dialog-${spec.kind ?? 'dialog'}`,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': headingId,
  });
  const overlay = el('div', { class: 'dialog-overlay', 'data-dialog': spec.name }, panel);
  const handle: DialogHandle = { root: panel, close: () => closeDialog(spec.name) };
  const built = spec.build(handle);
  append(panel, [el('h2', { class: 'dialog-heading', id: headingId }, spec.name), ...built.body]);

  overlay.addEventListener('keydown', (event) => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.key === 'Escape') {
      keyboard.preventDefault();
      closeDialog(spec.name);
      return;
    }
    if (keyboard.key !== 'Tab') return;
    const stops = focusables(panel);
    if (stops.length === 0) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (keyboard.shiftKey && (active === first || !panel.contains(active))) {
      keyboard.preventDefault();
      last.focus();
    } else if (!keyboard.shiftKey && active === last) {
      keyboard.preventDefault();
      first.focus();
    }
  });
  panel.addEventListener('focusin', (event) => {
    const target = event.target as HTMLElement;
    if (spec.kind === 'sheet') keepClear(target);
  });

  document.body.appendChild(overlay);
  setBackgroundInert(true);
  open.set(spec.name, { overlay, opener: spec.opener, exitTimer: null });
  const first = built.first();
  if (first !== null) {
    first.setAttribute('data-first', '');
    first.focus();
  }
  return handle;
}

export function closeDialog(name: string): void {
  const live = open.get(name);
  if (live === undefined || live.exitTimer !== null) return;
  const finish = (): void => {
    live.overlay.remove();
    open.delete(name);
    if (open.size === 0) setBackgroundInert(false);
    if (live.opener !== null && live.opener.isConnected) live.opener.focus();
  };
  if (reducedMotion()) {
    finish();
    return;
  }
  live.overlay.classList.add('is-exiting');
  live.exitTimer = window.setTimeout(finish, STATE_MS);
}


export function closeAllDialogs(): void {
  for (const [name, live] of [...open.entries()]) {
    if (live.exitTimer !== null) window.clearTimeout(live.exitTimer);
    live.overlay.remove();
    open.delete(name);
  }
  setBackgroundInert(false);
}
