import { now, nowMs } from "../clock";
import { pool, q, one, tx } from "../db";
import { lockName } from "../lockname";
import { publish } from "../events";
import { addDays, today } from "../studiodays";
import type { StudioRow } from "../types";
import { sendMail } from "../services/mailer";
import { formatScreenDate } from "../studiodays";
import { insertCharge } from "./charges";
import type { PieceRow } from "../types";

// The reminder sweep: pickup reminders (once per piece) and storage-day charges
// (exactly once per piece and day, up to 10 days after the deadline, each charged at
// the fee in force at that day's first instant).

const STORAGE_CAP_DAYS = 10;

export async function storageFeeCentsFor(studioId: string, day: string): Promise<number> {
  const row = await one<{ cents: number }>(
    pool,
    "SELECT cents FROM storage_fee_history WHERE studio_id = $1 AND effective_from <= $2 ORDER BY effective_from DESC LIMIT 1",
    [studioId, day],
  );
  return Number(row?.cents ?? 0);
}

export async function sweepOnce(): Promise<void> {
  const studios = await q<StudioRow>(pool, "SELECT * FROM studios");
  for (const studio of studios) {
    try {
      await sweepStudio(studio);
    } catch {
      // Next sweep will catch up.
    }
  }
}

async function sweepStudio(studio: StudioRow): Promise<void> {
  const todayStr = today(studio.time_zone, nowMs());
  await sendDueReminders(studio, todayStr);
  await accrueStorageDays(studio, todayStr);
}

async function sendDueReminders(studio: StudioRow, todayStr: string): Promise<void> {
  const rows = await q<PieceRow & { email: string }>(
    pool,
    `SELECT p.*, pe.email FROM pieces p JOIN people pe ON pe.id = p.owner_id
      WHERE p.studio_id = $1 AND p.status = 'ready_for_pickup' AND p.pickup_deadline IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM sent_reminders r WHERE r.piece_id = p.id)`,
    [studio.id],
  );
  for (const piece of rows) {
    const dueFrom = addDays(piece.pickup_deadline as string, -3);
    if (dueFrom > todayStr) continue;
    const inserted = await tx(async (client) => {
      const res = await client.query("INSERT INTO sent_reminders (piece_id, sent_at) VALUES ($1, $2) ON CONFLICT (piece_id) DO NOTHING", [piece.id, now()]);
      return res.rowCount === 1;
    });
    if (!inserted) continue; // another instance sent it
    try {
      await sendMail(piece.email, `Pickup reminder: ${piece.title}`, `${studio.name}\n${piece.title}\nCollect by ${formatScreenDate(piece.pickup_deadline as string)}\n`);
    } catch {
      // The reminder row is already recorded; do not resend.
    }
    await publish(pool, "piece", piece.id, studio.id, { memberId: piece.owner_id });
  }
}

async function accrueStorageDays(studio: StudioRow, todayStr: string): Promise<void> {
  const rows = await q<PieceRow>(
    pool,
    `SELECT * FROM pieces WHERE studio_id = $1 AND status = 'ready_for_pickup' AND pickup_deadline IS NOT NULL AND pickup_deadline < $2`,
    [studio.id, todayStr],
  );
  for (const piece of rows) {
    const deadline = piece.pickup_deadline as string;
    const last = deadline < todayStr ? todayStr : deadline; // days up to and including today
    const capEnd = addDays(deadline, STORAGE_CAP_DAYS);
    const endDay = last > capEnd ? capEnd : last;
    for (let day = addDays(deadline, 1); day <= endDay; day = addDays(day, 1)) {
      const fee = await storageFeeCentsFor(studio.id, day);
      if (fee === 0) continue; // a day whose fee is 0 creates no charge
      const charge = await tx(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.storage(piece.id, day)]);
        return insertCharge(client, {
          studioId: studio.id,
          memberId: piece.owner_id,
          pieceId: piece.id,
          firing: "storage",
          storageDay: day,
          rateCents: fee,
          feeCents: fee,
          at: now(),
        });
      });
      if (charge) {
        await publish(pool, "charge", charge.id, studio.id, { memberId: piece.owner_id });
        await publish(pool, "piece", piece.id, studio.id, { memberId: piece.owner_id });
      }
    }
  }
}
