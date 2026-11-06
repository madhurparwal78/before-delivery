import { element } from '../dom';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type SheetStyle = 'centre' | 'bottom-sheet' | 'side-sheet';

export interface DialogOptions {
  readonly name: string;
  readonly style?: SheetStyle;
  readonly build: (controller: DialogController) => {
    readonly body: ReadonlyArray<Node>;
    readonly first: () => HTMLElement | null;
  };
}

export interface DialogController {
  close(): void;
}

/**
 * A dialog or sheet that keeps Tab inside, closes on Escape and returns focus
 * to the control that opened it. A closed one is not in the document at all,
 * so nothing inside it is visible, focusable or in the accessibility tree.
 */
export class Dialog {
  private host: HTMLElement | null = null;
  private closeTimer: number | null = null;
  private opener: HTMLElement | null = null;
  private firstControl: (() => HTMLElement | null) | null = null;

  constructor(
    private readonly layer: HTMLElement,
    private readonly options: DialogOptions,
  ) {}

  get isOpen(): boolean {
    return this.host !== null && !this.host.classList.contains('closing');
  }

  open(opener: HTMLElement | null): void {
    if (this.closeTimer !== null) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    if (this.host !== null) {
      this.host.classList.remove('closing');
      this.focusFirst();
      return;
    }
    this.opener = opener;
    const panel = element('div', {
      className: `dialog-panel ${this.options.style ?? 'centre'}`,
      attributes: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': this.options.name,
      },
    });
    const built = this.options.build({ close: () => this.close() });
    this.firstControl = built.first;
    for (const child of built.body) panel.append(child);
    const host = element('div', { className: 'dialog-host', children: [panel] });
    host.addEventListener('keydown', (event) => this.onKeyDown(event));
    host.addEventListener('mousedown', (event) => {
      if (event.target === host) this.close();
    });
    this.host = host;
    this.layer.append(host);
    this.focusFirst();
  }

  private focusFirst(): void {
    const control = this.firstControl === null ? null : this.firstControl();
    if (control !== null) {
      control.focus();
      return;
    }
    const fallback = this.host?.querySelector<HTMLElement>(FOCUSABLE) ?? null;
    fallback?.focus();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== 'Tab' || this.host === null) return;
    const stops = [...this.host.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (node) => node.offsetParent !== null || node === document.activeElement,
    );
    if (stops.length === 0) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
  }

  close(): void {
    if (this.host === null) return;
    const host = this.host;
    host.classList.add('closing');
    const opener = this.opener;
    this.closeTimer = window.setTimeout(() => {
      host.remove();
      if (this.host === host) {
        this.host = null;
        this.firstControl = null;
      }
      this.closeTimer = null;
      opener?.focus();
    }, 320);
  }

  /** Discards the panel at once, without its closing motion. */
  destroy(): void {
    if (this.closeTimer !== null) window.clearTimeout(this.closeTimer);
    this.closeTimer = null;
    this.host?.remove();
    this.host = null;
  }
}

export function dialogActions(...nodes: ReadonlyArray<Node>): HTMLElement {
  return element('div', { className: 'dialog-actions', children: [...nodes] });
}
