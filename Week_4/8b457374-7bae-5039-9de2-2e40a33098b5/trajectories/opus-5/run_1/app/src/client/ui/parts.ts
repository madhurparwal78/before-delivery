import { formatCountdown } from '../../shared/countdown.js';
import { STATE_WORDS } from '../../shared/copy.js';
import type { PledgeState } from '../../shared/types.js';
import { el, prefersReducedMotion, svg } from '../dom.js';

/** Colour never carries meaning alone: every state mark comes with its word. */
export function stateMark(state: PledgeState): HTMLElement {
  const mark = svg('svg', {
    class: `mark mark--${state}`,
    viewBox: '0 0 24 24',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  const ring = svg('circle', { cx: 12, cy: 12, r: 9, class: 'mark-ring' });
  switch (state) {
    case 'captured':
      mark.appendChild(svg('circle', { cx: 12, cy: 12, r: 9, class: 'mark-fill' }));
      break;
    case 'authorised':
      mark.appendChild(ring);
      break;
    case 'errored':
      mark.appendChild(ring);
      mark.appendChild(
        svg('path', { d: 'M12 3 A 9 9 0 0 0 12 21 Z', class: 'mark-fill' }),
      );
      break;
    case 'voided':
    case 'dropped':
      mark.appendChild(ring);
      mark.appendChild(svg('path', { d: 'M6 6 L18 18', class: 'mark-cross' }));
      mark.appendChild(svg('path', { d: 'M18 6 L6 18', class: 'mark-cross' }));
      break;
    case 'authorising':
      mark.appendChild(
        svg('circle', { cx: 12, cy: 12, r: 9, class: 'mark-ring mark-ring--dotted' }),
      );
      break;
  }
  return el('span', { class: 'state' }, mark, el('span', { class: 'state-word' }, STATE_WORDS[state]));
}

export function coverCircle(
  mediaId: string | null,
  title: string,
  className: string,
): HTMLElement {
  if (mediaId === null) {
    return el(
      'span',
      { class: `cover ${className} cover--empty` },
      svg(
        'svg',
        { viewBox: '0 0 24 24', 'aria-hidden': 'true', class: 'cover-placeholder' },
        svg('circle', { cx: 12, cy: 12, r: 10, class: 'outline-dot' }),
      ),
    );
  }
  const image = el('img', {
    class: 'cover-image',
    src: `/api/media/${mediaId}`,
    alt: `Cover art for ${title}`,
    loading: 'lazy',
  });
  if (!prefersReducedMotion()) image.classList.add('iris');
  return el('span', { class: `cover ${className}` }, image);
}

/** The full uncropped cover, shown inside an opened tier. */
export function coverFull(mediaId: string | null, title: string): HTMLElement | null {
  if (mediaId === null) return null;
  return el('img', {
    class: 'cover-full',
    src: `/api/media/${mediaId}`,
    alt: `Full cover art for ${title}`,
    loading: 'lazy',
  });
}

/**
 * A countdown driven only by the server's seconds_left and the time elapsed since that
 * answer, never by the device's date.
 */
export class Countdown {
  readonly root: HTMLElement;
  private readonly figure: HTMLElement;
  private secondsAtAnswer = 0;
  private answerAt = 0;
  private timer = 0;
  private onZero: (() => void) | null = null;
  private firedZero = false;

  constructor(name: string) {
    this.figure = el('span', { class: 'figures' }, '');
    this.root = el('div', { role: 'timer', 'aria-label': name, class: 'countdown' }, this.figure);
  }

  set(secondsLeft: number, onZero?: () => void): void {
    this.secondsAtAnswer = secondsLeft;
    this.answerAt = performance.now();
    this.firedZero = false;
    if (onZero !== undefined) this.onZero = onZero;
    this.render();
    if (this.timer === 0) {
      this.timer = window.setInterval(() => this.render(), 1000);
    }
  }

  stop(): void {
    if (this.timer !== 0) window.clearInterval(this.timer);
    this.timer = 0;
  }

  private render(): void {
    const elapsed = (performance.now() - this.answerAt) / 1000;
    const remaining = Math.max(0, this.secondsAtAnswer - elapsed);
    this.figure.textContent = formatCountdown(remaining);
    if (remaining <= 0 && !this.firedZero) {
      this.firedZero = true;
      this.onZero?.();
    }
  }
}

/** Loading shows outline dots inking ring by ring; under reduced motion, one still ring. */
export function loadingStatus(): HTMLElement {
  const gauge = svg('svg', {
    class: 'loader',
    viewBox: '-4 -4 8 8',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  const rings = prefersReducedMotion() ? [1] : [0, 1, 2, 3];
  for (const ring of rings) {
    const count = ring === 0 ? 1 : 6 * ring;
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      gauge.appendChild(
        svg('circle', {
          class: 'loader-dot',
          cx: ring * Math.cos(angle),
          cy: ring * Math.sin(angle),
          r: 0.34,
          style: `animation-delay: ${ring * 120}ms`,
        }),
      );
    }
  }
  return el(
    'div',
    { role: 'status', 'aria-live': 'polite', 'aria-label': 'Loading', class: 'loading' },
    gauge,
    el('span', { class: 'loading-word' }, 'Loading'),
  );
}

export function emptyState(sentence: string): HTMLElement {
  return el(
    'div',
    { class: 'empty' },
    svg(
      'svg',
      { viewBox: '0 0 48 48', 'aria-hidden': 'true', class: 'empty-dot', focusable: 'false' },
      svg('circle', { cx: 24, cy: 24, r: 21, class: 'outline-dot' }),
    ),
    el('p', { class: 'empty-sentence' }, sentence),
  );
}

export function fieldError(message: string): HTMLElement {
  return el('p', { class: 'field-error' }, message);
}
