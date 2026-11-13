declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const REPORT_FRAMES = 1024;

/** The audio clock: it counts rendered frames and reports them, so the playhead never drifts. */
class ClockProcessor extends AudioWorkletProcessor {
  private frames = 0;
  private reported = 0;

  constructor() {
    super();
    this.port.postMessage({ type: 'ready', sampleRate });
  }

  process(): boolean {
    this.frames += 128;
    if (this.frames - this.reported >= REPORT_FRAMES) {
      this.reported = this.frames;
      this.port.postMessage({ type: 'frames', frames: this.frames });
    }
    return true;
  }
}

registerProcessor('fairline-clock', ClockProcessor);
