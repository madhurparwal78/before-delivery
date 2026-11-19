/**
 * The work the server does on its own: moving a closed client through to
 * erased, sending due reminders, delivering pending mail and catching up on
 * whatever a provider was down for.
 */
import type { App } from '../app.ts';
import { completeSeedArtifacts } from '../db/seed.ts';
import { deliverPending, sendDueReminders } from './letters.ts';
import { rebuildIndex } from './indexing.ts';
import { entryId, SearchUnavailable } from '../services/search.ts';
import { storageKeys, StorageUnavailable } from '../services/storage.ts';
import type { Row } from '../present.ts';

/** Checked at least every two seconds. */
const SWEEP_MS = 2000;
const CATCH_UP_MS = 5000;

/**
 * `closing` to `erasing` the moment the wait has passed, then to `erased` only
 * once MinIO and Meilisearch have both confirmed each deletion.
 */
async function sweepClients(app: App): Promise<void> {
  await app.db.query(
    `UPDATE clients SET state = 'erasing' WHERE state = 'closing' AND closes_at <= now()`,
  );

  const erasing = await app.db.query<Row>(
    `SELECT id, desk_id FROM clients WHERE state = 'erasing' ORDER BY id`,
  );
  for (const client of erasing) {
    const pieces = await app.db.query<Row>(`SELECT id FROM pieces WHERE client_id = $1`, [
      client.id,
    ]);

    // Every file of every piece, asked for even when the client has none.
    try {
      for (const piece of pieces) {
        const photographs = await app.db.query<Row>(
          `SELECT sha256 FROM photographs WHERE piece_id = $1`,
          [piece.id],
        );
        for (const photograph of photographs) {
          await app.storage.remove(
            storageKeys.photograph(String(client.desk_id), String(piece.id), String(photograph.sha256)),
          );
        }
        const collections = await app.db.query<Row>(
          `SELECT id FROM collections WHERE piece_id = $1`,
          [piece.id],
        );
        for (const collection of collections) {
          await app.storage.remove(
            storageKeys.label(String(client.desk_id), String(piece.id), String(collection.id)),
          );
        }
        const dossiers = await app.db.query<Row>(`SELECT id FROM dossiers WHERE piece_id = $1`, [
          piece.id,
        ]);
        for (const dossier of dossiers) {
          await app.storage.remove(
            storageKeys.dossier(String(client.desk_id), String(piece.id), String(dossier.id)),
          );
        }
      }
      await app.storage.ensureBucket();
    } catch (error) {
      if (error instanceof StorageUnavailable) continue;
      throw error;
    }

    try {
      await app.search.remove([
        entryId(String(client.desk_id), 'client', String(client.id)),
        ...pieces.map((piece) => entryId(String(client.desk_id), 'piece', String(piece.id))),
      ]);
    } catch (error) {
      if (error instanceof SearchUnavailable) continue;
      throw error;
    }

    await app.db.transaction(async (tx) => {
      await tx.query(`DELETE FROM pieces WHERE client_id = $1`, [client.id]);
      await tx.query(
        `UPDATE clients SET state = 'erased', name = '', town = '', language = '', email = NULL,
           closes_at = NULL WHERE id = $1`,
        [client.id],
      );
    });
  }
}

function every(ms: number, work: () => Promise<void>): NodeJS.Timeout {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    work()
      .catch((error: unknown) => {
        process.stderr.write(`background work failed: ${String(error)}\n`);
      })
      .finally(() => {
        running = false;
      });
  }, ms);
  timer.unref();
  return timer;
}

export function startBackgroundWork(app: App): void {
  every(SWEEP_MS, async () => {
    await sweepClients(app);
    await sendDueReminders(app);
  });
  every(SWEEP_MS, () => deliverPending(app));
  every(CATCH_UP_MS, async () => {
    await completeSeedArtifacts(app);
  });

  // The index is built from the database, and kept trying for while it is down.
  let indexed = false;
  every(CATCH_UP_MS, async () => {
    if (indexed) return;
    indexed = await rebuildIndex(app);
  });
}
