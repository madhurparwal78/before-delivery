import { starterPens } from "../shared/starters";
import { newId } from "./auth";
import { one, pool, rows, transaction } from "./db";
import { StorageUnavailable } from "./errors";
import { deliverOutbox } from "./forks";
import { renderLifetimeHours } from "./renders";
import { mirrorShelf } from "./shelf";
import { ensureBucket, storageReachable } from "./storage";
import { appendVersion } from "./versions";

const starterOwner = { handle: "coldframe", email: "starters@coldframe.test" };

export async function seedStarterPens(): Promise<void> {
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(4173002)");
    await client.query(
      "INSERT INTO users (id, handle, email, email_key, password_hash, verified) VALUES ($1, $2, $3, $3, NULL, true) ON CONFLICT DO NOTHING",
      [newId(), starterOwner.handle, starterOwner.email],
    );
    const owner = await one<{ id: string }>(client, "SELECT id FROM users WHERE handle = $1", [starterOwner.handle]);
    for (const starter of starterPens) {
      const exists = await one(client, "SELECT 1 FROM pens WHERE owner_id = $1 AND title = $2", [owner?.id, starter.title]);
      if (!exists) {
        await client.query("INSERT INTO pens (id, owner_id, title, visibility, tags) VALUES ($1, $2, $3, 'public', $4)", [
          newId(),
          owner?.id,
          starter.title,
          starter.tags,
        ]);
      }
    }
  });
}

/** Writes version 1 of every starter pen that does not have it yet. */
async function storeStarterVersions(): Promise<void> {
  const pending = await rows<{ id: string; title: string }>(
    pool,
    "SELECT p.id, p.title FROM pens p JOIN users u ON u.id = p.owner_id WHERE u.handle = $1 AND p.head = 0",
    [starterOwner.handle],
  );
  for (const pen of pending) {
    const starter = starterPens.find((candidate) => candidate.title === pen.title);
    if (!starter) continue;
    await transaction(async (client) => {
      const locked = await one<{ head: number }>(client, "SELECT head FROM pens WHERE id = $1 FOR UPDATE", [pen.id]);
      if (locked?.head !== 0) return;
      await appendVersion(client, { id: pen.id, head: 0 }, { files: starter.files, libraries: starter.libraries }, null);
    });
  }
}

let storageWasUp = false;

async function storageMaintenance(): Promise<void> {
  if (!(await storageReachable())) {
    storageWasUp = false;
    return;
  }
  try {
    if (!storageWasUp) {
      await ensureBucket();
      await mirrorShelf();
    }
    await storeStarterVersions();
    storageWasUp = true;
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    storageWasUp = false;
  }
}

async function maintenance(): Promise<void> {
  await storageMaintenance();
  await deliverOutbox();
  await pool.query("DELETE FROM renders WHERE created_at < now() - make_interval(hours => $1)", [renderLifetimeHours]);
}

export function startMaintenance(): void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    maintenance()
      .catch((error: unknown) => console.error("maintenance failed", error))
      .finally(() => {
        running = false;
      });
  };
  tick();
  setInterval(tick, 5000);
}
