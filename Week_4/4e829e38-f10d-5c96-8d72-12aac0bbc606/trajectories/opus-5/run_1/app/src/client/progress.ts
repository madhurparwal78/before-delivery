import { el } from './dom.js';
import { animate, fixed2 } from './motion.js';
import { settings } from './state.js';

export interface ProgressBar {
  node: HTMLElement;
  set: (progress: number) => void;
}

function displayPercent(progress: number): number {
  return Math.floor(progress + 0.5);
}

export function progressBar(name: string, progress: number): ProgressBar {
  let shown = progress;
  const fill = el('span', { class: 'progress__fill' });
  const node = el(
    'div',
    {
      role: 'progressbar',
      'aria-label': `${name} progress`,
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': String(displayPercent(progress)),
      'aria-valuetext': `${displayPercent(progress)}% complete`,
      'data-shown-percent': fixed2(progress),
      class: 'progress',
    },
    fill,
  );
  fill.style.setProperty('width', `${progress}%`);

  return {
    node,
    set: (next) => {
      const from = shown;
      shown = next;
      node.setAttribute('aria-valuenow', String(displayPercent(next)));
      node.setAttribute('aria-valuetext', `${displayPercent(next)}% complete`);
      animate(
        settings.progressMs,
        (eased) => {
          const value = from + (next - from) * eased;
          node.setAttribute('data-shown-percent', fixed2(value));
          fill.style.setProperty('width', `${value}%`);
        },
        () => {
          node.setAttribute('data-shown-percent', fixed2(next));
          fill.style.setProperty('width', `${next}%`);
        },
      );
    },
  };
}
