// Start-up: schema, seed rows and seed photos under one advisory lock, then the background loops.

import { exec, one, tx, waitForDatabase } from "./db.js";
import { SCHEMA } from "./schema.js";
import { seedPhotos, seedRows } from "./seed.js";
import { deliverPending } from "./mail.js";
import { sweepOptions } from "./domain/options.js";
import { sweepLicenceReminders } from "./domain/licences.js";

let ready = false;

export function isReady(): boolean {
  return ready;
}

async function photosSeeded(): Promise<boolean> {
  return tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('rungboard:seed-photos', 0))");
    if (await one(client, "SELECT 1 FROM counters WHERE name = 'seed_photos'")) return true;
    if (!(await seedPhotos(client))) return false;
    await exec(client, "INSERT INTO counters (name, value) VALUES ('seed_photos', 1)");
    return true;
  });
}

/** Runs `step` now and then every `ms`, never overlapping itself. */
function every(ms: number, name: string, step: () => Promise<unknown>): void {
  const run = async () => {
    try {
      await step();
    } catch (error) {
      console.error(`${name} failed:`, (error as Error).message);
    }
    setTimeout(run, ms);
  };
  void run();
}

export async function start(): Promise<void> {
  await waitForDatabase();
  await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('rungboard:schema', 0))");
    await client.query(SCHEMA);
    if (await seedRows(client, Date.now())) console.log("seeded the database");
  });
  if (!(await photosSeeded())) {
    const retry = async () => {
      if (!(await photosSeeded().catch(() => false))) setTimeout(retry, 30_000);
    };
    setTimeout(retry, 30_000);
  }
  ready = true;
  every(2000, "sweep", async () => {
    await sweepOptions(Date.now());
    await sweepLicenceReminders(Date.now());
  });
  every(1000, "mail delivery", deliverPending);
}
