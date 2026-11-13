import { SCREEN_STATES, announcement } from '../shared/copy.js';
import { clear, element, prefersReducedMotion, setText } from './dom.js';
import { TIMING, tileSlide } from './motion.js';

/** The colour field, the tile it holds and the fader that runs along its bottom. */

export interface Stop {
  key: string;
  title: string;
  maker: string | null;
  year: number | null;
  sizeLine: string;
  swatch: string;
  photoUrl: string | null;
}

export interface StopChange {
  index: number;
  stop: Stop;
  announce: boolean;
  scroll: boolean;
}

export interface ReelOptions {
  initialIndex: number;
  /** The row in the text column that belongs to a stop, for the scroll binding. */
  rowFor: (index: number) => HTMLElement | null;
  onChange: (change: StopChange) => void;
}

const SHUTTER_CLOSE = TIMING.shutterClose;

export class Field {
  readonly root: HTMLElement;
  private readonly figure: HTMLElement;
  private readonly tile: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly photo: HTMLImageElement;
  private readonly outline: HTMLElement;
  private readonly message: HTMLElement;
  private readonly shutter: HTMLElement;
  private readonly caption: HTMLElement;
  private readonly captionName: HTMLElement;
  private readonly captionSize: HTMLElement;
  private readonly standIn: HTMLElement;
  private readonly fader: HTMLElement;
  private readonly track: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly detents: HTMLElement;
  private readonly announce: (text: string) => void;

  private stops: Stop[] = [];
  private index = 0;
  private options: ReelOptions | null = null;
  private painted: Stop | null = null;
  private swapToken = 0;
  private pendingTarget: Stop | null = null;
  private pendingTimer: number | null = null;
  private runningAnimations: Animation[] = [];
  private programmaticScrollUntil = 0;
  private dragging = false;
  private dragFraction: number | null = null;

  constructor(announce: (text: string) => void) {
    this.announce = announce;
    this.fill = element('div', { class: 'tile-fill' });
    this.photo = element('img', { class: 'tile-photo', alt: '' });
    this.photo.addEventListener('error', () => this.showPhotoUnavailable());
    this.outline = element('div', { class: 'tile-outline', 'aria-hidden': 'true' });
    this.outline.innerHTML = KETTLE_OUTLINE;
    this.message = element('p', { class: 'tile-message' });
    this.shutter = element('div', { class: 'tile-shutter', 'aria-hidden': 'true' });
    this.tile = element('div', { class: 'tile' }, [
      this.fill,
      this.photo,
      this.outline,
      this.message,
      this.shutter,
    ]);
    this.captionName = element('span', { class: 'caption-name' });
    this.captionSize = element('span', { class: 'caption-size' });
    this.caption = element('figcaption', { class: 'tile-caption' }, [
      this.captionName,
      this.captionSize,
    ]);
    this.standIn = element('p', { class: 'stand-in' });
    this.figure = element(
      'figure',
      { role: 'figure', 'aria-label': 'Current reference', class: 'tile-figure' },
      [this.tile, this.caption, this.standIn],
    );

    this.knob = element('span', { class: 'fader-knob', 'aria-hidden': 'true' });
    this.detents = element('span', { class: 'fader-detents', 'aria-hidden': 'true' });
    this.track = element(
      'div',
      {
        class: 'fader-track',
        role: 'slider',
        'aria-label': 'Reel position',
        tabindex: '0',
        'aria-valuemin': '0',
        'aria-valuemax': '0',
        'aria-valuenow': '0',
      },
      [this.knob],
    );
    this.fader = element('div', { class: 'fader', hidden: true }, [this.track, this.detents]);
    this.root = element('div', { class: 'field' }, [this.figure, this.fader]);

    this.bindFader();
    window.addEventListener('scroll', () => this.onScroll(), { passive: true });
  }

  /** One reference in the tile, with no fader. */
  showSingle(stop: Stop | null, options: { wholePhoto?: boolean } = {}): void {
    this.options = null;
    this.stops = stop ? [stop] : [];
    this.index = 0;
    this.fader.hidden = true;
    this.standIn.hidden = true;
    this.figure.classList.toggle('whole-photo', options.wholePhoto === true);
    if (!stop) return;
    this.paint(stop);
  }

