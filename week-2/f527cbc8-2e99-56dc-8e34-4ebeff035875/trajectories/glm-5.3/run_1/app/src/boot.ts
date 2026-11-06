import { runMigrations, seedIfEmpty } from './schema.js';
import { ensureBucket } from './storage.js';

/** Boot: migrate and seed once even under several instances (DP-86). */
export async function runMigrationsSafe(): Promise<void> {
  await runMigrations();
  await seedIfEmpty();
  await ensureBucket();
}
