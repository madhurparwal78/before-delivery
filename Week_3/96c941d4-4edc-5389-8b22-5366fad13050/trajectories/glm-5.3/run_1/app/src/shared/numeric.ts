import { canonicalize } from './canonical.js';
export { canonicalize };

// Integer division rules: half away from zero for general gameplay; explicit
// downward (floor for nonnegative operands) quotients at documented sites.
export function divHalfAway(numerator: number, denominator: number): number {
  const magnitude = Math.floor((Math.abs(numerator) * 2 + denominator) / (denominator * 2));
  return numerator < 0 ? -magnitude : magnitude;
}

export function divDown(numerator: number, denominator: number): number {
  return Math.floor(numerator / denominator);
}

// xorshift32 with published shifts 13, 17, 5 (unsigned 32-bit).
export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  get stateValue(): number {
    return this.state;
  }
  set stateValue(value: number) {
    this.state = value >>> 0;
  }
  next(): number {
    let x = this.state;
    x ^= (x << 13) >>> 0;
    x >>>= 0;
    x ^= x >>> 17;
    x >>>= 0;
    x ^= (x << 5) >>> 0;
    x >>>= 0;
    this.state = x;
    return x >>> 0;
  }
}

export function rngLaneChoice(draw: number, laneCount: number): number {
  return 1 + (draw % laneCount);
}

// Charge and time formatting (single source for all displayed conversions).

export function formatMilliCharge(milli: number): string {
  const sign = milli < 0 ? '\u2212' : '';
  const magnitude = Math.abs(milli);
  const whole = Math.floor(magnitude / 1000);
  const frac = (magnitude % 1000).toString().padStart(3, '0');
  return `${sign}${whole}.${frac}`;
}

export function formatTicks(tick: number): string {
  const seconds = tick / 20;
  const minutes = Math.floor(seconds / 60);
  const secondsPart = Math.floor(seconds % 60);
  const tenth = Math.round((seconds - Math.floor(seconds)) * 1000);
  const minuteText = minutes.toString().padStart(2, '0');
  return `${minuteText}:${secondsPart.toString().padStart(2, '0')}.${tenth.toString().padStart(3, '0')}`;
}

// Converts a displayed mm:ss.ttt game-time string to ticks; rejects boundary values
// (must be a whole number of the 0.05s tick quantum, i.e. tick*50ms).
export function parseTicks(text: string): number | null {
  const match = /^(\d{2,}):([0-5]\d)\.(\d{3})$/.exec(text.trim());
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const millis = Number(match[3]);
  const totalMillis = minutes * 60000 + seconds * 1000 + millis;
  if (totalMillis % 50 !== 0) return null;
  return totalMillis / 50;
}

export const TICK_RATE = 20;
export const CELL_WIDTH = 1000;
export const SPAWN_POSITION = 8999;
export const HARBOUR_POSITION = 0;
export const LANES = 5;
export const CELLS_PER_LANE = 9;