  /** The tile shows a published line over the object outline. */
  showMessage(line: string): void {
    this.options = null;
    this.stops = [];
    this.painted = null;
    this.cancelSwap();
    this.fader.hidden = true;
    this.standIn.hidden = true;
    this.figure.classList.remove('whole-photo');
    this.tile.classList.add('is-empty');
    this.fill.style.background = '';
    this.photo.removeAttribute('src');
    this.photo.hidden = true;
    this.outline.hidden = false;
    setText(this.message, line);
    setText(this.captionName, '');
    setText(this.captionSize, '');
  }

  setStandIn(line: string | null): void {
    this.standIn.hidden = line === null;
    setText(this.standIn, line ?? '');
  }

  /** The reel mode: stops with the fader along the bottom. */
  showReel(stops: Stop[], options: ReelOptions): void {
    this.stops = stops;
    this.options = options;
    this.figure.classList.remove('whole-photo');
    if (stops.length === 0) {
      this.showMessage(SCREEN_STATES.emptyReel);
      this.stops = [];
      this.options = options;
      return;
    }
    this.fader.hidden = false;
    this.index = Math.min(Math.max(options.initialIndex, 0), stops.length - 1);
    this.renderDetents();
    this.syncSlider();
    this.paint(stops[this.index]!);
  }

  /**
   * A refetch replaces the stops without a swap while the current reference is still
   * playable, and with one Fader Pull when it is not.
   */
  updateReelStops(
    stops: Stop[],
    index: number,
    options: { swap: boolean; announce: boolean },
  ): void {
    if (stops.length === 0) {
      const keep = this.options;
      this.showMessage(SCREEN_STATES.emptyReel);
      this.options = keep;
      this.stops = [];
      return;
    }
    const previous = this.index;
    this.stops = stops;
    this.fader.hidden = false;
    this.tile.classList.remove('is-empty');
    this.index = Math.min(Math.max(index, 0), stops.length - 1);
    this.renderDetents();
    this.syncSlider();
    const target = stops[this.index]!;
    if (options.swap) this.swapTo(target, this.index >= previous ? 1 : -1);
    else if (this.painted?.key !== target.key) this.paint(target);
    else this.paintContent(target);
    if (options.announce) this.announce(this.valueText(this.index));
  }

  get currentIndex(): number {
    return this.index;
  }

  get currentStop(): Stop | null {
    return this.stops[this.index] ?? null;
  }

  get stopCount(): number {
    return this.stops.length;
  }

  valueText(index: number): string {
    const stop = this.stops[index];
    if (!stop) return '';
    return announcement(index + 1, this.stops.length, stop.title, stop.maker, stop.year);
  }

  /** Moves to a stop, running the Fader Pull and announcing it. */
  goTo(
    index: number,
    options: { announce?: boolean; animate?: boolean; scroll?: boolean } = {},
  ): void {
    const clamped = Math.min(Math.max(index, 0), this.stops.length - 1);
    const target = this.stops[clamped];
    if (!target) return;
    const direction: 1 | -1 = clamped >= this.index ? 1 : -1;
    this.index = clamped;
    this.syncSlider();
    if (options.scroll !== false) this.scrollToRow(clamped);
    this.options?.onChange({
      index: clamped,
      stop: target,
      announce: options.announce !== false,
      scroll: options.scroll !== false,
    });
    if (options.animate === false) this.paint(target);
    else this.swapTo(target, direction);
    if (options.announce !== false) this.announce(this.valueText(clamped));
  }

  /** Replaces the tile's reference with a Fader Pull swap, as a library row does. */
  swapSingle(stop: Stop, direction: 1 | -1 = 1): void {
    this.stops = [stop];
    this.index = 0;
    this.options = null;
    this.fader.hidden = true;
    this.figure.classList.remove('whole-photo');
    this.swapTo(stop, direction);
  }

