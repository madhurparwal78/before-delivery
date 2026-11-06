// All sound: decoded from the app's own audio files, through one master volume.
import { qs } from './dom.js';

export const AUDIO_FILES = [
  '/media/audio/ambient.mp3',
  '/media/audio/chime-add.mp3',
  '/media/audio/chime-breath.mp3',
  '/media/audio/chime-save.mp3',
] as const;

interface SoundEngine {
  context: AudioContext;
  master: GainNode;
  ambientGain: GainNode;
  buffers: Map<string, AudioBuffer>;
  ambientSource: AudioBufferSourceNode | null;
  filmGain: GainNode | null;
}

let engine: SoundEngine | null = null;
let wanted = false;
let loaded = false;
let loadFailed = false;

export function rememberedSound(): boolean | null {
  const raw = localStorage.getItem('stillhour-sound');
  return raw === null ? null : raw === 'on';
}

function remember(on: boolean): void {
  localStorage.setItem('stillhour-sound', on ? 'on' : 'off');
}

async function ensureContext(): Promise<SoundEngine | null> {
  if (engine) return engine;
  if (loadFailed || !loaded) return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  const context = new Ctor();
  const master = context.createGain();
  master.gain.value = 0;
  master.connect(context.destination);
  const ambientGain = context.createGain();
  ambientGain.gain.value = 0.5;
  ambientGain.connect(master);
  engine = { context, master, ambientGain, buffers: new Map(), ambientSource: null, filmGain: null };
  return engine;
}

// Fetch and decode every audio file; the gate reports progress per file.
export async function loadAudio(onFile: (failed: boolean) => void): Promise<void> {
  let failures = 0;
  const results = await Promise.all(
    AUDIO_FILES.map(async (url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('not ok');
        const data = await res.arrayBuffer();
        return { url, data };
      } catch {
        return null;
      }
    }),
  );
  for (const r of results) {
    onFile(r === null);
    if (r === null) failures += 1;
  }
  loadFailed = failures === results.length;
  if (loadFailed) {
    loaded = false;
    return;
  }
  loaded = true;
  const ctx = await ensureContext();
  if (!ctx) return;
  for (const r of results) {
    if (!r) continue;
    try {
      const buf = await ctx.context.decodeAudioData(r.data);
      ctx.buffers.set(r.url, buf);
    } catch {
      // one unreadable file only loses its own sound
    }
  }
  if (wanted) {
    startAmbient();
    fadeTo(1);
  }
}

function startAmbient(): void {
  const ctx = engine;
  if (!ctx || ctx.ambientSource || !ctx.buffers.has('/media/audio/ambient.mp3')) return;
  const src = ctx.context.createBufferSource();
  src.buffer = ctx.buffers.get('/media/audio/ambient.mp3')!;
  src.loop = true;
  src.connect(ctx.ambientGain);
  src.start();
  ctx.ambientSource = src;
}

function fadeTo(target: number): void {
  const ctx = engine;
  if (!ctx) return;
  const now = ctx.context.currentTime;
  const gain = ctx.master.gain;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(gain.value, now);
  gain.linearRampToValueAtTime(target, now + 0.4);
}

// Turn all sound on or off with a short fade, and remember the choice.
export async function setSound(on: boolean): Promise<void> {
  wanted = on;
  remember(on);
  const switchEl = document.getElementById('sound-switch');
  if (switchEl) switchEl.setAttribute('aria-checked', String(on));
  const ctx = await ensureContext();
  if (!ctx) return;
  if (ctx.context.state === 'suspended') await ctx.context.resume();
  if (on) startAmbient();
  fadeTo(on ? 1 : 0);
}

export function soundChime(which: 'add' | 'breath' | 'save'): void {
  const ctx = engine;
  if (!ctx || !wanted) return;
  const url = `/media/audio/chime-${which}.mp3`;
  const buf = ctx.buffers.get(url);
  if (!buf) return;
  const src = ctx.context.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.master);
  src.start();
}

// Route the film's own sound through the master volume and duck the bed.
export function attachFilm(video: HTMLVideoElement): void {
  const ctx = engine;
  if (!ctx || ctx.filmGain) return;
  try {
    const source = ctx.context.createMediaElementSource(video);
    const gain = ctx.context.createGain();
    gain.gain.value = 1;
    source.connect(gain);
    gain.connect(ctx.master);
    ctx.filmGain = gain;
  } catch {
    // some browsers refuse the media element source; the video keeps its own volume
  }
}

export function duckAmbient(ducked: boolean): void {
  const ctx = engine;
  if (!ctx) return;
  const now = ctx.context.currentTime;
  const gain = ctx.ambientGain.gain;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(gain.value, now);
  gain.linearRampToValueAtTime(ducked ? 0.17 : 0.5, now + 0.4);
}

export function wireSoundSwitch(): void {
  const switchEl = qs<HTMLButtonElement>('#sound-switch');
  switchEl.addEventListener('click', () => {
    const on = switchEl.getAttribute('aria-checked') !== 'true';
    void setSound(on);
  });
  switchEl.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter' && document.activeElement === switchEl) {
      e.preventDefault();
      const on = switchEl.getAttribute('aria-checked') !== 'true';
      void setSound(on);
    }
  });
}
