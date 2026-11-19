import { clock, reducedMotion, moveEase } from './clock';

export interface Config { moveMs: number; progressMs: number; toastMs: number; holdTimeoutMs: number; }

let cfg: Config = { moveMs: 320, progressMs: 400, toastMs: 4000, holdTimeoutMs: 30000 };

export function config(): Config { return cfg; }

export async function loadConfig(): Promise<void> {
  try {
    const r = await fetch('/api/config');
    if (r.ok) cfg = await r.json() as Config;
  } catch { /* keep defaults */ }
}

/**
 * Animates a moved element from its old place to its new one on the page clock,
 * exposing data-move-progress and data-motion per the published samples.
 */
export function animateMove(el: HTMLElement, applyEnd: () => void): void {
  const duration = config().moveMs;
  el.setAttribute('data-motion', 'moving');
  if (reducedMotion()) {
    applyEnd();
    el.setAttribute('data-move-progress', '1.0000');
    el.setAttribute('data-motion', 'settled');
    return;
  }
  const start = clock.now();
  let done = false;
  const step = (t: number): void => {
    if (done) return;
    const x = Math.min(1, (t - start) / duration);
    const eased = moveEase(x);
    el.setAttribute('data-move-progress', eased.toFixed(4));
    if (x < 1) {
      clock.onFrame(step);
    } else {
      done = true;
      el.setAttribute('data-move-progress', '1.0000');
      el.setAttribute('data-motion', 'settled');
      applyEnd();
    }
  };
  clock.onFrame(step);
}

/** A progress bar's drawn width easing, exposed as data-shown-percent. */
export function animateProgress(bar: HTMLElement, from: number, to: number): void {
  const duration = config().progressMs;
  bar.setAttribute('data-shown-percent', from.toFixed(2));
  if (reducedMotion()) {
    setBarWidth(bar, to);
    bar.setAttribute('data-shown-percent', to.toFixed(2));
    return;
  }
  const start = clock.now();
  const step = (t: number): void => {
    const x = Math.min(1, (t - start) / duration);
    const eased = moveEase(x);
    const v = from + (to - from) * eased;
    setBarWidth(bar, v);
    bar.setAttribute('data-shown-percent', v.toFixed(2));
    if (x < 1) clock.onFrame(step);
    else bar.setAttribute('data-shown-percent', to.toFixed(2));
  };
  clock.onFrame(step);
}

function setBarWidth(bar: HTMLElement, pct: number): void {
  bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

/** A rule run entry sliding in from 8px over 160ms. */
export function animateRunEntry(el: HTMLElement): void {
  const duration = 160;
  el.setAttribute('data-motion', 'entering');
  if (reducedMotion()) {
    el.style.transform = 'translateY(0)';
    el.setAttribute('data-slide-offset', '0.00');
    el.setAttribute('data-motion', 'settled');
    return;
  }
  const start = clock.now();
  const step = (t: number): void => {
    const x = Math.min(1, (t - start) / duration);
    const eased = moveEase(x);
    const offset = 8 * (1 - eased);
    el.style.transform = `translateY(${offset.toFixed(2)}px)`;
    el.setAttribute('data-slide-offset', offset.toFixed(2));
    if (x < 1) clock.onFrame(step);
    else {
      el.setAttribute('data-slide-offset', '0.00');
      el.setAttribute('data-motion', 'settled');
    }
  };
  clock.onFrame(step);
}

/** A dependent formula cell cross-fading over 240ms. */
export function animateFade(el: HTMLElement, applyEnd: () => void): void {
  const duration = 240;
  el.setAttribute('data-motion', 'fading');
  if (reducedMotion()) {
    applyEnd();
    el.setAttribute('data-motion', 'settled');
    return;
  }
  const start = clock.now();
  const step = (t: number): void => {
    const x = Math.min(1, (t - start) / duration);
    el.style.opacity = String(0.35 + 0.65 * moveEase(x));
    if (x < 1) clock.onFrame(step);
    else {
      el.style.opacity = '1';
      el.setAttribute('data-motion', 'settled');
    }
  };
  clock.onFrame(step);
}
