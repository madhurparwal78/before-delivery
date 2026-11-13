import { REGULATOR_EMAIL } from './config.ts';
import { isSchemaReady, pool } from './db.ts';
import { MailUnavailableError, sendMail } from './mail.ts';
import { deleteObject, putObject, StoreUnavailableError } from './store.ts';
import { digestOf } from './service/packs.ts';
import { storeAndConfirm } from './service/cards.ts';
import { applyDueLapses } from './service/lapse.ts';

/**
 * Stalled work finishes by itself. Every few seconds this retries strokes
 * waiting for the store, packs stalled on the store or mail, and queued
 * notices, so each one completes soon after its service answers again.
 */

const TICK_MS = 3_000;
let running = false;

export function startWorker(): void {
  setInterval(() => void tick(), TICK_MS).unref();
}

export function kickWorker(): void {
  setTimeout(() => void tick(), 50).unref();
}

async function tick(): Promise<void> {
  if (running || !isSchemaReady()) return;
  running = true;
  try {
    await applyDueLapses();
    await confirmWaitingStrokes();
    await advancePacks();
    await sendQueuedNotices();
  } catch (cause) {
    process.stderr.write(`worker: ${cause instanceof Error ? cause.message : String(cause)}\n`);
  } finally {
    running = false;
  }
}

async function confirmWaitingStrokes(): Promise<void> {
  const waiting = await pool.query<{ id: string }>(
    "select id from gate_cards where state = 'waiting-for-store' order by id",
  );
  for (const card of waiting.rows) {
    if (!(await storeAndConfirm(card.id))) return;
  }
}

interface PackWork {
  number: string;
  state: 'building' | 'stored' | 'mailed' | 'withdrawn';
  object_key: string;
  from_date: string;
  to_date: string;
  sha256: string | null;
  document: Buffer;
  object_deleted: boolean;
}

async function advancePacks(): Promise<void> {
  const packs = await pool.query<PackWork>(
    `select number, state, object_key, from_date, to_date, sha256, document, object_deleted from packs
      where state in ('building','stored') or (state = 'withdrawn' and object_deleted = false)
      order by number`,
  );

  for (const pack of packs.rows) {
    if (pack.state === 'withdrawn') {
      try {
        await deleteObject(pack.object_key);
        await pool.query('update packs set object_deleted = true where number = $1', [pack.number]);
      } catch (cause) {
        if (!(cause instanceof StoreUnavailableError)) throw cause;
      }
      continue;
    }

    if (pack.state === 'building') {
      try {
        await putObject(pack.object_key, pack.document, 'text/plain; charset=utf-8');
      } catch (cause) {
        if (!(cause instanceof StoreUnavailableError)) throw cause;
        await pool.query("update packs set stalled_on = 'store' where number = $1 and state = 'building'", [
          pack.number,
        ]);
        continue;
      }
      await pool.query(
        "update packs set state = 'stored', sha256 = $2, stalled_on = null where number = $1 and state = 'building'",
        [pack.number, digestOf(pack.document)],
      );
      pack.state = 'stored';
      pack.sha256 = digestOf(pack.document);
    }

    try {
      await sendMail({
        to: REGULATOR_EMAIL,
        subject: `Ditchbook delivery pack ${pack.number}`,
        body: `Pack ${pack.number} for ${pack.from_date} to ${pack.to_date}. SHA-256 ${pack.sha256 as string}`,
        attachment: {
          filename: `${pack.number}.txt`,
          contentType: 'text/plain',
          bytes: pack.document,
        },
      });
    } catch (cause) {
      if (!(cause instanceof MailUnavailableError)) throw cause;
      await pool.query("update packs set stalled_on = 'mail' where number = $1 and state = 'stored'", [pack.number]);
      continue;
    }
    await pool.query(
      "update packs set state = 'mailed', mailed_at = now(), stalled_on = null where number = $1 and state = 'stored'",
      [pack.number],
    );
  }
}

async function sendQueuedNotices(): Promise<void> {
  const queued = await pool.query<{ id: string; to_email: string; subject: string; body: string }>(
    "select id::text as id, to_email, subject, body from notices where state = 'queued' order by id limit 50",
  );
  for (const notice of queued.rows) {
    try {
      await sendMail({ to: notice.to_email, subject: notice.subject, body: notice.body });
    } catch (cause) {
      if (!(cause instanceof MailUnavailableError)) throw cause;
      return;
    }
    await pool.query("update notices set state = 'sent', sent_at = now() where id = $1", [notice.id]);
  }
}
