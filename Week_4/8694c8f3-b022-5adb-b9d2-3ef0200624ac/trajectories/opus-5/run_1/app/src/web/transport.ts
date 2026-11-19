import { MAX_TICK, TICKS_PER_BEAT } from '../shared/domain.js';

/** The one clock behind the beat transport, the Beat clock node, u_beat and script onBeat. */
export class Transport {
  playing = false;
  tick = 0;
  bpm = 120;
  private lastMoment: number | null = null;
  private lastWholeBeat = -1;

  play(): void {
    this.playing = true;
    this.lastMoment = null;
  }

  pause(): void {
    this.playing = false;
    this.lastMoment = null;
  }

  stop(): void {
    this.playing = false;
    this.lastMoment = null;
    this.tick = 0;
    this.lastWholeBeat = -1;
  }

  stepBeat(): void {
    this.seek(Math.floor(this.tick / TICKS_PER_BEAT + 1) * TICKS_PER_BEAT);
  }

  seek(tick: number): void {
    this.tick = Math.max(0, Math.min(MAX_TICK - 1, tick));
    this.lastWholeBeat = Math.floor(this.tick / TICKS_PER_BEAT) - 1;
  }

  /** Advances the playhead and returns the whole beats crossed since the last frame. */
  advance(moment: number): number[] {
    if (!this.playing) {
      this.lastMoment = null;
      return [];
    }
    const previous = this.lastMoment;
    this.lastMoment = moment;
    if (previous === null) return [];
    const elapsedSeconds = (moment - previous) / 1000;
    this.tick = (this.tick + elapsedSeconds * (this.bpm / 60) * TICKS_PER_BEAT) % MAX_TICK;
    const beat = Math.floor(this.tick / TICKS_PER_BEAT);
    const crossed: number[] = [];
    if (beat !== this.lastWholeBeat) {
      crossed.push(beat);
      this.lastWholeBeat = beat;
    }
    return crossed;
  }

  get beats(): number {
    return this.tick / TICKS_PER_BEAT;
  }

  get seconds(): number {
    return (this.tick / TICKS_PER_BEAT) * (60 / this.bpm);
  }
}
