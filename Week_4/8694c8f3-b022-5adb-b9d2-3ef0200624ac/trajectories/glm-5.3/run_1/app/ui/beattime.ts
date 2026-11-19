export const TICKS_PER_BEAT = 96;
export const TICKS_PER_BAR = 384;
export const MAX_TICK = 24_576;

// The one place that converts a tick to a bars:beats string.
export function barBeatString (tick: number): string {
  const bar = Math.floor(tick / TICKS_PER_BAR) + 1;
  const withinBar = tick % TICKS_PER_BAR;
  const beat = withinBar / TICKS_PER_BEAT + 1;
  const whole = Math.floor(beat);
  const fraction = beat - whole;
  const text = fraction === 0
    ? String(whole)
    : `${whole}${fraction.toFixed(2).replace(/0+$/, '').slice(1)}`;
  return `${bar}:${text}`;
}

export const secondsAtBpm = (tick: number, bpm: number): number => (tick / TICKS_PER_BEAT) * 60 / bpm;

export function playheadString (tick: number, bpm: number): string {
  return `${barBeatString(tick)} ${secondsAtBpm(tick, bpm).toFixed(3)} s`;
}

// New keys snap to the nearest quarter beat; an exact half rounds later.
export function snapToQuarterBeat (tick: number): number {
  const remainder = tick % 24;
  return remainder < 12 ? tick - remainder : tick - remainder + 24;
}

export function valueAtTick (keys: { tick: number; value: number }[], tick: number, fallback: number): number {
  const sorted = [...keys].sort((a, b) => a.tick - b.tick);
  if (sorted.length === 0) return fallback;
  if (tick <= sorted[0].tick) return sorted[0].value;
  if (tick >= sorted[sorted.length - 1].tick) return sorted[sorted.length - 1].value;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (tick >= a.tick && tick <= b.tick) {
      const t = (tick - a.tick) / (b.tick - a.tick);
      return a.value + (b.value - a.value) * t;
    }
  }
  return fallback;
}
