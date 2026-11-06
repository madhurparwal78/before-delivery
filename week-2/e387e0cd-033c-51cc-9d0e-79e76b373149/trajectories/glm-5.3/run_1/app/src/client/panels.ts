// Dialogs, sheets and menus. Focus moves to the first control on open, Tab
// wraps inside, Escape closes and returns focus to the opener. A closed panel
// is hidden and inert; reopening during the closing motion keeps it open.
import { h, reducedMotion } from './dom.js';

const OPEN_MOTION_MS = 320;

interface OpenPanel {
  el: HTMLElement;
  opener: HTMLElement | null;
  cleanup: () => void;
}

let openPanels: OpenPanel[] = [];
const closingPanels: { name: string; cancel: () => void }[] = [];
const panelClosers = new WeakMap<OpenPanel, () => void>();

export function isModalOpen(): boolean {
  return openPanels.length > 0;
}

export function topPanel(): OpenPanel | undefined {
  return openPanels[openPanels.length - 1];
}

function inertPage(on: boolean): void {
  document.querySelectorAll('body > *:not([data-panel-layer])').forEach((el) => {
    (el as HTMLElement).inert = on;
  });
}

export interface PanelHandle { close: () => void; el: HTMLElement }

export function openDialog(opts: {
  name: string;
  kind: 'dialog' | 'sheet';
  first?: 'firstControl';
  build: (dialog: HTMLElement) => void;
  opener: HTMLElement;
  onClose: () => void;
  stickyBar?: boolean;
}): { close: () => void; el: HTMLElement } {
  // A pending close never hides a reopened panel: a same-named panel that is
  // still closing is brought back instead of opening a new one.
  const closingIndex = closingPanels.findIndex((entry) => entry.name === opts.name);
  if (closingIndex >= 0) {
    const entry = closingPanels[closingIndex];
    closingPanels.splice(closingIndex, 1);
    entry.cancel();
    const existing = openPanels.find((panel) => panel.el.getAttribute('aria-label') === opts.name);
    if (existing !== undefined) {
      const existingClose = panelClosers.get(existing);
      if (existingClose !== undefined) {
        opts.opener.focus();
        return { close: existingClose, el: existing.el };
      }
    }
  }
  const layer = h('div', { 'data-panel-layer': 'true', class: 'panel-layer' });
  const dialog = h('div', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': opts.name,
    class: opts.kind === 'sheet' ? 'sheet' : 'dialog',
    'data-motion': reducedMotion() ? 'none' : 'in',
  });
  const panel: OpenPanel = { el: dialog, opener: opts.opener, cleanup: () => {
    layer.remove();
    document.body.classList.remove('has-panel');
    if (openPanels.length === 0) inertPage(false);
  } };

  let closed = false;
  let reopenRequested = false;
  const close = (): void => {
    if (closed) return;
    reopenRequested = false;
    dialog.classList.add('closing');
    const finish = (): void => {
      closed = true;
      openPanels = openPanels.filter((p) => p.el !== dialog);
      panel.cleanup();
      opts.onClose();
      if (openPanels.length === 0) {
        if (opts.opener.isConnected) opts.opener.focus();
      }
    };
    if (reducedMotion()) {
      finish();
      return;
    }
    dialog.dataset.motion = 'out';
    const entry = { name: opts.name, cancel: () => {
      reopenRequested = true;
    } };
    closingPanels.push(entry);
    setTimeout(() => {
      const index = closingPanels.indexOf(entry);
      if (index >= 0) closingPanels.splice(index, 1);
      if (reopenRequested) {
        reopenRequested = false;
        dialog.classList.remove('closing');
        dialog.dataset.motion = 'in';
        return;
      }
      finish();
    }, OPEN_MOTION_MS);
  };

  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab') {
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
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

  panelClosers.set(panel, close);
  layer.append(dialog);
  layer.addEventListener('pointerdown', (e) => {
    if (e.target === layer) close();
  });
  opts.build(dialog);
  document.body.append(layer);
  document.body.classList.add('has-panel');
  inertPage(true);
  openPanels.push(panel);
  const firstControl = dialog.querySelector<HTMLElement>('button, [href], input, select, textarea');
  if (firstControl !== null) firstControl.focus();
  return { close, el: dialog } as PanelHandle;
}

