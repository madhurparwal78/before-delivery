import { beatOf, secondsAt, TICK_LIMIT, TICKS_PER_BEAT } from "../../shared/beat.ts";

/** The one beat clock: timeline, graph, keys, scripts and shaders all read the playhead from here. */
export class Transport {
  private playing = false;
  private anchorNow = 0;
  private anchorTick = 0;
  private bpmValue = 120;
  private readonly listeners = new Set<() => void>();

  get bpm(): number {
    return this.bpmValue;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  tick(now = performance.now()): number {
    if (!this.playing) return this.anchorTick;
    const elapsed = ((now - this.anchorNow) / 1000) * (this.bpmValue / 60) * TICKS_PER_BEAT;
    return (this.anchorTick + elapsed) % TICK_LIMIT;
  }

  beat(now = performance.now()): number {
    return beatOf(this.tick(now));
  }

  seconds(now = performance.now()): number {
    return secondsAt(this.tick(now), this.bpmValue);
  }

  private rebase(tick: number): void {
    this.anchorTick = tick;
    this.anchorNow = performance.now();
  }

  setBpm(bpm: number): void {
    if (bpm === this.bpmValue) return;
    this.rebase(this.tick());
    this.bpmValue = bpm;
    this.emit();
  }

  play(): void {
    if (this.playing) return;
    this.rebase(this.anchorTick);
    this.playing = true;
    this.emit();
  }

  pause(): void {
    if (!this.playing) return;
    this.rebase(this.tick());
    this.playing = false;
    this.emit();
  }

  stop(): void {
    this.playing = false;
    this.rebase(0);
    this.emit();
  }

  step(): void {
    this.rebase((this.tick() + TICKS_PER_BEAT) % TICK_LIMIT);
    this.emit();
  }

  seek(tick: number): void {
    this.rebase(tick);
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
