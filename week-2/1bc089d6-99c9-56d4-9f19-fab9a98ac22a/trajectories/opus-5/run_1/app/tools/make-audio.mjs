// Builds Stillhour's own audio files as 16-bit PCM WAV. Run with `npm run media`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const outDir = fileURLToPath(new URL('../public/audio', import.meta.url));
mkdirSync(outDir, { recursive: true });

function writeWav(name, samples, rate) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  writeFileSync(`${outDir}/${name}`, Buffer.concat([header, data]));
  console.log(name, (header.length + data.length) / 1024, 'KiB');
}

// One ambient bed: a slow evening pad that loops seamlessly over 16 seconds.
function ambient() {
  const rate = 22050;
  const seconds = 16;
  const n = rate * seconds;
  const out = new Float32Array(n);
  // Partial frequencies of a low, open chord; LFO periods divide the loop exactly.
  const voices = [
    { freq: 55, gain: 0.3, lfoCycles: 1, lfoDepth: 0.35, phase: 0 },
    { freq: 82.5, gain: 0.2, lfoCycles: 2, lfoDepth: 0.4, phase: 0.3 },
    { freq: 110, gain: 0.16, lfoCycles: 1, lfoDepth: 0.5, phase: 0.6 },
    { freq: 164.81, gain: 0.08, lfoCycles: 3, lfoDepth: 0.6, phase: 0.1 },
    { freq: 220, gain: 0.05, lfoCycles: 2, lfoDepth: 0.7, phase: 0.8 },
    { freq: 329.63, gain: 0.025, lfoCycles: 1, lfoDepth: 0.8, phase: 0.45 },
  ];
  for (let i = 0; i < n; i += 1) {
    const t = i / rate;
    const loop = t / seconds;
    let value = 0;
    for (const v of voices) {
      const lfo = 1 - v.lfoDepth * 0.5 * (1 - Math.cos(2 * Math.PI * (v.lfoCycles * loop + v.phase)));
      value += v.gain * lfo * Math.sin(2 * Math.PI * v.freq * t + v.phase * Math.PI * 2);
    }
    // A breath of filtered air, built from loop-periodic harmonics so the seam is silent.
    let air = 0;
    for (let k = 1; k <= 24; k += 1) {
      air += Math.sin(2 * Math.PI * (k * 7) * loop * 8 + k * 1.37) / (k + 6);
    }
    out[i] = value * 0.55 + air * 0.012;
  }
  writeWav('ambient-night.wav', out, rate);
}

// Three soft chimes: ritual added, breathing phase change, hour saved.
function chime(name, partials, seconds, attack) {
  const rate = 44100;
  const n = Math.round(rate * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / rate;
    let value = 0;
    for (const p of partials) {
      const start = p.delay ?? 0;
      if (t < start) continue;
      const u = t - start;
      const decay = Math.exp(-u * p.decay);
      value += p.gain * decay * Math.sin(2 * Math.PI * p.freq * u + Math.sin(2 * Math.PI * p.freq * 2 * u) * 0.12);
    }
    const env = Math.min(1, t / attack) * Math.min(1, (seconds - t) / 0.12);
    out[i] = value * env * 0.5;
  }
  writeWav(name, out, rate);
}

ambient();
chime('chime-ritual.wav', [
  { freq: 659.25, gain: 0.6, decay: 2.6 },
  { freq: 988.87, gain: 0.22, decay: 3.6 },
  { freq: 1318.5, gain: 0.1, decay: 5 },
], 1.4, 0.006);
chime('chime-breath.wav', [
  { freq: 440, gain: 0.5, decay: 3.4 },
  { freq: 660, gain: 0.16, decay: 4.6 },
], 1.0, 0.01);
chime('chime-saved.wav', [
  { freq: 523.25, gain: 0.5, decay: 2.2 },
  { freq: 783.99, gain: 0.4, decay: 2.2, delay: 0.18 },
  { freq: 1046.5, gain: 0.18, decay: 3, delay: 0.36 },
], 1.8, 0.008);
