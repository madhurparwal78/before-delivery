import { el, prefersReducedMotion } from '../dom.js';

const MORPH_MS = 400;

interface Pending {
  readonly sessionId: string;
  readonly rect: DOMRect;
  readonly image: string | null;
}

let pending: Pending | null = null;

const snapshot = (source: HTMLElement): string | null => {
  if (!(source instanceof HTMLCanvasElement)) return null;
  try {
    return source.toDataURL('image/png');
  } catch {
    return null;
  }
};

/** Remembers a row thumbnail's on-screen place so the detail field header can grow from it. */
export const setPendingMorph = (sessionId: string, source: HTMLElement): void => {
  pending = { sessionId, rect: source.getBoundingClientRect(), image: snapshot(source) };
};

/**
 * Grows the remembered thumbnail into the field header. Exactly one element
 * carries the data-morph value at a time, and it lands on the header.
 */
export const runMorph = (sessionId: string, header: HTMLElement): boolean => {
  const start = pending;
  pending = null;
  if (start === null || start.sessionId !== sessionId || prefersReducedMotion()) return false;
  const target = header.getBoundingClientRect();
  if (target.width === 0 || target.height === 0) return false;

  header.removeAttribute('data-morph');
  const flyer = el('div', { class: 'morph-flyer', 'data-morph': sessionId });
  flyer.style.left = `${start.rect.left}px`;
  flyer.style.top = `${start.rect.top}px`;
  flyer.style.width = `${start.rect.width}px`;
  flyer.style.height = `${start.rect.height}px`;
  if (start.image !== null) flyer.style.backgroundImage = `url(${start.image})`;
  document.body.append(flyer);

  const animation = flyer.animate(
    [
      { left: `${start.rect.left}px`, top: `${start.rect.top}px`, width: `${start.rect.width}px`, height: `${start.rect.height}px` },
      { left: `${target.left}px`, top: `${target.top}px`, width: `${target.width}px`, height: `${target.height}px` },
    ],
    { duration: MORPH_MS, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' },
  );
  animation.addEventListener('finish', () => {
    flyer.remove();
    header.setAttribute('data-morph', sessionId);
  });
  return true;
};
