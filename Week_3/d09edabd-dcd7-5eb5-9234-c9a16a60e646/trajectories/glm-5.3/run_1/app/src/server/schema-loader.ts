import { readFile } from 'node:fs/promises';

export const SCHEMA = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