  private cancelSwap(): void {
    this.swapToken += 1;
    if (this.pendingTimer !== null) {
      window.clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    for (const animation of this.runningAnimations) animation.cancel();
    this.runningAnimations = [];
  }

  /**
   * A change arriving mid-swap ends the running swap at once, so the tile settles on the
   * newest stop and nothing from an older stop is painted afterwards.
   */
  private swapTo(target: Stop, direction: 1 | -1): void {
    if (this.pendingTarget) this.paint(this.pendingTarget);
    this.cancelSwap();
    if (this.painted?.key === target.key) {
      this.paint(target);
      return;
    }
    if (prefersReducedMotion()) {
      this.paint(target);
      return;
    }
    const token = this.swapToken;
    this.pendingTarget = target;
    const from = this.painted?.swatch ?? target.swatch;

    this.runningAnimations.push(
      this.shutter.animate(
        [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }],
        { duration: SHUTTER_CLOSE, easing: 'cubic-bezier(0.16,0.84,0.3,1)', fill: 'both' },
      ),
    );
    this.runningAnimations.push(
      this.fill.animate(
        [{ background: from }, { background: target.swatch }],
        { duration: SHUTTER_CLOSE, easing: 'linear', fill: 'both' },
      ),
    );

    this.pendingTimer = window.setTimeout(() => {
      if (token !== this.swapToken) return;
      this.pendingTimer = null;
      this.paintContent(target);
      this.runningAnimations.push(
        this.shutter.animate(
          [{ transform: 'scaleY(1)' }, { transform: 'scaleY(0)' }],
          {
            duration: TIMING.shutterOpen,
            easing: 'cubic-bezier(0.16,0.84,0.3,1)',
            fill: 'both',
          },
        ),
      );
      const slide = tileSlide(this.photo, direction);
      if (slide) this.runningAnimations.push(slide);
      this.pendingTarget = null;
      this.painted = target;
    }, SHUTTER_CLOSE);
  }

  private paint(stop: Stop): void {
    this.cancelSwap();
    this.pendingTarget = null;
    this.shutter.getAnimations().forEach((animation) => animation.cancel());
    this.shutter.style.transform = 'scaleY(0)';
    this.paintContent(stop);
    this.painted = stop;
  }

  private paintContent(stop: Stop): void {
    this.tile.classList.remove('is-empty');
    this.fill.style.background = stop.swatch;
    setText(this.message, '');
    if (stop.photoUrl) {
      if (this.photo.getAttribute('src') !== stop.photoUrl) {
        this.photo.setAttribute('src', stop.photoUrl);
      }
      this.photo.alt = stop.title;
      this.photo.hidden = false;
      this.outline.hidden = true;
    } else {
      this.showPhotoUnavailable();
    }
    setText(this.captionName, stop.title);
    setText(this.captionSize, stop.sizeLine);
  }

  private showPhotoUnavailable(): void {
    this.photo.hidden = true;
    this.outline.hidden = false;
    setText(this.message, SCREEN_STATES.photoUnavailable);
  }

  private renderDetents(): void {
    clear(this.detents);
    for (let number = 1; number <= this.stops.length; number += 1) {
      const detent = element('span', { class: 'fader-detent' }, [String(number)]);
      detent.style.left = `${this.fractionFor(number - 1) * 100}%`;
      this.detents.append(detent);
    }
  }

  private fractionFor(index: number): number {
    return this.stops.length <= 1 ? 0 : index / (this.stops.length - 1);
  }

  private syncSlider(): void {
    this.track.setAttribute('aria-valuemin', '0');
    this.track.setAttribute('aria-valuemax', String(Math.max(0, this.stops.length - 1)));
    this.track.setAttribute('aria-valuenow', String(this.index));
    this.track.setAttribute('aria-valuetext', this.valueText(this.index));
    this.moveKnob(this.fractionFor(this.index), !this.dragging);
  }

  private moveKnob(fraction: number, settle: boolean): void {
    this.knob.style.left = `${fraction * 100}%`;
    this.knob.style.transition =
      settle && !prefersReducedMotion() ? `left ${TIMING.knobSettle}ms cubic-bezier(0.16,0.84,0.3,1)` : 'none';
  }

  private bindFader(): void {
    this.track.addEventListener('keydown', (event) => {
      const handled = this.handleArrowKey(event.key);
      if (handled) event.preventDefault();
    });
    this.track.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    this.track.addEventListener('pointermove', (event) => this.onPointerMove(event));
    this.track.addEventListener('pointerup', (event) => this.onPointerUp(event));
    this.track.addEventListener('pointercancel', (event) => this.onPointerUp(event));
  }

