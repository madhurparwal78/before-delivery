export const DEPTH_STEP_MS = 60;
export const ROLL_MS = 220;
export const STAMP_MS = 120;
export const TALLY_CAP_MS = 600;

const query = window.matchMedia('(prefers-reduced-motion: reduce)');

let reduced = query.matches;
const listeners = new Set<(value: boolean) => void>();

query.addEventListener('change', (event) => {
  reduced = event.matches;
  for (const listener of listeners) listener(reduced);
});

export function reducedMotion(): boolean {
  return reduced;
}

export function onReducedMotionChange(listener: (value: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export type RollPhase = 'waiting' | 'rolling' | 'settled';

/** Splits a display into one span per character, aligned on the decimal point. */
export function rollingPositions(oldDisplay: string | null, newDisplay: string): boolean[] {
  const characters = Array.from(newDisplay);
  if (oldDisplay === null) return characters.map(() => true);
  const pointOf = (text: string): number => {
    const index = Array.from(text).indexOf('.');
    return index === -1 ? Array.from(text).length : index;
  };
  const oldCharacters = Array.from(oldDisplay);
  const shift = pointOf(newDisplay) - pointOf(oldDisplay);
  return characters.map((character, index) => {
    const source = oldCharacters[index - shift];
    return source === undefined || source !== character;
  });
}

export type RollTimers = { stop: () => void };

export type RollStep = {
  at: number;
  run: () => void;
};

export function scheduleRoll(steps: RollStep[]): RollTimers {
  const handles = steps.map((step) => window.setTimeout(step.run, step.at));
  return {
    stop: () => {
      for (const handle of handles) window.clearTimeout(handle);
    },
  };
}
