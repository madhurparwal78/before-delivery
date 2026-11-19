// The adaptive score: one AudioContext, four looping buffer sources per station started at one shared time,
// each through its own gain into a single master gain. Layers cross over on equal-power curves.

import { LAYERS, type Layer } from "../../shared/credits.js";

const CROSSFADE_S = 0.4;
const LINK_END_S = 0.35;
const CURVE_POINTS = 64;

interface StemSource {
  layer: Layer;
  url: string;
}

interface Playing {
  key: string;
  sources: AudioBufferSourceNode[];
  gains: Map<Layer, GainNode>;
}

/** Equal-power curve from `from` towards `to`: sine-shaped rise, cosine-shaped fall. */
function equalPower(from: number, to: number): Float32Array {
  const curve = new Float32Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i += 1) {
    const x = i / (CURVE_POINTS - 1);
    curve[i] = to > from
      ? from + (to - from) * Math.sin((x * Math.PI) / 2)
      : to + (from - to) * Math.cos((x * Math.PI) / 2);
  }
  return curve;
}

function ramp(param: AudioParam, to: number, now: number, seconds: number): void {
  const from = param.value;
  param.cancelScheduledValues(0);
  param.setValueAtTime(from, now);
  if (Math.abs(from - to) < 1e-4) return;
  param.setValueCurveAtTime(equalPower(from, to), now + 0.005, seconds);
}

export class ScoreEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private audible = false;
  private readonly decoded = new Map<string, Promise<Map<Layer, AudioBuffer> | null>>();
  private playing: Playing | null = null;
  private wanted: { key: string; stems: StemSource[]; active: Set<Layer> } | null = null;
  private onGone: (status: number) => void = () => undefined;

  /** Must run inside the click or key press that asked for sound. */
  start(): void {
    if (this.context) return;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = this.audible ? 1 : 0;
    this.master.connect(this.context.destination);
    void this.context.resume();
    if (this.wanted) this.play(this.wanted.key, this.wanted.stems, this.wanted.active);
  }

  get started(): boolean {
    return this.context !== null;
  }

  setAudible(audible: boolean): void {
    this.audible = audible;
    if (this.context && this.master) {
      void this.context.resume();
      ramp(this.master.gain, audible ? 1 : 0, this.context.currentTime, 0.12);
    }
  }

  private load(key: string, stems: StemSource[], onGone: (status: number) => void): Promise<Map<Layer, AudioBuffer> | null> {
    let found = this.decoded.get(key);
    if (!found && this.context) {
      const context = this.context;
      found = Promise.all(stems.map(async (stem) => {
        const response = await fetch(stem.url, { credentials: "same-origin" });
        if (response.status === 404 || response.status === 410) onGone(response.status);
        if (!response.ok) throw new Error(`stem ${response.status}`);
        return [stem.layer, await context.decodeAudioData(await response.arrayBuffer())] as const;
      })).then((pairs) => new Map(pairs), () => {
        this.decoded.delete(key);
        return null;
      });
      this.decoded.set(key, found);
    }
    return found ?? Promise.resolve(null);
  }

  /** Called when a stem request answers 404 or 410 (private pages re-check their link at once). */
  watchStems(handler: (status: number) => void): void {
    this.onGone = handler;
  }

  /** The current station: all four layers loop together from now, with `active` layers audible. */
  play(key: string, stems: StemSource[], active: Set<Layer>): void {
    this.wanted = { key, stems, active: new Set(active) };
    if (!this.context || !this.master) return;
    if (this.playing?.key === key) {
      this.setLayers(active);
      return;
    }
    this.stop();
    const context = this.context;
    const master = this.master;
    void this.load(key, stems, this.onGone).then((buffers) => {
      if (!buffers || this.wanted?.key !== key || this.playing?.key === key) return;
      const at = context.currentTime + 0.06;
      const gains = new Map<Layer, GainNode>();
      const sources: AudioBufferSourceNode[] = [];
      for (const layer of LAYERS) {
        const buffer = buffers.get(layer);
        if (!buffer) continue;
        const gain = context.createGain();
        gain.gain.value = 0;
        gain.connect(master);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(gain);
        source.start(at);
        gains.set(layer, gain);
        sources.push(source);
      }
      this.playing = { key, sources, gains };
      this.setLayers(this.wanted.active);
    });
  }

  setLayers(active: Set<Layer>): void {
    if (this.wanted) this.wanted.active = new Set(active);
    if (!this.context || !this.playing) return;
    const now = this.context.currentTime;
    for (const [layer, gain] of this.playing.gains) ramp(gain.gain, active.has(layer) ? 1 : 0, now, CROSSFADE_S);
  }

  /** No station is current: layers fade out and the sources stop. */
  stop(seconds = CROSSFADE_S): void {
    const playing = this.playing;
    this.playing = null;
    if (!playing || !this.context) return;
    const now = this.context.currentTime;
    for (const gain of playing.gains.values()) ramp(gain.gain, 0, now, seconds);
    for (const source of playing.sources) source.stop(now + seconds + 0.05);
  }

  idle(): void {
    this.wanted = null;
    this.stop();
  }

  /** The link-end fade: every layer to silence within 400 ms. */
  silence(): void {
    this.wanted = null;
    this.stop(LINK_END_S);
  }
}