  private handleArrowKey(key: string): boolean {
    if (this.stops.length === 0) return false;
    if (key === 'ArrowRight' || key === 'ArrowUp') {
      this.step(1);
      return true;
    }
    if (key === 'ArrowLeft' || key === 'ArrowDown') {
      this.step(-1);
      return true;
    }
    if (key === 'Home') {
      this.goTo(0);
      return true;
    }
    if (key === 'End') {
      this.goTo(this.stops.length - 1);
      return true;
    }
    return false;
  }

  /** Movement stops at either end and does not wrap. */
  step(delta: number): void {
    if (this.stops.length === 0) return;
    const next = this.index + delta;
    if (next < 0 || next > this.stops.length - 1) return;
    this.goTo(next);
  }

  private fractionFromPointer(event: PointerEvent): number {
    const bounds = this.track.getBoundingClientRect();
    if (bounds.width === 0) return 0;
    return Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
  }

  private onPointerDown(event: PointerEvent): void {
    if (this.stops.length === 0) return;
    this.track.setPointerCapture(event.pointerId);
    this.track.focus();
    this.dragging = true;
    this.dragFraction = this.fractionFromPointer(event);
    this.moveKnob(this.dragFraction, false);
    this.applyDragFraction();
    event.preventDefault();
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.dragging) return;
    this.dragFraction = this.fractionFromPointer(event);
    this.moveKnob(this.dragFraction, false);
    this.applyDragFraction();
  }

  /** The stop changes each time the knob's centre crosses a detent boundary. */
  private applyDragFraction(): void {
    if (this.dragFraction === null || this.stops.length <= 1) return;
    const nearest = Math.round(this.dragFraction * (this.stops.length - 1));
    if (nearest !== this.index) this.goTo(nearest);
  }

  private onPointerUp(event: PointerEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.dragFraction = null;
    if (this.track.hasPointerCapture(event.pointerId)) {
      this.track.releasePointerCapture(event.pointerId);
    }
    this.moveKnob(this.fractionFor(this.index), true);
  }

  /** Programmatic scrolling never triggers a second stop change. */
  private scrollToRow(index: number): void {
    const row = this.options?.rowFor(index);
    if (!row) return;
    const target = window.scrollY + row.getBoundingClientRect().top - window.innerHeight / 2;
    this.programmaticScrollUntil = performance.now() + 700;
    window.scrollTo({
      top: Math.max(0, target),
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }

  /**
   * The current stop is the last playable row whose top edge has passed the vertical middle
   * of the viewport.
   */
  private onScroll(): void {
    if (!this.options || this.stops.length === 0) return;
    if (performance.now() < this.programmaticScrollUntil) return;
    const middle = window.innerHeight / 2;
    let candidate = 0;
    for (let index = 0; index < this.stops.length; index += 1) {
      const row = this.options.rowFor(index);
      if (!row) continue;
      if (row.getBoundingClientRect().top <= middle) candidate = index;
    }
    if (candidate !== this.index) this.goTo(candidate, { scroll: false });
  }

  /** The bracket shortcuts work whichever control in the field or text column has focus. */
  handleShortcut(key: string): boolean {
    if (this.stops.length === 0 || this.options === null) return false;
    if (key === ']') {
      this.step(1);
      return true;
    }
    if (key === '[') {
      this.step(-1);
      return true;
    }
    return false;
  }

  get sliderElement(): HTMLElement {
    return this.track;
  }

  get photoElement(): HTMLImageElement {
    return this.photo;
  }

  get tileElement(): HTMLElement {
    return this.tile;
  }
}

const KETTLE_OUTLINE = `<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M34 46h44a6 6 0 0 1 6 6v32a10 10 0 0 1-10 10H38a10 10 0 0 1-10-10V52a6 6 0 0 1 6-6Z"/>
  <path d="M84 56l16-8v12l-16 8"/>
  <path d="M40 46c0-6 4-10 10-10h12c6 0 10 4 10 10"/>
  <path d="M50 36V30h12v6"/>
</svg>`;
