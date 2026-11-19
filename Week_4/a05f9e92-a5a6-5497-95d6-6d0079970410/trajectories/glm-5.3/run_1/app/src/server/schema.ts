import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function schemaSql(): string {
  return readFileSync(join(here, 'schema.sql'), 'utf8');
}
