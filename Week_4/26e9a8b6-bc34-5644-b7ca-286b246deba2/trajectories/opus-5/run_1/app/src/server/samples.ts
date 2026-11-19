import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = dirname(fileURLToPath(import.meta.url));

export const publicDir = join(serverDir, '..', 'public');
export const samplesDir = join(publicDir, 'samples');

const cache = new Map<string, Buffer>();

export const SAMPLE_NAMES = ['coffee-grinder', 'bike-hub', 'game-controller'] as const;

export type SampleName = (typeof SAMPLE_NAMES)[number];

export function isSampleName(name: string): name is SampleName {
  return (SAMPLE_NAMES as readonly string[]).includes(name);
}

export function sampleBytes(name: SampleName): Buffer {
  const cached = cache.get(name);
  if (cached) return cached;
  const bytes = readFileSync(join(samplesDir, `${name}.glb`));
  cache.set(name, bytes);
  return bytes;
}
