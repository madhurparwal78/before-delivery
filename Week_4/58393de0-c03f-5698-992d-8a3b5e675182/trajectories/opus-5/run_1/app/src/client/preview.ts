import { el, reducedMotion } from './dom.js';
import { onLeave } from './router.js';

export interface PreviewHandle {
  element: HTMLElement;
  stage: HTMLElement;
  toggle: HTMLButtonElement;
  setPlaying: (playing: boolean) => void;
  playing: () => boolean;
}

interface PreviewOptions {
  pauseLabel: string;
  loopMs: number;
  className?: string;
  draw: (stage: HTMLElement, progress: number) => void;
}

/**
 * A named looping preview with its own pause control and a still fallback.
 * Reduced motion shows the finished frame, paused, with the toggle reporting pressed.
 */
export const loopPreview = (options: PreviewOptions): PreviewHandle => {
  const still = reducedMotion();
  const stage = el('div', { class: 'qy-preview-stage' });
  const toggle = el('button', {
    type: 'button',
    class: 'qy-preview-toggle',
    'aria-pressed': still ? 'true' : 'false',
    'aria-label': options.pauseLabel,
  });
  toggle.textContent = options.pauseLabel;
  const element = el('div', {
    class: `qy-preview ${options.className ?? ''}`.trim(),
    'data-playing': still ? 'false' : 'true',
  });
  element.append(stage);

  let playing = !still;
  let progress = still ? 1 : 0;
  let last = 0;
  let frame = 0;

  const paint = (): void => {
    options.draw(stage, progress);
  };

  const tick = (now: number): void => {
    if (!playing) return;
    if (last !== 0) progress = (progress + (now - last) / options.loopMs) % 1;
    last = now;
    paint();
    frame = requestAnimationFrame(tick);
  };

  const setPlaying = (next: boolean): void => {
    playing = next;
    element.dataset.playing = next ? 'true' : 'false';
    toggle.setAttribute('aria-pressed', next ? 'false' : 'true');
    if (next) {
      last = 0;
      frame = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(frame);
      paint();
    }
  };

  toggle.addEventListener('click', () => setPlaying(!playing));
  paint();
  if (playing) frame = requestAnimationFrame(tick);
  onLeave(() => cancelAnimationFrame(frame));

  return { element, stage, toggle, setPlaying, playing: () => playing };
};
