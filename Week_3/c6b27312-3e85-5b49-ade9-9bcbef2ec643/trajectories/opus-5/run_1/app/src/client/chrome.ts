import { all, on } from './dom';
import { significantFigures } from '../shared/numbers';

/** The dimension leader figure: the heading's rendered width in inches, two significant figures. */
function measureLeaders(): void {
  for (const leader of all('[data-ui="dimension-leader"]')) {
    const heading = leader.parentElement;
    const figure = leader.querySelector('[data-ui="leader-figure"]');
    if (!heading || !figure) continue;
    const range = document.createRange();
    range.selectNodeContents(heading);
    const rectangles = [...range.getClientRects()].filter((rectangle) => rectangle.width > 0);
    const width = rectangles.length > 0 ? Math.max(...rectangles.map((rectangle) => rectangle.width)) : heading.getBoundingClientRect().width;
    figure.textContent = significantFigures(width / 96, 2);
  }
}

export function startChrome(): void {
  measureLeaders();
  let timer = 0;
  on(window, 'resize', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => measureLeaders(), 120);
  });
  if (document.fonts) void document.fonts.ready.then(() => measureLeaders());
}
