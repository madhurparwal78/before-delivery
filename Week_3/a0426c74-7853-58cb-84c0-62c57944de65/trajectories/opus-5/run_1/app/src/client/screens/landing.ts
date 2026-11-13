import { clear, el, on, svg } from '../dom.js';

const SHEET_TITLES = [
  'Garden plan, Larch Row',
  'Shelf elevation, Unit 4',
  'Stage layout, Hall B',
  'Title block only',
  'Shed footing, Plot 9',
  'Bench section, Workshop',
  'Seating plan, Quay Room',
  'Raised beds, North Yard',
  'Counter detail, Kiosk 2',
  'Lighting grid, Hall B',
  'Fence run, Larch Row',
];

const CENTRED_TITLE = 'Stage layout, Hall B';

/** A procedural sheet frame drawn by the app, with its own invented geometry. */
export function sheetFrame(index: number, width = 180, height = 128): SVGSVGElement {
  const frame = svg('svg', {
    class: 'sheet-frame-svg',
    viewBox: '0 0 180 128',
    width: String(width),
    height: String(height),
    'data-frame-index': String(index),
  });
  frame.append(svg('rect', { x: '2', y: '2', width: '176', height: '124', class: 'frame-border' }));
  frame.append(svg('rect', { x: '120', y: '100', width: '56', height: '24', class: 'frame-title-block' }));
  const seed = index + 1;
  for (let line = 0; line < 6 + (seed % 5); line += 1) {
    const offset = ((line * 13 + seed * 7) % 90) + 10;
    frame.append(
      svg('line', {
        x1: String(10 + ((line * 11 + seed) % 40)),
        y1: String(offset),
        x2: String(40 + ((line * 17 + seed * 3) % 70)),
        y2: String(offset - ((line * 5 + seed) % 30)),
        class: 'frame-line',
      }),
    );
  }
  if (seed % 3 === 0) {
    frame.append(svg('circle', { cx: String(40 + (seed % 30)), cy: '50', r: String(8 + (seed % 10)), class: 'frame-line' }));
  }
  if (seed % 4 === 0) {
    frame.append(
      svg('polyline', {
        points: '20,100 50,90 70,100 100,86',
        class: 'frame-line',
      }),
    );
  }
  return frame;
}

export function landingScreen(root: HTMLElement): void {
  clear(root);
  const page = el('main', { class: 'landing' });
  page.append(el('h1', { class: 'display landing-name' }, ['Plotfold']));
  const signIn = el('a', { href: '/signin', class: 'landing-signin' }, ['Sign in']);
  page.append(signIn);
  page.append(el('p', { class: 'landing-sentence' }, ['Draw to scale, publish, then review.']));
  page.append(el('a', { href: '/register', class: 'landing-start' }, ['Start drawing']));

  const strip = el('div', { role: 'region', 'aria-label': 'Sheet strip', class: 'sheet-strip' });
  const caption = el('p', { class: 'strip-caption' }, [CENTRED_TITLE]);
  strip.append(el('div', { class: 'strip-spacer', 'aria-hidden': 'true' }));
  SHEET_TITLES.forEach((title, index) => {
    const frame = el('figure', {
      class: 'sheet-frame',
      'data-sheet-title': title,
      'data-lit': title === CENTRED_TITLE ? 'true' : 'false',
    });
    frame.append(sheetFrame(index));
    strip.append(frame);
  });
  strip.append(el('div', { class: 'strip-spacer', 'aria-hidden': 'true' }));
  page.append(strip, caption);
  root.append(page);

  const lightCentre = (): void => {
    const middle = strip.scrollLeft + strip.clientWidth / 2;
    let best: HTMLElement | null = null;
    let bestDistance = Infinity;
    for (const frame of strip.querySelectorAll<HTMLElement>('.sheet-frame')) {
      const centre = frame.offsetLeft + frame.offsetWidth / 2;
      const distance = Math.abs(centre - middle);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = frame;
      }
      frame.setAttribute('data-lit', 'false');
    }
    if (best) {
      best.setAttribute('data-lit', 'true');
      caption.textContent = best.getAttribute('data-sheet-title') ?? '';
    }
  };

  on(strip, 'scroll', () => lightCentre());
  requestAnimationFrame(() => {
    const target = strip.querySelector<HTMLElement>(`[data-sheet-title="${CENTRED_TITLE}"]`);
    if (target) strip.scrollLeft = target.offsetLeft + target.offsetWidth / 2 - strip.clientWidth / 2;
    lightCentre();
  });
}
