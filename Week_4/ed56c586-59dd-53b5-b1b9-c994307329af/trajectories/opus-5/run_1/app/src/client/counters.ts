/** The counter blocks: they start at the 75% line and count once per page load. */

import { COUNTER_DURATION_MS, COUNTER_LINE, counterFigure } from '../shared/rules.js';
import { onScrollOrResize, queryAll, reducedMotion } from './dom.js';

const FRAME_MS = 16;

interface Counter {
  readonly element: HTMLElement;
  readonly target: number;
}

const countersIn = (block: HTMLElement): Counter[] =>
  queryAll<HTMLElement>('[data-counter]', block).map((element) => ({
    element,
    target: Number.parseInt(element.dataset.target ?? '0', 10),
  }));

const finish = (block: HTMLElement, counters: readonly Counter[]): void => {
  for (const counter of counters) counter.element.textContent = String(counter.target);
  block.dataset.state = 'done';
};

const startBlock = (block: HTMLElement): void => {
  const counters = countersIn(block);
  if (reducedMotion()) {
    finish(block, counters);
    return;
  }
  block.dataset.state = 'counting';
  const startedAt = Date.now();
  const timer = window.setInterval(() => {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= COUNTER_DURATION_MS) {
      window.clearInterval(timer);
      finish(block, counters);
      return;
    }
    for (const counter of counters) {
      counter.element.textContent = String(counterFigure(counter.target, elapsed));
    }
  }, FRAME_MS);
};

export const setUpCounters = (): void => {
  const blocks = queryAll<HTMLElement>('[data-stats]');
  onScrollOrResize(() => {
    for (const block of blocks) {
      if (block.dataset.state !== 'idle') continue;
      if (block.getBoundingClientRect().top <= window.innerHeight * COUNTER_LINE) {
        startBlock(block);
      }
    }
  });
};
