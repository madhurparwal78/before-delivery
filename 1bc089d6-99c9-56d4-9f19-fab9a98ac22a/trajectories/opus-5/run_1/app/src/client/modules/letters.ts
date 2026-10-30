import { clamp, splitLetters } from './dom.js';
import { prefersReducedMotion } from './motion.js';

/** The hero title fades up letter by letter, in under two seconds. */
export function revealTitle(host: HTMLElement): void {
  const letters = splitLetters(host);
  if (prefersReducedMotion()) return;
  for (const [index, letter] of letters.entries()) {
    letter.style.opacity = '0';
    letter.style.transform = 'translateY(0.18em)';
    letter.style.transition = 'opacity 520ms ease-out, transform 520ms ease-out';
    window.setTimeout(
      () => {
        letter.style.opacity = '1';
        letter.style.transform = 'translateY(0)';
      },
      20 + (index / Math.max(1, letters.length - 1)) * 1300,
    );
  }
}

export interface SettleLine {
  update(progress: number): void;
}

/** The settle line's letters sink into place as its window progress goes from 0 to 0.6. */
export function settleLine(host: HTMLElement): SettleLine {
  const letters = splitLetters(host);
  const scatter = letters.map((_, index) => ({
    lift: 0.55 + ((index * 37) % 50) / 100,
    tilt: (((index * 53) % 100) / 100 - 0.5) * 14,
    drift: (((index * 71) % 100) / 100 - 0.5) * 0.3,
  }));
  if (prefersReducedMotion()) {
    return { update: () => undefined };
  }
  return {
    update(progress) {
      const settled = clamp(progress / 0.6, 0, 1);
      const left = 1 - settled;
      for (const [index, letter] of letters.entries()) {
        const shape = scatter[index]!;
        letter.style.transform = `translate(${shape.drift * left}em, ${-shape.lift * left}em) rotate(${shape.tilt * left}deg)`;
        letter.style.opacity = String(0.35 + 0.65 * settled);
      }
    },
  };
}
