import { now } from './clock.ts';
import { config } from './config.ts';
import { first, pool, rows, transaction } from './db/pool.ts';
import { ensureSeedPhotos } from './db/seed.ts';
import { accruedStorageDays, reminderDueAt } from './domain/storage-days.ts';
import { publish } from './events.ts';
import { queueEmail, refundCharge, settleCharge } from './money.ts';
import { settleOpenAttempt, type PurchaseRow } from './packs.ts';
import { newId } from './security.ts';
import { SETTLER_BUDGET_MS } from './services/killbill.ts';
import { sendMail } from './services/smtp.ts';
import { formatStudioDate } from '../shared/labels.ts';

const CLAIM_SECONDS = 90;

function claimWindow(): { until: Date; at: Date } {
  const at = now();
  return { at, until: new Date(at.getTime() + CLAIM_SECONDS * 1_000) };
}

interface PendingChargeRow {
  readonly id: string;
  readonly member_id: string;
}

async function settlePendingCharges(): Promise<void> {
  const pending = await rows<PendingChargeRow>(
    pool,
    `select id, member_id from charges where status = 'pending' order by member_id, ordinal`,
  );
  const blocked = new Set<string>();
  for (const charge of pending) {
    if (blocked.has(charge.member_id)) continue;
    const outcome = await settleCharge(charge.id, SETTLER_BUDGET_MS).catch((error: unknown) => {
      process.stderr.write(`charge ${charge.id} failed to settle: ${String(error)}\n`);
      return 'pending' as const;
    });
    // A charge still pending, or held by another instance, keeps the member's later charges
    // waiting, so each member's charges settle in the order they were created.
    if (outcome !== 'settled') blocked.add(charge.member_id);
  }
}

async function finishRefunds(): Promise<void> {
  const window = claimWindow();
  const claimed = await rows<{ id: string }>(
    pool,
    `update charges set claimed_until = $1
      where id in (select id from charges where status = 'refund_pending'
                     and (claimed_until is null or claimed_until < $2)
                   for update skip locked)
        and status = 'refund_pending' and (claimed_until is null or claimed_until < $2)
      returning id`,
    [window.until, window.at],
  );
  for (const charge of claimed) {
    await refundCharge(charge.id, SETTLER_BUDGET_MS, false).catch(() => null);
    await pool.query('update charges set claimed_until = null where id = $1', [charge.id]);
  }
}

async function finishPackAttempts(): Promise<void> {
  const window = claimWindow();
  const claimed = await rows<PurchaseRow>(
    pool,
    `update pack_purchases set claimed_until = $1
      where id in (select id from pack_purchases where status in ('pending','held')
                     and (claimed_until is null or claimed_until < $2)
                   for update skip locked)
        and status in ('pending','held') and (claimed_until is null or claimed_until < $2)
      returning id, studio_id, member_id, pack_id, amount_cents, idem_key, status, studio_day,
                created_at, last_call_at`,
    [window.until, window.at],
  );
  for (const purchase of claimed) {
    await settleOpenAttempt(purchase).catch(() => undefined);
    await pool.query('update pack_purchases set claimed_until = null where id = $1', [purchase.id]);
  }
}

interface PickupPieceRow {
  readonly id: string;
  readonly studio_id: string;
  readonly member_id: string;
  readonly title: string;
  readonly status: string;
  readonly pickup_deadline: string;
  readonly left_ready_at: Date | null;
  readonly member_email: string;
  readonly time_zone: string;
  readonly studio_name: string;
}

async function feeInForce(studioId: string, instant: Date): Promise<number> {
  const found = await first<{ fee_cents: number }>(
    pool,
    `select fee_cents from storage_fee_history
      where studio_id = $1 and from_instant < $2
      order by from_instant desc limit 1`,
    [studioId, instant],
  );
  return found?.fee_cents ?? 0;
}

