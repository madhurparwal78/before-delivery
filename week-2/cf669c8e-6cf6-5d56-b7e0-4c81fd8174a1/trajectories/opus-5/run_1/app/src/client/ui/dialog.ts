/**
 * Dialogs, drawers and sheets.
 *
 * A panel takes focus when opened, wraps Tab inside itself, closes on Escape
 * and returns focus to its opener. From the first moment of closing nothing
 * inside is focusable, in the accessibility tree or reachable by click: only
 * the panel's own shell stays visible for the closing motion. Reopening during
 * that motion leaves the panel open.
 */

import { MOTION, el, focusable, prefersReducedMotion } from '../dom.js';

export interface PanelOptions {
  name: string;
  /** Extra class for the shell, which styles the slide or fade. */
  variant: 'dialog' | 'drawer' | 'sheet';
  onClose?: () => void;
}

export class Panel {
  readonly root: HTMLElement;
  readonly content: HTMLElement;
  private readonly shell: HTMLElement;
  private opener: HTMLElement | null = null;
  private closeTimer: number | null = null;
  private state: 'closed' | 'open' | 'closing' = 'closed';

  constructor(private readonly options: PanelOptions) {
    this.content = el('div', { class: 'panel-content' });
    this.shell = el('div', { class: `panel-shell panel-shell--${options.variant}` }, [this.content]);
    this.root = el(
      'div',
      {
        class: `panel panel--${options.variant}`,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': options.name,
        'data-state': 'closed',
        hidden: true,
      },
      [this.shell],
    );

    this.root.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this.close();
    });
  }

  get isOpen(): boolean {
    return this.state === 'open';
  }

  open(opener: HTMLElement | null): void {
    if (this.closeTimer !== null) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    if (opener) this.opener = opener;

    this.content.hidden = false;
    this.root.hidden = false;
    this.root.dataset.state = 'open';
    this.state = 'open';
    opener?.setAttribute('aria-expanded', 'true');

    const first = focusable(this.content)[0];
    (first ?? this.root).focus();
  }

  close(): void {
    if (this.state === 'closed') return;

    // Nothing inside is focusable, visible or clickable from this moment.
    this.content.hidden = true;
    this.root.dataset.state = 'closing';
    this.state = 'closing';
    this.opener?.setAttribute('aria-expanded', 'false');

    const linger = prefersReducedMotion() ? 0 : MOTION.route;
    this.closeTimer = window.setTimeout(() => {
      this.root.hidden = true;
      this.root.dataset.state = 'closed';
      this.state = 'closed';
      this.closeTimer = null;
    }, linger);

    this.returnFocus();
    this.options.onClose?.();
  }

  /** Close with no focus move, for a breakpoint crossing that relocates focus. */
  closeWithoutFocus(): void {
    const opener = this.opener;
    this.opener = null;
    this.close();
    this.opener = opener;
  }

  private returnFocus(): void {
    const opener = this.opener;
    if (!opener) return;
    // Focus never lands on a hidden control.
    const visible = opener.offsetParent !== null || opener.getClientRects().length > 0;
    if (visible) opener.focus();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== 'Tab') return;

    const stops = focusable(this.content);
    if (stops.length === 0) {
      event.preventDefault();
      return;
    }
    const first = stops[0] as HTMLElement;
    const last = stops[stops.length - 1] as HTMLElement;
    const active = document.activeElement;

    if (event.shiftKey && (active === first || active === this.root)) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

/** A list that is one Tab stop, with roving focus between its rows. */
export function rovingList(
  list: HTMLElement,
  rows: () => HTMLElement[],
  onSelect: (row: HTMLElement) => void,
): void {
  const moveTo = (index: number): void => {
    const all = rows();
    const target = all[Math.max(0, Math.min(all.length - 1, index))];
    if (!target) return;
    for (const row of all) row.tabIndex = row === target ? 0 : -1;
    target.focus();
  };

  list.addEventListener('keydown', (event) => {
    const all = rows();
    const active = document.activeElement as HTMLElement | null;
    const index = active ? all.indexOf(active) : -1;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveTo(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveTo(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        moveTo(0);
        break;
      case 'End':
        event.preventDefault();
        moveTo(all.length - 1);
        break;
      case 'Enter':
      case ' ': {
        if (index < 0) break;
        event.preventDefault();
        const row = all[index];
        if (row) onSelect(row);
        break;
      }
      default:
        break;
    }
  });
}
