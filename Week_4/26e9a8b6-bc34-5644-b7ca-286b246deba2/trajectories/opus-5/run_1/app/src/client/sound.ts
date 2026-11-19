const MASTER_GAIN_LEVEL = 0.25;
const LOOP_SECONDS = 2;

/**
 * Workshop sound: before the first press no audio context is created, no
 * source is started and no gain is connected. The first press starts one
 * looping generated source through one master gain.
 */
export class WorkshopSound {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private on = false;

  press(): boolean {
    if (this.context === null) {
      this.start();
      this.on = true;
      return true;
    }
    this.on = !this.on;
    if (this.master !== null) {
      this.master.gain.value = this.on ? MASTER_GAIN_LEVEL : 0;
    }
    return this.on;
  }

  private start(): void {
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = MASTER_GAIN_LEVEL;
    master.connect(context.destination);

    const frames = Math.floor(context.sampleRate * LOOP_SECONDS);
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const channel = buffer.getChannelData(0);
    let low = 0;
    for (let i = 0; i < frames; i += 1) {
      const white = Math.random() * 2 - 1;
      low = low * 0.96 + white * 0.04;
      const fade = Math.min(1, Math.min(i, frames - i) / (context.sampleRate * 0.05));
      channel[i] = low * 3 * fade;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(master);
    source.start();

    this.context = context;
    this.master = master;
  }
}
