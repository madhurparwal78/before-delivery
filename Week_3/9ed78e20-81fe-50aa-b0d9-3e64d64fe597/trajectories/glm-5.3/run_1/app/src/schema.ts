import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SCHEMA_SQL = readFileSync(join(__dirname, 'db/schema.sql'), 'utf8');
export const SEED_SQL = readFileSync(join(__dirname, 'db/seed.sql'), 'utf8');
export const SEARCH_REFRESH_SQL = readFileSync(join(__dirname, 'db/search-refresh.sql'), 'utf8');
