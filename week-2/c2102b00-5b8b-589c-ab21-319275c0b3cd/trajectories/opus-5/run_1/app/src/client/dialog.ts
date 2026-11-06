import { el, prefersReducedMotion } from './dom.ts';

export interface DialogSpec {
  title: string;
  build: (body: HTMLElement) => void;
  footer: HTMLElement[];
  initialFocus: () => HTMLElement | null;
  returnFocus: () => HTMLElement | null;
  onEscape?: () => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openCount = 0;

/** One dialog layer: focus trap, Escape, a locked page behind and an exit that a reopen cancels. */
export class Dialog {
  readonly overlay: HTMLElement;
  readonly panel: HTMLElement;
  readonly body: HTMLElement;
  private hideTimer: number | null = null;
  private attached = false;
  private readonly spec: DialogSpec;

  constructor(spec: DialogSpec) {
    this.spec = spec;
    this.body = el('div', { class: 'dialog-body' });
    this.body.append(el('h2', { class: 'dialog-title', text: spec.title }));
    spec.build(this.body);
    this.panel = el(
      'div',
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': spec.title, class: 'dialog-panel' },
      [this.body, el('div', { class: 'dialog-footer' }, spec.footer)],
    );
    this.overlay = el('div', { class: 'dialog-overlay' }, [this.panel]);
    this.overlay.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.overlay.addEventListener('wheel', (event) => this.blockScroll(event), { passive: false });
    this.overlay.addEventListener('touchmove', (event) => this.blockScroll(event), { passive: false });
    this.overlay.addEventListener('mousedown', (event) => {
      if (event.target === this.overlay) event.preventDefault();
    });
  }

  private blockScroll(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (target && this.body.contains(target) && this.body.scrollHeight > this.body.clientHeight) return;
    event.preventDefault();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.spec.onEscape) this.spec.onEscape();
      else this.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = [...this.panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (node) => node.offsetParent !== null || node === document.activeElement,
    );
    if (stops.length === 0) {
      event.preventDefault();
      return;
    }
    const first = stops[0]!;
    const last = stops[stops.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || !this.panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !this.panel.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  get isOpen(): boolean {
    return this.attached;
  }

  open(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.panel.classList.remove('is-leaving');
    this.panel.removeAttribute('inert');
    if (!this.attached) {
      document.body.append(this.overlay);
      this.attached = true;
      openCount += 1;
      document.documentElement.classList.add('dialog-open');
      document.getElementById('app')?.setAttribute('inert', '');
    }
    const target = this.spec.initialFocus();
    target?.focus();
  }

  close(options: { returnFocus?: boolean } = { returnFocus: true }): void {
    if (!this.attached) return;
    this.attached = false;
    openCount = Math.max(0, openCount - 1);
    if (openCount === 0) {
      document.documentElement.classList.remove('dialog-open');
      document.getElementById('app')?.removeAttribute('inert');
    }
    this.panel.setAttribute('inert', '');
    if (options.returnFocus !== false) this.spec.returnFocus()?.focus();
    if (prefersReducedMotion()) {
      this.overlay.remove();
      return;
    }
    this.panel.classList.add('is-leaving');
    this.hideTimer = window.setTimeout(() => {
      this.hideTimer = null;
      this.panel.classList.remove('is-leaving');
      this.overlay.remove();
    }, 160);
  }

  destroy(): void {
    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
    if (this.attached) this.close({ returnFocus: false });
    this.overlay.remove();
  }
}
