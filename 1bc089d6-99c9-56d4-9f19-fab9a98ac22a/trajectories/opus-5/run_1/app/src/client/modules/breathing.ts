import { chime } from './audio.js';
import { COPY } from './copy.js';
import { prefersReducedMotion } from './motion.js';

interface Phase {
  copy: string;
  seconds: number;
  scale: number;
}

const PHASES: Phase[] = [
  { copy: COPY.breathIn, seconds: 4, scale: 1 },
  { copy: COPY.breathHold, seconds: 7, scale: 1 },
  { copy: COPY.breathOut, seconds: 8, scale: 0.58 },
];

export interface BreathingParts {
  button: HTMLButtonElement;
  status: HTMLElement;
  round: HTMLElement;
  seconds: HTMLElement;
  circle: HTMLElement;
}

/** Three rounds of four in, seven held and eight out, announced phase by phase. */
export function breathingGuide(parts: BreathingParts): void {
  let timer = 0;
  let ticker = 0;
  let running = false;

  const stopTimers = (): void => {
    window.clearTimeout(timer);
    window.clearInterval(ticker);
  };

  const settle = (): void => {
    running = false;
    stopTimers();
    parts.button.textContent = 'Breathe with me';
    parts.seconds.hidden = true;
    parts.circle.style.transition = 'transform 400ms ease-out';
    parts.circle.style.transform = prefersReducedMotion() ? 'scale(0.8)' : 'scale(0.58)';
  };

  const runPhase = (round: number, index: number): void => {
    const phase = PHASES[index]!;
    parts.round.textContent = `Round ${round + 1} of 3`;
    parts.status.textContent = phase.copy;
    chime('breath');
    if (prefersReducedMotion()) {
      parts.seconds.hidden = false;
      let left = phase.seconds;
      parts.seconds.textContent = `${left} seconds`;
      ticker = window.setInterval(() => {
        left -= 1;
        if (left > 0) parts.seconds.textContent = `${left} seconds`;
      }, 1000);
    } else {
      parts.circle.style.transition = `transform ${phase.seconds * 1000}ms linear`;
      parts.circle.style.transform = `scale(${phase.scale})`;
    }
    timer = window.setTimeout(() => {
      window.clearInterval(ticker);
      const nextIndex = index + 1;
      if (nextIndex < PHASES.length) {
        runPhase(round, nextIndex);
      } else if (round + 1 < 3) {
        runPhase(round + 1, 0);
      } else {
        settle();
        parts.status.textContent = COPY.breathDone;
      }
    }, phase.seconds * 1000);
  };

  parts.button.addEventListener('click', () => {
    if (running) {
      settle();
      parts.status.textContent = COPY.breathStopped;
      return;
    }
    running = true;
    parts.button.textContent = 'Stop';
    parts.button.focus();
    runPhase(0, 0);
  });
}
