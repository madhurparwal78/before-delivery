/**
 * Six sounds, synthesised in the browser: a move, a capture, a promotion, a
 * victory, a defeat and a draw.  No sound file is fetched, and nothing plays
 * before the member has interacted with the page.
 */

import { soundOn } from './app.js';

let context = null;
let interacted = false;

function unlock() {
  interacted = true;
}

['pointerdown', 'keydown', 'touchstart'].forEach((event) => {
  window.addEventListener(event, unlock, { once: true, passive: true });
});

function audio() {
  if (!interacted) return null;
  if (!context) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }
  if (context.state === 'suspended') context.resume();
  return context;
}

function tone(ctx, { frequency, start, duration, type = 'sine', gain = 0.16, slideTo = null }) {
  const oscillator = ctx.createOscillator();
  const envelope = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, ctx.currentTime + start);
  if (slideTo) {
    oscillator.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + start + duration);
  }
  envelope.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  envelope.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.012);
  envelope.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  oscillator.connect(envelope).connect(ctx.destination);
  oscillator.start(ctx.currentTime + start);
  oscillator.stop(ctx.currentTime + start + duration + 0.02);
}

function noise(ctx, { start = 0, duration = 0.18, gain = 0.2 } = {}) {
  const frames = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
  }
  const source = ctx.createBufferSource();
  const envelope = ctx.createGain();
  envelope.gain.value = gain;
  source.buffer = buffer;
  source.connect(envelope).connect(ctx.destination);
  source.start(ctx.currentTime + start);
}

const VOICES = {
  move: (ctx) => tone(ctx, { frequency: 320, duration: 0.1, type: 'triangle', gain: 0.14, slideTo: 210 }),
  capture: (ctx) => {
    noise(ctx, { duration: 0.16, gain: 0.18 });
    tone(ctx, { frequency: 180, duration: 0.14, type: 'square', gain: 0.1, slideTo: 90 });
  },
  promotion: (ctx) => {
    [392, 523, 659, 784].forEach((frequency, index) => {
      tone(ctx, { frequency, start: index * 0.07, duration: 0.16, type: 'triangle', gain: 0.12 });
    });
  },
  victory: (ctx) => {
    [523, 659, 784, 1046].forEach((frequency, index) => {
      tone(ctx, { frequency, start: index * 0.1, duration: 0.3, type: 'sine', gain: 0.14 });
    });
  },
  defeat: (ctx) => {
    [392, 330, 262, 196].forEach((frequency, index) => {
      tone(ctx, { frequency, start: index * 0.12, duration: 0.34, type: 'sine', gain: 0.13 });
    });
  },
  draw: (ctx) => {
    tone(ctx, { frequency: 440, duration: 0.42, type: 'sine', gain: 0.12 });
    tone(ctx, { frequency: 587, start: 0.1, duration: 0.42, type: 'sine', gain: 0.1 });
  },
};

/** Play one of the six sounds, if the member has sound on. */
export function playSound(kind) {
  if (!soundOn()) return false;
  const voice = VOICES[kind];
  if (!voice) return false;
  const ctx = audio();
  if (!ctx) return false;
  try {
    voice(ctx);
    return true;
  } catch {
    return false;
  }
}

export const SOUND_KINDS = Object.keys(VOICES);
