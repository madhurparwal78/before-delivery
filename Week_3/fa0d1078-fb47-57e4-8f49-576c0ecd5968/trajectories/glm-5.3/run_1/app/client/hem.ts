import { el } from './dom.js';

// The hem thread, the signature: a thread runs along the board's outer edge.
// Each correct entry adds one stitch; a mistake adds none. The new stitch
// draws onto the thread over 240 ms in one browser animation, and the count
// rolls in one browser animation of 320 ms. data-stitches always equals the
// player's correct non-given cells.

const PERIMETER = 4 * 9; // one stitch per unit around the edge
const STITCH_LEN = PERIMETER / 44;

export interface HemOptions {
  id: string;
  nameFor: (count: number) => string;
}

export function hemThread(opts: HemOptions): { wrap: HTMLElement; setStitches: (n: number, animate: boolean) => void } {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M 2,2 L 98,2 L 98,98 L 2,98 L 2,2');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'none');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-dasharray', `${STITCH_LEN} ${STITCH_LEN * 0.55}`);
  path.setAttribute('stroke-dashoffset', '0');
  svg.append(path);

  const count = el('span', { id: `${opts.id}-count`, class: 'stitch-count' }, ['0']);

  const img = el('div', {
    id: opts.id,
    class: 'board-hem',
    role: 'img',
    'aria-label': opts.nameFor(0),
    'data-stitches': '0',
  }, [svg, count]);

  // The thread's strokes are one element each so each draw is one browser
  // animation on an element inside #hem.

  let current = 0;
  let lastAnim = -1;

  function stitchesPath(n: number): string {
    if (n === 0) return '';
    void PERIMETER;
    const step = PERIMETER / Math.max(n, 1);
    return `${step} ${step * 0.55}`;
  }

  function setStitches(n: number, animate: boolean): void {
    if (n === current) return;
    const grew = n > current;
    current = n;
    img.setAttribute('data-stitches', String(n));
    img.setAttribute('aria-label', opts.nameFor(n));
    const newOffset = grew ? String(STITCH_LEN) : '0';
    path.setAttribute('stroke', '#f7e4e8');
    path.setAttribute('stroke-dasharray', stitchesPath(n));
    path.setAttribute('stroke-dashoffset', newOffset);
    if (animate && !prefersReducedMotion()) {
      // The stitch draws over 240 ms as one browser animation.
      path.classList.remove('stitch-draw');
      void path.getBBox;
      path.getBoundingClientRect();
      path.classList.add('stitch-draw');
      lastAnim = requestAnimationFrame(() => {
        path.setAttribute('stroke-dashoffset', '0');
      });
    } else {
      path.setAttribute('stroke-dashoffset', '0');
    }
    // The count rolls to the new number in one browser animation.
    count.textContent = String(n);
    count.classList.remove('count-roll');
    if (animate && !prefersReducedMotion()) {
      requestAnimationFrame(() => count.classList.add('count-roll'));
    }
    void lastAnim;
  }

  return { wrap: img, setStitches };
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
