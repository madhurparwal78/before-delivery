import { call } from './api.js';
import { COPY, livePeople } from './copy.js';
import { two } from './dom.js';
import { prefersReducedMotion } from './motion.js';

/** The band's numerals roll up from zero once, the first time the band comes on screen. */
export function rollNumerals(host: HTMLElement): void {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.disconnect();
      roll(host);
    }
  });
  observer.observe(host);
}

function roll(host: HTMLElement): void {
  const numerals = [...host.querySelectorAll<HTMLElement>('[data-roll]')];
  for (const numeral of numerals) {
    const target = Number(numeral.dataset['roll']);
    const pad = Number(numeral.dataset['pad'] ?? '0');
    const show = (value: number): void => {
      numeral.textContent = pad > 1 ? two(value) : String(value);
    };
    if (prefersReducedMotion()) {
      show(target);
      continue;
    }
    const started = performance.now();
    const step = (at: number): void => {
      const share = Math.min(1, (at - started) / 900);
      show(Math.round(target * (1 - Math.pow(1 - share, 3))));
      if (share < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

interface TonightAnswer {
  keeping: number;
}

/** The live count, refreshed every 60 seconds while the band is on screen. */
export function watchLiveCount(line: HTMLElement, band: HTMLElement): void {
  let onScreen = true;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) onScreen = entry.isIntersecting;
  });
  observer.observe(band);

  const refresh = async (): Promise<void> => {
    const answer = await call<TonightAnswer>('GET', '/api/tonight');
    line.textContent =
      answer.data && typeof answer.data.keeping === 'number'
        ? livePeople(answer.data.keeping)
        : COPY.liveCountResting;
  };

  void refresh();
  window.setInterval(() => {
    if (onScreen) void refresh();
  }, 60_000);
}
