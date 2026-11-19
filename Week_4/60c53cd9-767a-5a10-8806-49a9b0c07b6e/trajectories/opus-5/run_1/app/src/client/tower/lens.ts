/**
 * The Window Lens: a round view of the unit under the pointer or keyboard focus,
 * with a north tick on its rim and the chip as its caption. It always describes
 * the newest unit, so a slower photograph is never shown.
 */

import { el, prefersReducedMotion } from '../dom';
import { chipText, type DisplayStatus } from '../../shared/labels';

export const LENS_DIAMETER = 224;

export interface LensSubject {
  code: string;
  bearing: number;
  facing: string;
  status: DisplayStatus;
  syncing: boolean;
  outsideFilters: boolean;
  /** The signed view link, or null when there is no confirmed photograph. */
  viewUrl: string | null;
  viewPhotographed: boolean;
  /** Withdrawn and unreleased cells never request an image. */
  showsView: boolean;
}

export class Lens {
  readonly figure: HTMLElement;
  private readonly imageA: HTMLImageElement;
  private readonly imageB: HTMLImageElement;
  private readonly caption: HTMLElement;
  private readonly captionText: HTMLElement;
  private readonly tick: HTMLElement;
  private front: HTMLImageElement;
  /** `<code>|<what the circle shows>`, so a photograph that arrives later is drawn. */
  private currentView: string | null = null;
  private loadToken = 0;

  constructor(private inset: boolean) {
    this.imageA = el('img', { class: 'lens-image', alt: '', hidden: true }) as HTMLImageElement;
    this.imageB = el('img', { class: 'lens-image lens-image-back', alt: '', hidden: true }) as HTMLImageElement;
    this.front = this.imageA;
    this.tick = el('span', { class: 'lens-tick', 'aria-hidden': 'true' });
    this.captionText = el('span', { class: 'lens-chip-text' });
    this.caption = el('figcaption', { class: 'lens-chip' }, [this.captionText]);
    this.figure = el(
      'figure',
      {
        class: `lens ${this.inset ? 'lens-inset' : 'lens-floating'}`,
        role: 'figure',
        'aria-label': 'Window Lens',
        hidden: true,
      },
      [el('div', { class: 'lens-circle' }, [this.imageB, this.imageA, this.tick]), this.caption],
    );
  }

  setInset(inset: boolean): void {
    if (this.inset === inset) return;
    this.inset = inset;
    this.figure.classList.toggle('lens-inset', inset);
    this.figure.classList.toggle('lens-floating', !inset);
    this.figure.style.transform = '';
    if (inset) this.figure.hidden = false;
  }

  moveTo(x: number, y: number): void {
    if (this.inset) return;
    this.figure.style.transform = `translate(${Math.round(x - LENS_DIAMETER / 2)}px, ${Math.round(
      y - LENS_DIAMETER / 2,
    )}px)`;
  }

  hide(): void {
    if (this.inset) return;
    this.figure.hidden = true;
    this.currentView = null;
  }

  show(subject: LensSubject): void {
    this.figure.hidden = false;
    this.caption.hidden = false;
    this.captionText.textContent = chipText({
      code: subject.code,
      bearing: subject.bearing,
      facing: subject.facing as never,
      status: subject.status,
      syncing: subject.syncing,
      outsideFilters: subject.outsideFilters,
    });
    this.tick.style.transform = `rotate(${(360 - subject.bearing) % 360}deg)`;
    const shows = subject.outsideFilters
      ? 'outside'
      : !subject.showsView
        ? 'none'
        : subject.viewPhotographed && subject.viewUrl
          ? 'photo'
          : 'nophoto';
    const view = `${subject.code}|${shows}`;
    if (view === this.currentView) return;
    this.currentView = view;
    this.loadToken += 1;

    if (subject.outsideFilters) {
      this.showCaptionOnly('Outside your filters');
      return;
    }
    if (!subject.showsView) {
      this.showCaptionOnly('');
      return;
    }
    if (shows === 'nophoto' || !subject.viewUrl) {
      this.showCaptionOnly('No view photograph yet.');
      return;
    }
    this.loadView(subject.code, subject.viewUrl, this.loadToken);
  }

  private get note(): HTMLElement {
    let node = this.figure.querySelector<HTMLElement>('.lens-note');
    if (!node) {
      node = el('p', { class: 'lens-note' });
      this.figure.querySelector('.lens-circle')?.append(node);
    }
    return node;
  }

  private showCaptionOnly(message: string): void {
    this.imageA.hidden = true;
    this.imageB.hidden = true;
    this.imageA.removeAttribute('src');
    this.imageB.removeAttribute('src');
    this.note.textContent = message;
    this.note.hidden = message === '';
  }

  private loadView(code: string, url: string, token: number): void {
    const next = this.front === this.imageA ? this.imageB : this.imageA;
    const image = new Image();
    image.decoding = 'sync';
    image.onload = () => {
      if (token !== this.loadToken) return;
      next.src = image.src;
      next.alt = `View from ${code}`;
      next.hidden = false;
      next.classList.remove('lens-image-back');
      this.front.classList.add('lens-image-back');
      if (prefersReducedMotion()) {
        this.front.hidden = true;
      } else {
        const leaving = this.front;
        window.setTimeout(() => {
          if (token === this.loadToken) leaving.hidden = true;
        }, 250);
      }
      this.front = next;
      this.note.hidden = true;
    };
    image.onerror = () => {
      if (token !== this.loadToken) return;
      this.showCaptionOnly('View photograph unavailable right now.');
    };
    image.src = url;
    this.note.textContent = '';
    this.note.hidden = true;
  }

  /** The visible image, used when the lens grows into the detail view panel. */
  currentImageSrc(): string | null {
    return this.front.hidden ? null : this.front.getAttribute('src');
  }
}
