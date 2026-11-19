// The sound graph: nothing exists until the first press of Sound.

interface Graph {
  ctx: AudioContext;
  ambience: AudioBufferSourceNode;
  musicGain: GainNode;
  effectsGain: GainNode;
  masterGain: GainNode;
}

let graph: Graph | null = null;
let on = false;

/** Creates the graph on first use: one looping generated ambience source, music and effects gains, one master gain. */
function ensureGraph(): Graph {
  if (graph) return graph;
  const ctx = new AudioContext();
  const sampleRate = ctx.sampleRate;
  const seconds = 4;
  const buffer = ctx.createBuffer(1, sampleRate * seconds, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    // Two slow beating sines and a soft wash: generated island ambience.
    data[i] = 0.12 * Math.sin(2 * Math.PI * 110 * t) * Math.sin(2 * Math.PI * 0.5 * t)
      + 0.08 * Math.sin(2 * Math.PI * 164 * t + Math.sin(2 * Math.PI * 0.23 * t))
      + 0.02 * (Math.random() * 2 - 1);
  }
  const ambience = ctx.createBufferSource();
  ambience.buffer = buffer;
  ambience.loop = true;
  const musicGain = ctx.createGain();
  musicGain.gain.value = 0.6;
  const effectsGain = ctx.createGain();
  effectsGain.gain.value = 0.8;
  const masterGain = ctx.createGain();
  masterGain.gain.value = 0;
  ambience.connect(musicGain).connect(masterGain);
  masterGain.connect(ctx.destination);
  ambience.start();
  graph = { ctx, ambience, musicGain, effectsGain, masterGain };
  return graph;
}

/** Returns the new sound state. The first press creates the graph and sets master gain to 1. */
export function toggleSound(): boolean {
  const g = ensureGraph();
  void g.ctx.resume();
  on = !on;
  g.masterGain.gain.setTargetAtTime(on ? 1 : 0, g.ctx.currentTime, 0.02);
  return on;
}

export function soundIsOn(): boolean {
  return on;
}

/** One-shot effect through the effects gain, used for the shutter. */
export function playEffect(kind: "shutter"): void {
  if (!graph || !on) return;
  const g = graph;
  const ctx = g.ctx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = kind === "shutter" ? 660 : 440;
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
  osc.connect(gain).connect(g.effectsGain);
  g.effectsGain.disconnect();
  g.effectsGain.connect(g.masterGain);
  osc.start();
  osc.stop(ctx.currentTime + 0.13);
}

/** Settings volumes: music and effects gains are value / 100. */
export function setVolumes(music: number, effects: number): void {
  if (!graph) return;
  graph.musicGain.gain.value = music / 100;
  graph.effectsGain.gain.value = effects / 100;
}