async function sweepPickups(): Promise<void> {
  const pieces = await rows<PickupPieceRow>(
    pool,
    `select p.id, p.studio_id, p.member_id, p.title, p.status, p.pickup_deadline, p.left_ready_at,
            m.email as member_email, s.time_zone, s.name as studio_name
       from pieces p
       join people m on m.id = p.member_id
       join studios s on s.id = p.studio_id
      where p.pickup_deadline is not null
        and (select count(*) from storage_days d where d.piece_id = p.id) < 10`,
  );
  for (const piece of pieces) {
    if (piece.status === 'ready_for_pickup') {
      const dueAt = reminderDueAt(piece.pickup_deadline, piece.time_zone);
      if (now().getTime() >= dueAt.getTime()) {
        await transaction(async (client) => {
          const inserted = await rows<{ piece_id: string }>(
            client,
            `insert into reminders_sent (piece_id, sent_at) values ($1,$2)
             on conflict (piece_id) do nothing returning piece_id`,
            [piece.id, now()],
          );
          if (inserted.length === 0) return;
          await queueEmail(
            client,
            piece.studio_id,
            piece.member_email,
            `Pickup reminder: ${piece.title}`,
            [
              `${piece.studio_name}`,
              `${piece.title} is waiting on the pickup shelf.`,
              `Collect by ${formatStudioDate(piece.pickup_deadline)}`,
            ].join('\n'),
          );
        });
      }
    }

    const days = accruedStorageDays(
      piece.pickup_deadline,
      piece.time_zone,
      now(),
      piece.left_ready_at,
    );
    for (const day of days) {
      const fee = await feeInForce(piece.studio_id, day.startInstant);
      await transaction(async (client) => {
        const inserted = await rows<{ storage_day: string }>(
          client,
          `insert into storage_days (piece_id, storage_day, created_at) values ($1,$2,$3)
           on conflict (piece_id, storage_day) do nothing returning storage_day`,
          [piece.id, day.date, now()],
        );
        if (inserted.length === 0) return;
        if (fee <= 0) return;
        const chargeId = newId();
        await client.query(
          `insert into charges (id, studio_id, piece_id, member_id, firing, storage_day,
                                rate_cents, fee_cents, status, created_at)
           values ($1,$2,$3,$4,'storage',$5,$6,$7,'pending',$8)`,
          [chargeId, piece.studio_id, piece.id, piece.member_id, day.date, fee, fee, now()],
        );
        await client.query(
          'update storage_days set charge_id = $3 where piece_id = $1 and storage_day = $2',
          [piece.id, day.date, chargeId],
        );
        await publish(client, {
          kind: 'charge',
          id: chargeId,
          studio_id: piece.studio_id,
          member_id: piece.member_id,
        });
        await publish(client, {
          kind: 'piece',
          id: piece.id,
          studio_id: piece.studio_id,
          member_id: piece.member_id,
        });
      });
    }
  }
}

interface OutboxRow {
  readonly id: string;
  readonly to_email: string;
  readonly subject: string;
  readonly body: string;
}

async function flushOutbox(): Promise<void> {
  const window = claimWindow();
  const claimed = await rows<OutboxRow>(
    pool,
    `update emails set claimed_at = $1
      where id in (select id from emails where sent_at is null
                     and (claimed_at is null or claimed_at < $2)
                   order by created_at limit 20
                   for update skip locked)
        and sent_at is null and (claimed_at is null or claimed_at < $2)
      returning id, to_email, subject, body`,
    [window.until, window.at],
  );
  for (const mail of claimed) {
    try {
      await sendMail(mail.to_email, mail.subject, mail.body);
      await pool.query('update emails set sent_at = $2 where id = $1', [mail.id, now()]);
    } catch {
      await pool.query('update emails set claimed_at = null where id = $1', [mail.id]);
    }
  }
}

function loop(name: string, intervalMs: number, run: () => Promise<void>): void {
  let busy = false;
  const tick = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      await run();
    } catch (error) {
      process.stderr.write(`${name} failed: ${String(error)}\n`);
    } finally {
      busy = false;
    }
  };
  setInterval(() => void tick(), intervalMs).unref();
  void tick();
}

export function startWorkers(): void {
  loop('settler', config.billingRetrySeconds * 1_000, async () => {
    await settlePendingCharges();
    await finishRefunds();
    await finishPackAttempts();
  });
  loop('sweep', config.reminderSweepSeconds * 1_000, sweepPickups);
  loop('outbox', 1_000, flushOutbox);
  let photosWritten = false;
  loop('seed-photos', 20_000, async () => {
    if (photosWritten) return;
    photosWritten = await ensureSeedPhotos();
  });
}
