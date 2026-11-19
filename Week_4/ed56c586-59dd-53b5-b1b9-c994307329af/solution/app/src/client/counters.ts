import { COUNT_MS, counterFigure, counterStateAt } from "../shared/counter.js";
import { COUNTER_START_LINE, reachedLine } from "../shared/scroll-lines.js";
import { all, prefersReducedMotion } from "./dom.js";
import { onViewportChange } from "./viewport.js";

/** The counters: a block starts the first time its top edge is at or above the 75% line, checked at load and on every
 * scroll and resize. It counts on the page clock for 1,500 ms, once per page load. */

interface CounterFigure {
  readonly element: HTMLElement;
  readonly target: number;
}

interface CounterBlock {
  readonly element: HTMLElement;
  readonly figures: readonly CounterFigure[];
  startedAt: number | undefined;
}

export function initCounters(): void {
  const blocks: CounterBlock[] = all<HTMLElement>(document, "[data-stats]").map((element) => ({
    element,
    figures: all<HTMLElement>(element, "[data-counter]").map((figure) => ({ element: figure, target: Number(figure.dataset["target"]) })),
    startedAt: undefined,
  }));

  const showFigures = (block: CounterBlock, elapsedMs: number): void => {
    for (const figure of block.figures) figure.element.textContent = String(counterFigure(figure.target, elapsedMs));
    block.element.dataset["state"] = counterStateAt(elapsedMs);
  };

  const tick = (): void => {
    let counting = false;
    for (const block of blocks) {
      if (block.startedAt === undefined || block.element.dataset["state"] !== "counting") continue;
      const elapsed = performance.now() - block.startedAt;
      showFigures(block, elapsed);
      if (elapsed < COUNT_MS) counting = true;
    }
    if (counting) window.requestAnimationFrame(tick);
  };

  const start = (block: CounterBlock): void => {
    if (prefersReducedMotion()) {
      showFigures(block, COUNT_MS);
      block.startedAt = performance.now();
      return;
    }
    block.startedAt = performance.now();
    showFigures(block, 0);
    window.requestAnimationFrame(tick);
  };

  onViewportChange(() => {
    for (const block of blocks) {
      if (block.startedAt === undefined && reachedLine(block.element.getBoundingClientRect().top, window.innerHeight, COUNTER_START_LINE)) start(block);
    }
  });
}
