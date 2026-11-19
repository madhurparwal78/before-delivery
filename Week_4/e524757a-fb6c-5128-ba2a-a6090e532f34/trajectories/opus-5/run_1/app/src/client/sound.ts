import { byId, setPressed } from './dom.js';

type Graph = {
  context: AudioContext;
  master: GainNode;
  music: GainNode;
  effects: GainNode;
  ambience: AudioBufferSourceNode;
};

let graph: Graph | null = null;
let on = false;
let volumes = { music: 0.6, effects: 0.8 };

function islandAmbience(context: AudioContext): AudioBuffer {
  const seconds = 4;
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const data = buffer.getChannelData(0);
  let low = 0;
  for (let index = 0; index < data.length; index += 1) {
    const noise = Math.random() * 2 - 1;
    low = low * 0.96 + noise * 0.04;
    const swell = 0.5 + 0.5 * Math.sin((index / data.length) * Math.PI * 2);
    data[index] = low * swell * 0.6;
  }
  return buffer;
}

/** The published sound graph: nothing exists until the player asks for sound. */
function create(): Graph {
  const context = new AudioContext();
  const master = context.createGain();
  master.gain.value = 1;
  master.connect(context.destination);
  const music = context.createGain();
  music.gain.value = volumes.music;
  music.connect(master);
  const effects = context.createGain();
  effects.gain.value = volumes.effects;
  effects.connect(master);
  const ambience = context.createBufferSource();
  ambience.buffer = islandAmbience(context);
  ambience.loop = true;
  ambience.connect(music);
  ambience.start();
  return { context, master, music, effects, ambience };
}

export function setVolumes(music: number, effects: number): void {
  volumes = { music: music / 100, effects: effects / 100 };
  if (graph) {
    graph.music.gain.value = volumes.music;
    graph.effects.gain.value = volumes.effects;
  }
}

export function toggleSound(button: HTMLElement): void {
  if (!graph) {
    graph = create();
    on = true;
    setPressed(button, true);
    return;
  }
  on = !on;
  graph.master.gain.value = on ? 1 : 0;
  setPressed(button, on);
}

export function playEffect(frequency: number): void {
  if (!graph || !on) return;
  const oscillator = graph.context.createOscillator();
  const envelope = graph.context.createGain();
  oscillator.frequency.value = frequency;
  envelope.gain.value = 0.2;
  oscillator.connect(envelope);
  envelope.connect(graph.effects);
  oscillator.start();
  oscillator.stop(graph.context.currentTime + 0.08);
}

export function wireSoundButton(): void {
  const button = byId('sound');
  if (!button) return;
  button.addEventListener('click', () => toggleSound(button));
}
