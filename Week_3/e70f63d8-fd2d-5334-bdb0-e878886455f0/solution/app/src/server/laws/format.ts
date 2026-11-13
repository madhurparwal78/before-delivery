import { plural } from '../../shared/copy.js';
import { BALLS_PER_OVER } from '../../shared/rules.js';

/** Overs notation: `<completed overs>.<legal balls of the over in progress>`, with `.0` left out. */
export const oversText = (legalBalls: number): string => {
  const whole = Math.floor(legalBalls / BALLS_PER_OVER);
  const rest = legalBalls % BALLS_PER_OVER;
  return rest === 0 ? `${whole}` : `${whole}.${rest}`;
};

/** A two-decimal value, rounded half away from zero in integer arithmetic; `-` when the denominator is 0. */
export const ratio = (numerator: number, denominator: number): string => {
  if (denominator === 0) return '-';
  const hundredths = Math.floor((numerator * 200 + denominator) / (2 * denominator));
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;
};

export const runsPhrase = (runs: number): string => plural(runs, 'run', 'runs');
export const ballsPhrase = (balls: number): string => plural(balls, 'ball', 'balls');
export const wicketsPhrase = (wickets: number): string => plural(wickets, 'wicket', 'wickets');
