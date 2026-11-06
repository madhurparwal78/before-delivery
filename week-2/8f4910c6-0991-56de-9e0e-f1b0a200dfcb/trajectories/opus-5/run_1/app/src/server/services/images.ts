import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import canvasModule from '@napi-rs/canvas';

const { createCanvas } = canvasModule;

const WORKER_PATH = fileURLToPath(new URL('./image-worker.js', import.meta.url));
const WORKER_TIMEOUT_MS = 15_000;

export type NormalisedPhoto = { jpeg: Buffer; width: number; height: number };

type WorkerMeta = { ok: boolean; width?: number; height?: number };

/**
 * Decodes a photo, applies its camera orientation, scales the longer side to at
 * most 2,400 pixels and re-encodes as JPEG, so no metadata survives. Decoding
 * happens in a separate process; an undecodable file answers null.
 */
export async function normalisePhoto(bytes: Buffer): Promise<NormalisedPhoto | null> {
  return new Promise<NormalisedPhoto | null>((resolve) => {
    const child = spawn(process.execPath, [WORKER_PATH], { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (value: NormalisedPhoto | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(null);
    }, WORKER_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', () => finish(null));
    child.on('close', () => {
      const output = Buffer.concat(chunks);
      const newline = output.indexOf(0x0a);
      if (newline === -1) {
        finish(null);
        return;
      }
      let meta: WorkerMeta;
      try {
        meta = JSON.parse(output.subarray(0, newline).toString('utf8')) as WorkerMeta;
      } catch {
        finish(null);
        return;
      }
      if (!meta.ok || meta.width === undefined || meta.height === undefined) {
        finish(null);
        return;
      }
      finish({ jpeg: output.subarray(newline + 1), width: meta.width, height: meta.height });
    });
    child.stdin.on('error', () => finish(null));
    child.stdin.end(bytes);
  });
}

const PORTRAIT_GROUNDS = [
  ['#e8ded0', '#b9a58c'],
  ['#dfe3dc', '#8d9a8b'],
  ['#efe0dc', '#b4867d'],
  ['#e2e0ea', '#8b88a3'],
  ['#ece6d4', '#a9986a'],
];

/** The seeded portfolio illustrations; no outside asset is downloaded. */
export function generatePortrait(seedText: string, label: string, index: number): NormalisedPhoto {
  const width = 1_200;
  const height = 1_600;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  let seed = 0;
  for (const char of `${seedText}:${index}`) seed = (seed * 31 + char.charCodeAt(0)) % 100_000;
  const ground = PORTRAIT_GROUNDS[seed % PORTRAIT_GROUNDS.length];

  const backdrop = ctx.createLinearGradient(0, 0, width, height);
  backdrop.addColorStop(0, ground[0]);
  backdrop.addColorStop(1, ground[1]);
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = 'rgba(28, 24, 22, 0.16)';
  ctx.beginPath();
  ctx.ellipse(width / 2, height * 0.74, width * 0.34, height * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(28, 24, 22, 0.28)';
  ctx.beginPath();
  ctx.ellipse(width / 2, height * (0.34 + (seed % 5) * 0.01), width * 0.17, height * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(28, 24, 22, 0.35)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(width * 0.12, height * (0.2 + (seed % 7) * 0.02));
  ctx.lineTo(width * 0.88, height * (0.26 + (seed % 3) * 0.03));
  ctx.stroke();

  ctx.fillStyle = 'rgba(28, 24, 22, 0.72)';
  ctx.font = '64px sans-serif';
  ctx.fillText(label, 72, height - 96);

  return { jpeg: canvas.encodeSync('jpeg', 86), width, height };
}
