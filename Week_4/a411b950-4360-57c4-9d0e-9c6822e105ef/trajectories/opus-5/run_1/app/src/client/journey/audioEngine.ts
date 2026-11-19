import { LAYERS, type Layer } from '../../shared/projectStatus.ts';

export const LAYER_FADE_SECONDS = 0.4;
const CURVE_POINTS = 33;

export type StationStems = { slug: string; stems: Array<{ layer: Layer; url: string }> };

/** An equal-power curve, so two layers crossing over keep a constant total power. */
function equalPowerCurve(from: number, to: number): Float32Array {
  const curve = new Float32Array(CURVE_POINTS);
  for (let index = 0; index < CURVE_POINTS; index += 1) {
    const progress = index / (CURVE_POINTS - 1);
    const rising = Math.sin((progress * Math.PI) / 2);
    const falling = Math.cos((progress * Math.PI) / 2);
    curve[index] = to > from ? from + (to - from) * rising : to + (from - to) * falling;
  }
  return curve;
}

type LayerVoice = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  level: number;
};

export class AudioEngine {
  private context: AudioContext | null = null;
  private audible = false;
  private readonly buffers = new Map<string, AudioBuffer>();
  private voices = new Map<Layer, LayerVoice>();
  private playing: string | null = null;
  private generation = 0;

  /** Must be called inside the click or key press that chose to listen. */
  start(): void {
    if (this.context !== null) return;
    const Constructor = window.AudioContext;
    this.context = new Constructor();
    void this.context.resume();
  }

  setAudible(audible: boolean): void {
    this.audible = audible;
    if (audible) this.start();
    for (const [, voice] of this.voices) this.applyLevel(voice, voice.level);
  }

  private applyLevel(voice: LayerVoice, level: number): void {
    const context = this.context;
    if (context === null) return;
    const target = this.audible ? level : 0;
    const current = voice.gain.gain.value;
    voice.gain.gain.cancelScheduledValues(context.currentTime);
    if (Math.abs(current - target) < 0.001) {
      voice.gain.gain.setValueAtTime(target, context.currentTime);
      return;
    }
    voice.gain.gain.setValueCurveAtTime(equalPowerCurve(current, target), context.currentTime, LAYER_FADE_SECONDS);
  }

  async playStation(station: StationStems): Promise<void> {
    if (this.playing === station.slug) return;
    this.stop();
    const context = this.context;
    if (context === null || station.stems.length === 0) return;
    this.playing = station.slug;
    const generation = ++this.generation;

    const decoded = await Promise.all(
      station.stems.map(async (stem) => {
        const cached = this.buffers.get(stem.url);
        if (cached !== undefined) return { layer: stem.layer, buffer: cached };
        const response = await fetch(stem.url, { cache: 'no-store' });
        if (!response.ok) throw new Error('stem unavailable');
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        this.buffers.set(stem.url, buffer);
        return { layer: stem.layer, buffer };
      }),
    );
    if (generation !== this.generation) return;

    const startAt = context.currentTime + 0.05;
    for (const entry of decoded) {
      const source = context.createBufferSource();
      source.buffer = entry.buffer;
      source.loop = true;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, context.currentTime);
      source.connect(gain).connect(context.destination);
      source.start(startAt);
      this.voices.set(entry.layer, { source, gain, level: 0 });
    }
  }

  setActiveLayers(active: readonly Layer[]): void {
    for (const layer of LAYERS) {
      const voice = this.voices.get(layer);
      if (voice === undefined) continue;
      voice.level = active.includes(layer) ? 1 : 0;
      this.applyLevel(voice, voice.level);
    }
  }

  /** Fades every layer to silence, then releases the sources. */
  fadeToSilence(): void {
    const context = this.context;
    if (context === null) {
      this.stop();
      return;
    }
    for (const [, voice] of this.voices) {
      voice.level = 0;
      this.applyLevel(voice, 0);
    }
    const voices = [...this.voices.values()];
    this.voices = new Map();
    this.playing = null;
    this.generation += 1;
    window.setTimeout(() => {
      for (const voice of voices) {
        voice.source.stop();
        voice.source.disconnect();
        voice.gain.disconnect();
      }
    }, LAYER_FADE_SECONDS * 1000);
  }

  stop(): void {
    this.generation += 1;
    for (const [, voice] of this.voices) {
      voice.source.stop();
      voice.source.disconnect();
      voice.gain.disconnect();
    }
    this.voices = new Map();
    this.playing = null;
  }
}
