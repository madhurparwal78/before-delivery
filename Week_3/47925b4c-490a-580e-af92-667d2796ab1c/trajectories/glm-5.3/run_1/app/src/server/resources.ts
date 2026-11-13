// Reads schema.sql and seed.ts as text at build time; the seed is data, not a module.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

let cachedSchema: string | null = null;

export function schemaSql(): string {
  if (cachedSchema === null) {
    cachedSchema = readFileSync(join(here, 'schema.sql'), 'utf8');
  }
  return cachedSchema;
}

const SEED_FILE = 'seed.json';

export function seedData(): unknown {
  const raw = readFileSync(join(here, SEED_FILE), 'utf8');
  return JSON.parse(raw);
}
