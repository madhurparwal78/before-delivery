// Everything the server does with no screen open: mail, reminders and erasure. Renders poll here too.

import { PRIVATE_COPY, fill } from '../shared/copy';
import { pool, rows, transaction, type Row } from './db';
import { deliverPendingMail, queueMail } from './mail';
import { pollRenders } from './routes/renders';
import { languageOf, roundedNow } from './records';
import { reviewMailBody } from './routes/pages';
import { deleteObject, ensureBucket, listKeys, StoreFailure } from './s3';

const ERASE_RETRY_MS = 5000;
const eraseTried = new Map<string, number>();

async function sendReminders(now: number): Promise<void> {
  const due = await rows(
    pool,
    `SELECT g.*, j.title, j.due_date, j.client_id, p.email, p.language FROM private_pages g
     JOIN jobs j ON j.id = g.job_id JOIN producers p ON p.id = g.producer_id JOIN clients c ON c.id = j.client_id
     WHERE g.kind = 'review' AND NOT g.reminder_sent AND g.reminder_at <= $1 AND g.ended_at IS NULL AND g.ends_at > $1 AND c.state = 'active'
       AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.page_id = g.id)`,
    [new Date(now)],
  );
  for (const page of due) {
    await transaction(async (tx) => {
      await tx.query('UPDATE private_pages SET reminder_sent = true WHERE id = $1', [page.id]);
      const language = languageOf(page);
      await queueMail(tx, {
        clientId: page.client_id,
        to: page.email,
        subject: fill(PRIVATE_COPY[language].mailReminderSubject, { title: page.title }),
        body: reviewMailBody(page.title, `/r/${page.token}`, page.due_date, language),
      });
    });
  }
}

/** MinIO is always asked first, and `erased` is written only after it confirmed each deletion. */
async function eraseClient(client: Row, now: number): Promise<void> {
  const prefix = `clients/${client.id}/`;
  for (const key of await listKeys(prefix)) await deleteObject(key);
  if ((await listKeys(prefix)).length) throw new StoreFailure('objects remain');
  await transaction(async (tx) => {
    await tx.query('DELETE FROM calls WHERE producer_id IN (SELECT id FROM producers WHERE client_id = $1)', [client.id]);
    await tx.query('DELETE FROM pending_mail WHERE client_id = $1', [client.id]);
    await tx.query('DELETE FROM jobs WHERE client_id = $1', [client.id]);
    await tx.query('DELETE FROM producers WHERE client_id = $1', [client.id]);
    await tx.query(`UPDATE clients SET state = 'erased', erased_at = $1, closes_at = NULL WHERE id = $2`, [new Date(roundedNow(now)), client.id]);
  });
  eraseTried.delete(client.id);
}

async function eraseDueClients(now: number): Promise<void> {
  const due = await rows(pool, `SELECT * FROM clients WHERE state IN ('closing', 'erasing') AND closes_at <= $1`, [new Date(now)]);
  for (const client of due) {
    if ((eraseTried.get(client.id) ?? 0) > now - ERASE_RETRY_MS) continue;
    eraseTried.set(client.id, now);
    if (client.state === 'closing') await pool.query(`UPDATE clients SET state = 'erasing' WHERE id = $1 AND state = 'closing'`, [client.id]);
    try {
      await eraseClient(client, now);
    } catch (error) {
      if (!(error instanceof StoreFailure)) throw error;
    }
  }
}

let bucketReady = false;

async function tryBucket(): Promise<void> {
  if (bucketReady) return;
  try {
    await ensureBucket();
    bucketReady = true;
  } catch {
    // MinIO is not up yet; the next second asks again.
  }
}

function everySecond(work: () => Promise<void>): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    work()
      .catch((error: unknown) => console.error(error))
      .finally(() => {
        running = false;
      });
  }, 1000);
}

export function startWorkers(): void {
  everySecond(tryBucket);
  everySecond(deliverPendingMail);
  everySecond(() => sendReminders(Date.now()));
  everySecond(() => eraseDueClients(Date.now()));
  everySecond(pollRenders);
}
