import { listen, query, queryAll } from './dom.js';
import { COUNT_MS, reduced } from './motion.js';
import { onReveal } from './reveal.js';
import { formatFigure } from '../shared/copy.js';

const shown = (target: number, progress: number): string =>
  formatFigure(Math.round(target * (1 - (1 - progress) ** 3)));

function count(numbers: HTMLElement[]): void {
  const start = performance.now();
  const step = (now: number): void => {
    const progress = Math.min(1, (now - start) / COUNT_MS);
    for (const number of numbers) {
      number.textContent = shown(Number(number.dataset.count), progress);
    }
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function initStats(root: ParentNode): void {
  const stats = query<HTMLElement>('[data-stats]', root);
  if (!stats) return;
  const tabs = queryAll<HTMLButtonElement>('[data-stat-tab]', stats);
  const panels = queryAll<HTMLElement>('[data-stat-panel]', stats);

  const select = (index: number): void => {
    tabs.forEach((tab, position) => {
      const selected = position === index;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((panel, position) => {
      panel.hidden = position !== index;
    });
    tabs[index]!.focus();
  };

  tabs.forEach((tab, index) => {
    listen(tab, 'click', () => select(index));
    listen(tab, 'keydown', (event) => {
      const last = tabs.length - 1;
      const next =
        event.key === 'ArrowRight'
          ? (index + 1) % tabs.length
          : event.key === 'ArrowLeft'
            ? (index + last) % tabs.length
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? last
                : null;
      if (next === null) return;
      event.preventDefault();
      select(next);
    });
  });

  const numbers = queryAll<HTMLElement>('[data-count]', stats);
  if (reduced() || stats.dataset.counted === 'done') return;
  for (const number of numbers) number.textContent = formatFigure(0);
  const tablist = query<HTMLElement>('[role="tablist"]', stats);
  if (!tablist) return;
  onReveal(tablist, 0.85, () => {
    stats.dataset.counted = 'done';
    count(numbers);
  });
}
