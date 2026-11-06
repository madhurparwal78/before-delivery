import { roundHalfUp } from './util.js';

export type Unit = 'cm' | 'in';

/** The one place that converts unit input into stored millimetres. */
export function unitToMm(value: number, unit: Unit): number {
  return unit === 'cm' ? roundHalfUp(value * 10) : roundHalfUp(value * 25.4);
}
