export const TICKS_PER_BEAT = 96;
const BEATS_PER_BAR = 4;
export const TICKS_PER_BAR = TICKS_PER_BEAT * BEATS_PER_BAR;
export const TICK_LIMIT = 24_576;
const SNAP_TICKS = TICKS_PER_BEAT / 4;

export function snapTick(tick: number): number {
  const snapped = Math.floor(tick / SNAP_TICKS + 0.5) * SNAP_TICKS;
  return Math.min(Math.max(snapped, 0), TICK_LIMIT - SNAP_TICKS);
}

export const beatOf = (tick: number): number => tick / TICKS_PER_BEAT;

export const barOfBeat = (beat: number): number => Math.floor(beat / BEATS_PER_BAR) + 1;

export function barsBeats(tick: number): string {
  const beatInBar = (tick % TICKS_PER_BAR) / TICKS_PER_BEAT + 1;
  return `${barOfBeat(beatOf(tick))}:${Number(beatInBar.toFixed(2))}`;
}

export const secondsAt = (tick: number, bpm: number): number => (beatOf(tick) * 60) / bpm;

export function readout(tick: number, bpm: number): string {
  return `${barsBeats(tick)} ${secondsAt(tick, bpm).toFixed(3)} s`;
}

export function roundBpm(value: number): number {
  return Math.floor(value * 10 + 0.5 + 1e-9) / 10;
}
