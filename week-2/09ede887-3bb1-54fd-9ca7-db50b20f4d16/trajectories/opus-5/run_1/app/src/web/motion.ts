import { prefersReducedMotion } from './dom.js';

/**
 * The stagger statement follows the scroll position, not a timer: each row's
 * echoes slide in from both sides and fade as the statement rises towards the
 * middle of the window, and the effect reverses on the way back down.
 */
export function startStagger(section: HTMLElement): () => void {
  if (prefersReducedMotion()) return () => undefined;
  const rows = [...section.querySelectorAll<HTMLElement>('.statement-row')];
  let frame = 0;

  const paint = (): void => {
    frame = 0;
    const box = section.getBoundingClientRect();
    const middle = window.innerHeight / 2;
    const centre = box.top + box.height / 2;
    const span = window.innerHeight / 2 + box.height / 2;
    const raw = (span - (centre - middle)) / span;
    const progress = Math.min(1, Math.max(0, raw));
    for (const [index, row] of rows.entries()) {
      const lead = index * 0.08;
      const rowProgress = Math.min(1, Math.max(0, (progress - lead) / (1 - lead || 1)));
      row.style.setProperty('--settled', rowProgress.toFixed(4));
    }
  };

  const onScroll = (): void => {
    if (frame !== 0) return;
    frame = requestAnimationFrame(paint);
  };

  paint();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  return () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    if (frame !== 0) cancelAnimationFrame(frame);
  };
}

/** The hero photograph drifts up more slowly than the page and darkens out. */
export function startHeroDrift(hero: HTMLElement): () => void {
  const photo = hero.querySelector<HTMLElement>('.hero-photo');
  if (photo === null) return () => undefined;
  const grain = hero.querySelector<HTMLCanvasElement>('.hero-grain');
  if (grain !== null) drawGrain(grain);
  if (prefersReducedMotion()) return () => undefined;
  let frame = 0;
  const paint = (): void => {
    frame = 0;
    const box = hero.getBoundingClientRect();
    const passed = Math.min(1, Math.max(0, -box.top / Math.max(1, box.height)));
    photo.style.setProperty('--drift', `${(passed * 18).toFixed(2)}%`);
    photo.style.setProperty('--dim', passed.toFixed(3));
  };
  const onScroll = (): void => {
    if (frame !== 0) return;
    frame = requestAnimationFrame(paint);
  };
  paint();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  return () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    if (frame !== 0) cancelAnimationFrame(frame);
  };
}

/** A fine film grain the page draws itself, blended faintly over the photograph. */
function drawGrain(canvas: HTMLCanvasElement): void {
  const size = 128;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context === null) return;
  const image = context.createImageData(size, size);
  for (let index = 0; index < image.data.length; index += 4) {
    const shade = 120 + Math.floor(Math.random() * 136);
    image.data[index] = shade;
    image.data[index + 1] = shade;
    image.data[index + 2] = shade;
    image.data[index + 3] = 38;
  }
  context.putImageData(image, 0, 0);
}
