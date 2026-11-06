/** Every sound in Stillhour: one ambient bed, three chimes and the film, on one master volume. */

const STORAGE_KEY = 'stillhour.sound';
const FADE_SECONDS = 0.4;

export type ChimeName = 'ritual' | 'breath' | 'saved';

const FILES: Record<string, string> = {
  ambient: '/audio/ambient-night.wav',
  ritual: '/audio/chime-ritual.wav',
  breath: '/audio/chime-breath.wav',
  saved: '/audio/chime-saved.wav',
};

const buffers = new Map<string, AudioBuffer>();

let context: AudioContext | null = null;
let master: GainNode | null = null;
let ambient: AudioBufferSourceNode | null = null;
let ambientGain: GainNode | null = null;
let on = false;

export const soundIsOn = (): boolean => on;

export const rememberedChoice = (): 'on' | 'off' | null => {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'on' || stored === 'off' ? stored : null;
};

function ensureContext(): AudioContext | null {
  if (context) return context;
  const Constructor = window.AudioContext;
  if (!Constructor) return null;
  context = new Constructor();
  master = context.createGain();
  master.gain.value = 0;
  master.connect(context.destination);
  return context;
}

/** Decodes one of the app's own audio files. A failure simply leaves that sound silent. */
export async function loadSound(name: string): Promise<void> {
  const audio = ensureContext();
  if (!audio) return;
  try {
    const response = await fetch(FILES[name]!);
    const bytes = await response.arrayBuffer();
    buffers.set(name, await audio.decodeAudioData(bytes));
  } catch {
    buffers.delete(name);
  }
}

export const soundNames = Object.keys(FILES);

function fadeMaster(target: number): void {
  if (!context || !master) return;
  const at = context.currentTime;
  master.gain.cancelScheduledValues(at);
  master.gain.setValueAtTime(master.gain.value, at);
  master.gain.linearRampToValueAtTime(target, at + FADE_SECONDS);
}

export function setSound(next: boolean): void {
  on = next;
  localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off');
  const audio = ensureContext();
  if (!audio) return;
  if (next && audio.state === 'suspended') void audio.resume();
  fadeMaster(next ? 1 : 0);
}

/** Starts the looping ambient bed. Its level follows the master volume. */
export function startAmbient(): void {
  const audio = ensureContext();
  if (!audio || !master || ambient) return;
  const buffer = buffers.get('ambient');
  if (!buffer) return;
  ambientGain = audio.createGain();
  ambientGain.gain.value = 0.5;
  ambientGain.connect(master);
  ambient = audio.createBufferSource();
  ambient.buffer = buffer;
  ambient.loop = true;
  ambient.connect(ambientGain);
  ambient.start();
}

export function chime(name: ChimeName): void {
  const audio = ensureContext();
  if (!audio || !master) return;
  const buffer = buffers.get(name);
  if (!buffer) return;
  const source = audio.createBufferSource();
  source.buffer = buffer;
  const level = audio.createGain();
  level.gain.value = 0.7;
  source.connect(level);
  level.connect(master);
  source.start();
}

/** The ambient bed drops to about a third while the film plays. */
export function duckAmbient(ducked: boolean): void {
  if (!context || !ambientGain) return;
  const at = context.currentTime;
  ambientGain.gain.cancelScheduledValues(at);
  ambientGain.gain.setValueAtTime(ambientGain.gain.value, at);
  ambientGain.gain.linearRampToValueAtTime(ducked ? 0.17 : 0.5, at + FADE_SECONDS);
}

let filmSource: MediaElementAudioSourceNode | null = null;

/** Routes the film's own sound through the master volume. */
export function connectFilm(video: HTMLMediaElement): void {
  const audio = ensureContext();
  if (!audio || !master || filmSource) return;
  filmSource = audio.createMediaElementSource(video);
  filmSource.connect(master);
}
