// Builds Stillhour's own film, ritual clips, posters and caption track.
// Frames are painted in JavaScript and piped to ffmpeg as raw video. Run with `npm run media`.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';
import { createFrame, paintFilm, paintRitual } from './paint.mjs';

const outDir = fileURLToPath(new URL('../public/media', import.meta.url));
const tmpDir = fileURLToPath(new URL('../.media-tmp', import.meta.url));
mkdirSync(outDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

function run(args, feed) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: [feed ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.slice(-2000)}`))));
    if (feed) feed(child.stdin).then(() => child.stdin.end(), reject);
  });
}

const write = (stream, buf) => new Promise((resolve) => {
  if (stream.write(buf)) resolve();
  else stream.once('drain', resolve);
});

async function encode({ w, h, fps, frames, paint, outputs, audio }) {
  const input = ['-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`, '-r', String(fps), '-i', 'pipe:0'];
  if (audio) input.push('-i', audio);
  const args = [...input];
  for (const out of outputs) args.push(...out);
  await run(args, async (stdin) => {
    const frame = createFrame(w, h);
    for (let i = 0; i < frames; i += 1) {
      paint(frame, i);
      await write(stdin, Buffer.from(frame.data));
    }
  });
}

// A calm pad for the film, built the same way as the app's ambient bed.
function filmAudio(path, seconds) {
  const rate = 32000;
  const n = rate * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(n * 2, 40);
  const chords = [
    [110, 164.81, 220],
    [98, 146.83, 196],
    [87.31, 130.81, 174.61],
    [73.42, 110, 146.83],
  ];
  for (let i = 0; i < n; i += 1) {
    const t = i / rate;
    const chord = chords[Math.min(chords.length - 1, Math.floor(t / 10))];
    const blend = (t % 10) / 10;
    const next = chords[Math.min(chords.length - 1, Math.floor(t / 10) + 1)];
    let v = 0;
    for (let k = 0; k < 3; k += 1) {
      const f = chord[k] + (next[k] - chord[k]) * Math.min(1, Math.max(0, (blend - 0.8) * 5));
      const swell = 0.6 + 0.4 * Math.sin(2 * Math.PI * (t / 8) + k);
      v += (0.22 / (k + 1)) * swell * Math.sin(2 * Math.PI * f * t);
    }
    const env = Math.min(1, t / 2) * Math.min(1, (seconds - t) / 3);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * env * 0.6)) * 32767), 44 + i * 2);
  }
  writeFileSync(path, buf);
}

const webm = (file, extra = []) => ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', 'yuv420p', ...extra, file];
const mp4 = (file, extra = []) => ['-c:v', 'libx264', '-crf', '26', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', ...extra, file];

async function buildFilm() {
  const w = 960;
  const h = 540;
  const fps = 24;
  const seconds = 40;
  const audio = `${tmpDir}/film.wav`;
  filmAudio(audio, seconds);
  console.log('film: painting', fps * seconds, 'frames');
  await encode({
    w, h, fps, frames: fps * seconds, audio,
    paint: (frame, i) => paintFilm(frame, i / fps),
    outputs: [
      webm(`${outDir}/one-still-hour.webm`, ['-c:a', 'libopus', '-b:a', '96k', '-t', String(seconds)]),
      mp4(`${outDir}/one-still-hour.mp4`, ['-c:a', 'aac', '-b:a', '128k', '-t', String(seconds)]),
    ],
  });
  const poster = createFrame(w, h);
  paintFilm(poster, 7);
  await encode({
    w, h, fps: 1, frames: 1,
    paint: (frame) => frame.data.set(poster.data),
    outputs: [['-frames:v', '1', '-q:v', '4', `${outDir}/one-still-hour-poster.jpg`]],
  });
}

const RITUALS = ['dim-lamps', 'warm-shower', 'paper-not-pixels', 'tomorrow-list', 'slow-stretch', 'breathe'];

async function buildClips() {
  const w = 480;
  const h = 300;
  const fps = 20;
  const seconds = 5;
  for (const id of RITUALS) {
    console.log('clip:', id);
    await encode({
      w, h, fps, frames: fps * seconds,
      paint: (frame, i) => paintRitual(id, frame, i / (fps * seconds)),
      outputs: [
        webm(`${outDir}/ritual-${id}.webm`, ['-an']),
        mp4(`${outDir}/ritual-${id}.mp4`, ['-an']),
      ],
    });
    const still = createFrame(w, h);
    paintRitual(id, still, 0.25);
    await encode({
      w, h, fps: 1, frames: 1,
      paint: (frame) => frame.data.set(still.data),
      outputs: [['-frames:v', '1', '-q:v', '4', `${outDir}/ritual-${id}-still.jpg`]],
    });
  }
}

const CAPTIONS = `WEBVTT

1
00:00:00.000 --> 00:00:05.000
The sun goes down behind the hills.

2
00:00:05.000 --> 00:00:10.500
Nothing here needs you tonight.

3
00:00:11.000 --> 00:00:16.000
Across the city, the windows start to close.

4
00:00:16.500 --> 00:00:21.000
One room after another lets go of the day.

5
00:00:21.500 --> 00:00:26.000
The water goes still enough to hold the moon.

6
00:00:26.500 --> 00:00:31.000
A paper boat drifts to the middle and stops.

7
00:00:31.500 --> 00:00:36.000
A lantern burns low, then lower.

8
00:00:36.500 --> 00:00:40.000
Goodnight.
`;

writeFileSync(`${outDir}/one-still-hour.vtt`, CAPTIONS);
await buildFilm();
await buildClips();
rmSync(tmpDir, { recursive: true, force: true });
console.log('media built');
