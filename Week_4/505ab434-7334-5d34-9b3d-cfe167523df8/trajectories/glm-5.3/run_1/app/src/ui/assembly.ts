import { el } from './types';
import { reducedMotion } from './dialog';

/**
 * The rulebook assembly: a pinned stage for 2700px of scroll at desktop widths
 * without reduced motion. Every change below is a direct function of progress,
 * so scrolling back reverses each step.
 */
export function initHome(): void {
  const stage = document.getElementById('home-stage');
  const opening = document.getElementById('opening-cell');
  const promise = document.getElementById('promise-card');
  const mosaic = document.getElementById('mosaic');
  if (!stage || !opening || !promise || !mosaic) return;

  const cue = document.getElementById('jump-cue');
  if (cue) {
    cue.addEventListener('click', () => {
      jumpToMosaic(mosaic);
    });
  }

  const tiles = [...mosaic.querySelectorAll<HTMLElement>('.tile')];
  for (const tile of tiles) {
    tile.addEventListener('focus', () => {
      if (!shouldPin()) return;
      jumpToMosaic(mosaic, tile);
    });
  }

  if (!shouldPin()) {
    observeFade();
    return;
  }

  document.body.classList.add('assembling');
  stage.classList.add('pinned');
  document.body.style.setProperty('--stage-height', '2700px');

  let ticking = false;
  const apply = (): void => {
    ticking = false;
    const progress = Math.min(1, Math.max(0, window.scrollY / 2700));
    setProgress(progress, { opening, promise, mosaic });
  };
  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(apply);
      }
    },
    { passive: true },
  );
  apply();
  window.addEventListener('resize', () => {
    if (!shouldPin()) {
      document.body.classList.remove('assembling');
      stage.classList.remove('pinned');
      clearProgress({ opening, promise, mosaic });
    }
  });
  observeFade();
}

function shouldPin(): boolean {
  return !reducedMotion() && window.innerWidth >= 768;
}

function jumpToMosaic(mosaic: HTMLElement, tile?: HTMLElement): void {
  const target = tile ?? mosaic.querySelector<HTMLElement>('.tile');
  if (shouldPin()) {
    window.scrollTo({ top: 2700, behavior: 'auto' });
  } else {
    mosaic.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }
  if (target) {
    if (reducedMotion()) {
      target.focus();
    } else {
      setTimeout(() => target.focus(), shouldPin() ? 0 : 300);
    }
  }
}

interface Parts {
  opening: HTMLElement;
  promise: HTMLElement;
  mosaic: HTMLElement;
}

function setProgress(progress: number, parts: Parts): void {
  const { opening, promise, mosaic } = parts;
  const fade = clamp01(progress / 0.2);
  opening.style.opacity = String(1 - fade);
  opening.style.transform = `translateY(${-fade * 24}px)`;

  const sideIn = clamp01((progress - 0.2) / 0.3);
  const mid = clamp01((progress - 0.5) / 0.25);
  const final = clamp01((progress - 0.75) / 0.25);

  const openingOpacity = clamp01(1 - progress / 0.2);
  void openingOpacity;

  // Brand promise card: centred square during 0-0.5, then shrinks to the mark tile.
  const cardStart = lerp(14, 26, progress);
  const cardSize = progress < 0.5 ? 500 : lerp(500, 90, mid);
  promise.style.position = 'fixed';
  promise.style.left = '50%';
  promise.style.top = '50%';
  promise.style.transform = `translate(-50%, -50%) scale(${cardSize / 500})`;
  promise.style.opacity = progress < 0.75 ? '1' : String(1 - final * 0.0);
  promise.style.zIndex = '5';
  void cardStart;

  // Side fields slide in from left and right.
  const sideWidth = progress < 0.5 ? lerp(70, 195, sideIn) : lerp(195, 394, mid);
  const stageWidth = window.innerWidth;
  void stageWidth;
  mosaic.style.setProperty('--side-width', `${sideWidth}px`);

  // After progress 1 the stage unpins.
  if (progress >= 1) {
    document.body.classList.remove('assembling');
    stageUnpin(mosaic);
  } else {
    document.body.classList.add('assembling');
  }
  void parts.opening;
}

function stageUnpin(mosaic: HTMLElement): void {
  mosaic.style.setProperty('--side-width', '');
}

function clearProgress(parts: Parts): void {
  parts.opening.style.opacity = '';
  parts.opening.style.transform = '';
  parts.promise.style.position = '';
  parts.promise.style.left = '';
  parts.promise.style.top = '';
  parts.promise.style.transform = '';
  parts.promise.style.opacity = '';
  parts.mosaic.style.removeProperty('--side-width');
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Opacity-only fades for the reduced-motion and phone stack. */
function observeFade(): void {
  const sections = [document.getElementById('opening-cell'), document.getElementById('promise-card'), document.getElementById('mosaic')].filter(
    (node): node is HTMLElement => node !== null,
  );
  if (!('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        if (entry.isIntersecting) {
          target.classList.add('fade-in');
          observer.unobserve(target);
        }
      }
    },
    { threshold: 0.15 },
  );
  for (const section of sections) observer.observe(section);
}

const styleTag = document.createElement('style');
styleTag.textContent = `
.fade-in { animation: fadeIn 0.3s ease-out both; }
@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
@media (prefers-reduced-motion: reduce) {
  .fade-in { animation: none; opacity: 1; }
  .assembling #promise-card, .assembling #opening-cell { position: relative !important; left: auto !important; top: auto !important; transform: none !important; }
}
`;
document.head.append(styleTag);
