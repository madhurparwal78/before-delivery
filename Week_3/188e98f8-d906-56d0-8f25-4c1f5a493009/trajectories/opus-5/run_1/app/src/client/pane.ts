/** Dialogs, panes and sheets: their motion, their focus trap and their exit. */

import { DURATIONS } from '../shared/motion.js';
import { el, focusOn, reducedMotion } from './dom.js';

export interface PaneSpec {
  name: string;
  /** The Tab order inside the pane, recomputed on every Tab. */
  stops: () => HTMLElement[];
  /** Where focus lands when the pane opens. */
  firstStop: () => HTMLElement | null;
  /** Where focus returns when the pane closes by Cancel or Escape. */
  opener: () => HTMLElement | null;
}

export class Pane {
  readonly dialog: HTMLElement;
  readonly body: HTMLElement;
  private readonly backdrop: HTMLElement;
  private readonly overlay: HTMLElement;
  private shown = false;
  private exit: number | null = null;
  private generation = 0;

  constructor(private readonly spec: PaneSpec) {
    this.body = el('div', { class: 'pane-inner' });
    this.dialog = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': spec.name, class: 'pane' }, [
      this.body,
    ]);
    this.backdrop = el('div', { class: 'backdrop' });
    this.overlay = el('div', { class: 'overlay' }, [this.backdrop, this.dialog]);
    // A press on the backdrop, or on the pane's own surface, never moves focus out.
    this.overlay.addEventListener('mousedown', (event) => {
      const pressed = event.target;
      if (pressed instanceof HTMLElement && pressed.closest('input, button, select, textarea, label, a, [tabindex]')) {
        return;
      }
      event.preventDefault();
    });
    this.backdrop.addEventListener('click', (event) => event.preventDefault());
    this.dialog.addEventListener('keydown', (event) => this.onKeyDown(event));
  }

  get open(): boolean {
    return this.shown;
  }

  show(): void {
    this.generation += 1;
    if (this.exit !== null) {
      window.clearTimeout(this.exit);
      this.exit = null;
    }
    const reopened = this.overlay.isConnected;
    if (!reopened) document.body.append(this.overlay);
    this.shown = true;
    this.overlay.classList.remove('leaving');
    document.getElementById('app')?.setAttribute('inert', '');
    if (!reopened) this.playEnter();
    focusOn(this.spec.firstStop());
  }

  hide(focusTarget?: HTMLElement | null): void {
    if (!this.shown) return;
    this.shown = false;
    this.generation += 1;
    const closing = this.generation;
    // The background takes focus again only once it can hold it.
    document.getElementById('app')?.removeAttribute('inert');
    focusOn(focusTarget === undefined ? this.spec.opener() : focusTarget);
    const span = reducedMotion() ? DURATIONS.reduced : DURATIONS.pane;
    this.overlay.classList.add('leaving');
    this.exit = window.setTimeout(() => {
      this.exit = null;
      if (this.generation !== closing) return;
      this.overlay.remove();
      this.overlay.classList.remove('leaving');
    }, span);
  }

  private playEnter(): void {
    this.overlay.classList.add('entering');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.overlay.classList.remove('entering'));
    });
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.hide();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = this.spec.stops();
    if (stops.length === 0) return;
    event.preventDefault();
    const active = document.activeElement;
    const at = stops.findIndex((stop) => stop === active || stop.contains(active));
    const step = event.shiftKey ? -1 : 1;
    const next = at === -1 ? 0 : (at + step + stops.length) % stops.length;
    focusOn(stops[next] ?? null);
  }
}
