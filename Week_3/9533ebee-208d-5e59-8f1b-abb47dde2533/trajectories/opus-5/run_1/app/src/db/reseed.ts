/**
 * Development helper: drops the schema and applies the seed again, so a test
 * run starts from the documented opening state.
 */

import { closePool, query } from './pool.ts';
import { applySchemaAndSeed } from './migrate.ts';

await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await applySchemaAndSeed();
await closePool();
process.stdout.write('quillmoor: reseeded\n');
