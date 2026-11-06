import { runMigrations, seedIfEmpty } from './schema.js';
import { ensureBucket } from './storage.js';
export async function runMigrationsSafe() {
    await runMigrations();
    await seedIfEmpty();
    await ensureBucket();
}
