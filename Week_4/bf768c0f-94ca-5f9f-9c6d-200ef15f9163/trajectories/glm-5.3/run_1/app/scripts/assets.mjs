// Generates the vendored media: twelve avatars, the house avatar, six sounds,
// and a manifest carrying each file's licence and the hash of its bytes.
// Everything is original work generated here; nothing is downloaded.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MEDIA = path.join(ROOT, 'dist', 'media');
const AV = path.join(MEDIA, 'avatars');
const SND = path.join(MEDIA, 'sounds');
for (const d of [MEDIA, AV, SND]) fs.mkdirSync(d, { recursive: true });

// ------------------------------------------------------------------ avatars
// Twelve original geometric portraits on a 256-unit grid.
const PALETTES = [
  ['#4a6b3a', '#d8e8c8'], ['#7a4a2a', '#f0d8c0'], ['#2a5a6a', '#c8e0e8'],
  ['#6a3a5a', '#e8d0e0'], ['#8a6a2a', '#f0e8c8'], ['#3a5a8a', '#d0d8f0'],
  ['#8a3a3a', '#f0d0d0'], ['#3a6a4a', '#d0e8d8'], ['#6a5a2a', '#ece8c8'],
  ['#4a3a6a', '#d8d0e8'], ['#2a6a5a', '#c8e8e0'], ['#7a2a4a', '#f0d0e0'],
];
function avatarSvg(i) {
  const [bg, fg] = PALETTES[i % PALETTES.length];
  const hue = (i * 30) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img">
  <rect width="256" height="256" rx="56" fill="${bg}"/>
  <circle cx="128" cy="104" r="46" fill="${fg}" opacity="0.95"/>
  <path d="M40 256 a88 88 0 0 1 176 0 z" fill="${fg}" opacity="0.8"/>
  <circle cx="112" cy="98" r="6" fill="${bg}"/>
  <circle cx="144" cy="98" r="6" fill="${bg}"/>
  <path d="M116 122 q12 10 24 0" stroke="${bg}" stroke-width="5" fill="none" stroke-linecap="round"/>
  <g transform="rotate(${hue / 4} 128 128)" opacity="0.18">
    <circle cx="128" cy="128" r="120" fill="none" stroke="${fg}" stroke-width="4"/>
    <circle cx="128" cy="128" r="96" fill="none" stroke="${fg}" stroke-width="3"/>
    <circle cx="128" cy="128" r="72" fill="none" stroke="${fg}" stroke-width="2"/>
  </g>
</svg>`;
}
for (let i = 1; i <= 12; i++) {
  fs.writeFileSync(path.join(AV, `avatar_${String(i).padStart(2, '0')}.svg`), avatarSvg(i - 1));
}
// the house's own mark
fs.writeFileSync(path.join(AV, 'house.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img">
  <rect width="256" height="256" rx="56" fill="#2a2622"/>
  <path d="M60 176 L60 96 L128 48 L196 96 L196 176 Z" fill="#8a7a5a"/>
  <path d="M104 176 L104 128 L152 128 L152 176 Z" fill="#2a2622"/>
  <circle cx="128" cy="112" r="10" fill="#2a2622"/>
  <path d="M40 200 h176" stroke="#8a7a5a" stroke-width="8" stroke-linecap="round"/>
</svg>`);

// ------------------------------------------------------------------ sounds
// Six tiny original PCM sounds: move, capture, promotion, victory, defeat, draw.
function wav(samples, rate = 22050) {
  const n = samples.length;
  const data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + n * 2, 4);
  data.write('WAVE', 8);
  data.write('fmt ', 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);      // PCM
  data.writeUInt16LE(1, 22);      // mono
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return data;
}
const RATE = 22050;
function tone(freqs, { dur = 0.3, decay = 8, attack = 0.004, shape = 'sine', gain = 0.5 } = {}) {
  const n = Math.floor(dur * RATE);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    let v = 0;
    for (const f of freqs) {
      const phase = 2 * Math.PI * f * t;
      if (shape === 'sine') v += Math.sin(phase);
      else if (shape === 'triangle') v += Math.asin(Math.sin(phase)) * (2 / Math.PI);
      else if (shape === 'square') v += Math.sign(Math.sin(phase)) * 0.3;
    }
    v /= freqs.length;
    const env = Math.min(1, t / attack) * Math.exp(-decay * t);
    out[i] = v * env * gain;
  }
  return out;
}
function concat(...parts) {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float64Array(n);
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}
const SOUNDS = {
  move: () => tone([190, 385], { dur: 0.12, decay: 26, gain: 0.6 }),
  capture: () => concat(tone([140], { dur: 0.09, decay: 20, gain: 0.7, shape: 'triangle' }), tone([95], { dur: 0.14, decay: 16, gain: 0.6 })),
  promotion: () => concat(
    tone([523], { dur: 0.1, decay: 12, gain: 0.35 }),
    tone([659], { dur: 0.1, decay: 12, gain: 0.35 }),
    tone([784], { dur: 0.16, decay: 10, gain: 0.4 })),
  victory: () => concat(
    tone([523, 659, 784], { dur: 0.22, decay: 6, gain: 0.4 }),
    tone([659, 784, 1047], { dur: 0.4, decay: 5, gain: 0.42 })),
  defeat: () => concat(
    tone([392, 311], { dur: 0.25, decay: 7, gain: 0.4, shape: 'triangle' }),
    tone([311, 233], { dur: 0.45, decay: 6, gain: 0.4, shape: 'triangle' })),
  draw: () => concat(
    tone([440], { dur: 0.22, decay: 8, gain: 0.35 }),
    tone([440], { dur: 0.3, decay: 8, gain: 0.35 })),
};
for (const [name, gen] of Object.entries(SOUNDS)) {
  fs.writeFileSync(path.join(SND, `${name}.wav`), wav(gen()));
}

// ------------------------------------------------------------------ manifest
const LICENCE = 'Original work created for the Gambit Hall Club deployment; dedicated to the public domain (CC0).';
const files = [];
function walk(dir, rel = '') {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    const r = rel ? `${rel}/${f.name}` : f.name;
    if (f.isDirectory()) walk(full, r);
    else files.push(r);
  }
}
walk(MEDIA);
const manifest = {
  generator: 'Gambit Hall vendored media manifest',
  licence: LICENCE,
  fonts: 'No font files are shipped: headings use the Georgia serif stack and body text the system sans stack.',
  files: files.sort().map(f => ({
    path: `/media/${f}`,
    licence: LICENCE,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(MEDIA, f))).digest('hex'),
    bytes: fs.statSync(path.join(MEDIA, f)).size,
  })),
};
fs.writeFileSync(path.join(MEDIA, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`media: ${files.length} files written to dist/media`);
