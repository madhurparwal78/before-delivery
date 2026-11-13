/** Playback: the page's monotonic clock against the server's frame grid. */

import { snapIndex, type Frame, type FrameRate } from "../shared/frames.js";
import type { Sample } from "../shared/model.js";
import { prefersReducedMotion } from "./dom.js";

export type PlaybackRate = 1 | 10 | 60;

// Inclusive end frame must fit the API cap at 25 fps, with whole-second chunks.
const CHUNK_SECONDS = 119;

type PlaybackCallbacks = {
  samples: () => readonly Sample[];
  fetchFrames: (from: number, to: number, fps: FrameRate) => Promise<Frame[]>;
  onFrame: (frame: Frame | null, snappedIndex: number) => void;
  onEnd: (snappedIndex: number) => void;
};

export class Playback {
  private running = false;
  private startMetMs = 0;
  private startedAt = 0;
  private rate: PlaybackRate = 1;
  private fps: FrameRate = 10;
  private frames: Frame[] = [];
  private fetching = false;
  private generation = 0;
  private chunkEndSeconds = 0;
  private animation = 0;
  private shownIndex = 0;

  constructor(private readonly callbacks: PlaybackCallbacks) {}

  get playing(): boolean {
    return this.running;
  }

  start(startIndex: number, rate: PlaybackRate): void {
    const samples = this.callbacks.samples();
    if (samples.length === 0) {
      return;
    }
    const index = startIndex >= samples.length - 1 ? 0 : startIndex;
    this.shownIndex = index;
    this.rate = rate;
    this.fps = rate === 1 ? 10 : 25;
    this.startMetMs = samples[index].met * 1000;
    this.startedAt = performance.now();
    this.generation += 1;
    this.fetching = false;
    this.frames = [];
    this.chunkEndSeconds = samples[index].met;
    this.running = true;
    if (!prefersReducedMotion()) {
      void this.fetchNextChunk();
    }
    this.animation = requestAnimationFrame(() => this.tick());
  }

  /** Stops playback and reports the sample the frame shown snapped to. */
  pause(): number {
    if (!this.running) {
      return -1;
    }
    this.running = false;
    this.generation += 1;
    cancelAnimationFrame(this.animation);
    return this.shownIndex;
  }

  private playbackMetMs(): number {
    return this.startMetMs + (performance.now() - this.startedAt) * this.rate;
  }

  private async fetchNextChunk(): Promise<void> {
    if (this.fetching) {
      return;
    }
    const samples = this.callbacks.samples();
    const lastMet = samples[samples.length - 1].met;
    if (this.chunkEndSeconds >= lastMet) {
      return;
    }
    this.fetching = true;
    const generation = this.generation;
    const from = this.chunkEndSeconds;
    const to = Math.min(lastMet, from + CHUNK_SECONDS);
    try {
      const chunk = await this.callbacks.fetchFrames(from, to, this.fps);
      if (generation !== this.generation || !this.running) return;
      this.frames = this.frames
        .filter((frame) => frame.met_ms < from * 1000)
        .concat(chunk);
      this.chunkEndSeconds = to;
    } finally {
      if (generation === this.generation) this.fetching = false;
    }
  }

  private tick(): void {
    if (!this.running) {
      return;
    }
    const samples = this.callbacks.samples();
    if (samples.length === 0) {
      this.running = false;
      return;
    }
    const lastMetMs = samples[samples.length - 1].met * 1000;
    const metMs = this.playbackMetMs();
    if (metMs >= lastMetMs) {
      this.running = false;
      this.callbacks.onEnd(samples.length - 1);
      return;
    }
    const snapped = snapIndex(samples, metMs / 1000);
    if (prefersReducedMotion()) {
      this.shownIndex = snapped;
      this.callbacks.onFrame(null, snapped);
    } else {
      let shown: Frame | null = null;
      for (const frame of this.frames) {
        if (frame.met_ms <= metMs) {
          shown = frame;
        } else {
          break;
        }
      }
      if (shown) this.shownIndex = snapIndex(samples, shown.met_ms / 1000);
      this.callbacks.onFrame(shown, this.shownIndex);
      if (metMs > (this.chunkEndSeconds - CHUNK_SECONDS / 2) * 1000) {
        void this.fetchNextChunk();
      }
    }
    this.animation = requestAnimationFrame(() => this.tick());
  }
}
