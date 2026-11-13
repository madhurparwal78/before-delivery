/**
 * The fitting fan in the browser.
 *
 * The attributes change the moment the value changes, before the next frame. Selecting a
 * part raises it and rings it in the signal colour; a second selection made during the
 * glide is the one that stays, because selection is a single piece of state with no timers.
 */

import {
  fanScale,
  fanSeparation,
  gapFor,
  offsetStyle,
  partOffset,
  sliderValueForKey,
  type FanAxis,
} from '../shared/fan-math';
import { findAll, prefersReducedMotion } from './dom';

export class FittingFan {
  private readonly slider: HTMLInputElement | null;
  private readonly parts: HTMLButtonElement[];
  private readonly axis: FanAxis | null;
  private readonly readOnly: boolean;
  private onSelect: ((booklet: number) => void) | null = null;

  constructor(private readonly root: HTMLElement) {
    this.slider = root.querySelector<HTMLInputElement>('.fan-slider');
    this.parts = Array.from(root.querySelectorAll<HTMLButtonElement>('.fan-part'));
    const axis = root.dataset['fanAxis'];
    this.axis = axis === 'x' || axis === 'y' || axis === 'iso' ? axis : null;
    this.readOnly = root.dataset['readOnly'] === 'true';

    this.wireSlider();
    this.wireParts();
    this.wireBracketShortcut();

    // With reduced motion the fan opens fully separated at once, with no glide.
    if (prefersReducedMotion()) {
      this.root.classList.add('no-glide');
      this.setValue(100);
    } else {
      this.paint(this.value());
    }
  }

  whenSelected(handler: (booklet: number) => void): void {
    this.onSelect = handler;
  }

  private value(): number {
    return this.slider === null ? 100 : Number(this.slider.value);
  }

  private wireSlider(): void {
    const slider = this.slider;
    if (slider === null) return;
    // Pointer and touch drag both arrive as input events.
    slider.addEventListener('input', () => this.paint(Number(slider.value)));
    slider.addEventListener('keydown', (event: KeyboardEvent) => {
      const next = sliderValueForKey(event.key, Number(slider.value));
      if (next === null) return;
      event.preventDefault();
      this.setValue(next);
    });
  }

  private setValue(value: number): void {
    if (this.slider !== null) this.slider.value = String(value);
    this.paint(value);
  }

  /** The attributes and the positions are set together, so they never disagree. */
  private paint(value: number): void {
    const gap = gapFor(window.innerWidth);
    this.root.dataset['fanSeparation'] = String(fanSeparation(value, this.parts.length, gap));
    this.root.dataset['fanScale'] = fanScale(value);

    const stage = this.root.querySelector<HTMLElement>('.fan-stage');
    if (stage !== null) stage.style.setProperty('--fan-scale', fanScale(value));

    this.parts.forEach((part, index) => {
      const offset = partOffset(value, index, gap);
      part.dataset['partOffset'] = String(offset);
      if (this.axis !== null) part.setAttribute('style', offsetStyle(this.axis, offset));
    });
  }

  private wireParts(): void {
    for (const part of this.parts) {
      part.addEventListener('click', () => {
        if (this.readOnly) return;
        if (part.getAttribute('aria-disabled') === 'true') return;
        this.select(Number(part.dataset['booklet']));
      });
    }
  }

  /**
   * While focus is anywhere inside the fan, `]` and `[` move the selection to the next and
   * previous active part in booklet order, leaving focus where it is. Withdrawn parts are
   * skipped and the keys never wrap.
   */
  private wireBracketShortcut(): void {
    this.root.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== ']' && event.key !== '[') return;
      if (this.readOnly) return;
      const active = this.parts.filter((part) => part.getAttribute('aria-disabled') !== 'true');
      if (active.length === 0) return;
      event.preventDefault();

      const selectedBooklet = this.root.dataset['activePart'];
      const position = active.findIndex((part) => part.dataset['booklet'] === selectedBooklet);

      if (position === -1) {
        const fallback = event.key === ']' ? active[0] : active[active.length - 1];
        if (fallback !== undefined) this.select(Number(fallback.dataset['booklet']));
        return;
      }
      const next = active[position + (event.key === ']' ? 1 : -1)];
      // At either end the key does nothing.
      if (next !== undefined) this.select(Number(next.dataset['booklet']));
    });
  }

  select(booklet: number): void {
    this.root.dataset['activePart'] = String(booklet);
    const list = this.root.querySelector<HTMLElement>('.fan-list');
    if (list !== null) list.dataset['activePart'] = String(booklet);

    for (const part of this.parts) {
      const chosen = Number(part.dataset['booklet']) === booklet;
      part.setAttribute('aria-pressed', chosen ? 'true' : 'false');
      part.classList.toggle('is-selected', chosen);
    }
    if (this.onSelect !== null) this.onSelect(booklet);
  }

  selected(): number | null {
    const value = this.root.dataset['activePart'];
    return value === undefined || value === 'none' ? null : Number(value);
  }

  /** Replaces the fan's markup when the chosen model changes. */
  static mountAll(): FittingFan[] {
    return findAll<HTMLElement>('.fan').map((root) => new FittingFan(root));
  }
}
