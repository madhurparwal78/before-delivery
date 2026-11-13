import { Deps, Tx, BookingRow, inWriteTx, getStations, getBookingRow, getCurrentDocuments } from '../store.js';
import { ApiError, messages } from '../api/errors.js';
import { ruleCopy } from '../api/copy.js';
import { cutoffFor, bookingMinutes, CLEANUP_MINUTES, durationText } from '../domain/rules.js';
import { overlapExists, tenantDocumentsCover } from './occupancy.js';
import { writeMovement, choosePack, packAvailable, bookingMinutesOf } from './packs.js';
import { queueEmail } from '../mail/queue.js';
import { newId } from '../domain/crypto.js';

export interface ClaimInput {
  stationId: string; start: number; end: number; shelfId: string | null;
}

// Postgres refuses an overlapping occupancy with 23P01; that is a lost window.
function isExclusionViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23P01';
}

export interface TenantInfo { business_name: string; contact_name: string; email: string }

export function stationsText(names: string[]): string {
  return names.join(' and ');
}

async function tenantInfo(tx: Tx, tenantId: string): Promise<TenantInfo> {
  const r = await tx.query<TenantInfo>(
    `SELECT t.business_name, t.contact_name, u.email FROM tenants t JOIN users u ON u.id=t.user_id WHERE t.id=$1`,
    [tenantId],
  );
  return r.rows[0];
}

async function lockPack(tx: Tx, packId: string): Promise<void> {
  await tx.query('SELECT id FROM packs WHERE id=$1 FOR UPDATE', [packId]);
}

export async function lockBooking(tx: Tx, bookingId: string): Promise<void> {
  await tx.query('SELECT id FROM bookings WHERE id=$1 FOR UPDATE', [bookingId]);
}

async function readOccupancyWindow(tx: Tx, start: number, bufferEnd: number): Promise<BookingRow[]> {
  const r = await tx.query<BookingRow>(
    `SELECT * FROM bookings WHERE live=1 AND start < $2 AND buffer_end > $1 ORDER BY start`,
    [start - 86_400_000, bufferEnd + 86_400_000],
  );
  return r.rows;
}

// The claim limit: counted once per claim that reaches this step, in its own
// committed transaction so the count survives any later refusal.
export async function countClaim(deps: Deps, tenantId: string): Promise<void> {
  const client = await deps.db.connect();
  let released = false;
  const finish = () => { if (!released) { released = true; client.release(); } };
  try {
    await client.query('BEGIN');
    const nowRow = await client.query<{ now: string }>('SELECT now()::text AS now');
    const now = new Date(nowRow.rows[0].now + 'Z').getTime();
    const counted = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM counted_claims WHERE tenant_id=$1 AND at > $2`,
      [tenantId, now - 60_000],
    );
    if (counted.rows[0].n >= 10) {
      const oldest = await client.query<{ at: number }>(
        `SELECT at FROM counted_claims WHERE tenant_id=$1 AND at > $2 ORDER BY at LIMIT 1`,
        [tenantId, now - 60_000],
      );
      await client.query('ROLLBACK');
      finish();
      const wait = Math.max(1, Math.ceil((oldest.rows[0].at + 60_000 - now) / 1000));
      throw new ApiError(429, 'rate_limited', messages.rateLimited, undefined, Math.min(60, wait));
    }
    await client.query(`INSERT INTO counted_claims (tenant_id, at) VALUES ($1,$2)`, [tenantId, now]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    finish();
    throw e;
  }
  finish();
}

export async function createClaim(deps: Deps, tenantId: string, input: ClaimInput): Promise<BookingRow> {
  return inWriteTx(deps, async (tx, now) => {
    const stations = await getStations(tx);
    const stationMap = new Map(stations.map((s) => [s.id, s.name]));

    const tenantR = await tx.query<{ status: string }>(`SELECT status FROM tenants WHERE id=$1`, [tenantId]);
    if (tenantR.rows[0].status !== 'approved') {
      throw new ApiError(409, 'tenant_not_approved', 'tenant_not_approved');
    }
    const docs = await getCurrentDocuments(tx, tenantId);
    const dateKey = deps.clock.dateKey(input.start);
    if (!tenantDocumentsCover(docs.insurance?.expires_on ?? null, docs.foodHandler?.expires_on ?? null, dateKey)) {
      throw new ApiError(409, 'documents_not_valid', ruleCopy.documentsNotValid(deps.clock.longDateFromKey(dateKey)));
    }
    const stationCount = input.shelfId === null ? 1 : 2;
    const minutes = bookingMinutes(input.start, input.end, stationCount);
    const pack = await choosePack(tx, tenantId, minutes, now);
    if (pack === null) {
      throw new ApiError(409, 'insufficient_hours', ruleCopy.insufficientHours(durationText(minutes)));
    }

    await lockPack(tx, pack.id);
    const occupancy = await readOccupancyWindow(tx, input.start, input.end + CLEANUP_MINUTES * 60_000);
    const stationIds = [input.stationId, ...(input.shelfId ? [input.shelfId] : [])];
    if (overlapExists(occupancy, stationIds, input.start, input.end + CLEANUP_MINUTES * 60_000, null)) {
      throw new ApiError(409, 'slot_taken', ruleCopy.slotTaken(stationsText(stationIds.map((id) => stationMap.get(id) ?? id))));
    }

    const id = newId();
    const holdExpiresAt = now + deps.config.holdSeconds * 1000;
    const bufferEnd = input.end + CLEANUP_MINUTES * 60_000;
    await tx.query(
      `INSERT INTO bookings (id, tenant_id, station_id, shelf_id, start, "end", buffer_end, status, hold_expires_at, pack_id, created_at, live)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'held',$8,$9,$10,1)`,
      [id, tenantId, input.stationId, input.shelfId, input.start, input.end, bufferEnd, holdExpiresAt, pack.id, now],
    );
    try {
      await tx.query(
        `INSERT INTO booking_occupancies (booking_id, station_id, start, buffer_end)
         VALUES ($1,$2,$3,$4)`,
        [id, input.stationId, input.start, bufferEnd],
      );
      if (input.shelfId !== null) {
        await tx.query(
          `INSERT INTO booking_occupancies (booking_id, station_id, start, buffer_end)
           VALUES ($1,$2,$3,$4)`,
          [id, input.shelfId, input.start, bufferEnd],
        );
      }
    } catch (e) {
      if (isExclusionViolation(e)) {
        throw new ApiError(409, 'slot_taken', ruleCopy.slotTaken(stationsText(stationIds.map((sid) => stationMap.get(sid) ?? sid))));
      }
      throw e;
    }
    return (await getBookingRow(tx, id))!;
  });
}

// Confirming re-runs only the hold expiry and document checks, then debits the
// reserved minutes as one paired ledger movement.
export async function confirmBooking(deps: Deps, tenantId: string, bookingId: string): Promise<BookingRow> {
  return inWriteTx(deps, async (tx, now) => {
    await lockBooking(tx, bookingId);
    const b = await getBookingRow(tx, bookingId);
    if (!b || b.tenant_id !== tenantId) throw new ApiError(404, 'not_found', "That record isn't available.");

    if (b.status === 'confirmed') return b;
    if (b.status === 'cancelled' && b.cancel_reason === 'hold_expired') {
      throw new ApiError(409, 'hold_expired', ruleCopy.holdExpired(b.station_id));
    }
    if (b.status !== 'held') {
      throw new ApiError(409, 'invalid_transition', ruleCopy.invalidTransitionConfirm);
    }
    if (b.hold_expires_at !== null && now >= b.hold_expires_at) {
      await tx.query(`UPDATE bookings SET status='cancelled', cancel_reason='hold_expired', live=0 WHERE id=$1`, [bookingId]);
      await tx.query(`DELETE FROM booking_occupancies WHERE booking_id=$1`, [bookingId]);
      throw new ApiError(409, 'hold_expired', ruleCopy.holdExpired(b.station_id));
    }
    const docs = await getCurrentDocuments(tx, tenantId);
    const dateKey = deps.clock.dateKey(b.start);
    if (!tenantDocumentsCover(docs.insurance?.expires_on ?? null, docs.foodHandler?.expires_on ?? null, dateKey)) {
      throw new ApiError(409, 'documents_not_valid', ruleCopy.documentsNotValid(deps.clock.longDateFromKey(dateKey)));
    }

    const minutes = bookingMinutesOf(b);
    const packId = b.pack_id!;
    await lockPack(tx, packId);
    await writeMovement(tx, 'booking_debit', packId, -minutes, b.id, now);
    await tx.query(`UPDATE bookings SET status='confirmed', debited_minutes=$2 WHERE id=$1`, [bookingId, minutes]);

    const info = await tenantInfo(tx, tenantId);
    const balanceAfter = await packAvailable(tx, packId, now);
    await queueEmail(tx, b.tenant_id, {
      kind: 'booking_confirmed',
      recordId: b.id,
      toName: info.contact_name,
      toEmail: info.email,
      subject: `Booking confirmed: ${b.station_id} on ${deps.clock.longDateFromKey(dateKey)}`,
      body: confirmationBody(deps.clock, b.station_id, b.shelf_id, b.start, b.end, minutes, balanceAfter, b.id),
    }, now);
    return (await getBookingRow(tx, bookingId))!;
  });
}

// The seven body lines of a booking email, shared by confirmation and move.
export function confirmationBody(
  clock: Deps['clock'], station: string, shelfId: string | null,
  start: number, end: number, debitedMinutes: number, balanceMinutes: number, bookingId: string,
): string {
  const zone = clock.zoneLabel();
  return [
    `Station: ${station}`,
    `Shelf: ${shelfId ?? 'none'}`,
    `Starts: ${clock.longDateFromKey(clock.dateKey(start))} ${clock.hhmm(start)} ${zone}`,
    `Ends: ${clock.longDateFromKey(clock.dateKey(end))} ${clock.hhmm(end)} ${zone}`,
    `Hours debited: ${durationText(debitedMinutes)}`,
    `Pack balance: ${durationText(balanceMinutes)}`,
    `Booking reference: ${bookingId}`,
  ].join('\n');
}

export async function moveBooking(deps: Deps, tenantId: string, bookingId: string, input: ClaimInput): Promise<BookingRow> {
  return inWriteTx(deps, async (tx, now) => {
    await lockBooking(tx, bookingId);
    const b = await getBookingRow(tx, bookingId);
    if (!b || b.tenant_id !== tenantId) throw new ApiError(404, 'not_found', "That record isn't available.");

    if (b.status !== 'confirmed') throw new ApiError(409, 'invalid_transition', ruleCopy.invalidTransitionMove);
    const cutoff = cutoffFor(deps.clock, b.start);
    if (now > cutoff) throw new ApiError(409, 'past_cutoff', ruleCopy.invalidTransitionMove);
    if (b.move_count === 1) throw new ApiError(409, 'move_limit_reached', ruleCopy.invalidTransitionMove);

    const tenantR = await tx.query<{ status: string }>(`SELECT status FROM tenants WHERE id=$1`, [tenantId]);
    if (tenantR.rows[0].status !== 'approved') throw new ApiError(409, 'tenant_not_approved', 'tenant_not_approved');
    const docs = await getCurrentDocuments(tx, tenantId);
    const dateKey = deps.clock.dateKey(input.start);
    if (!tenantDocumentsCover(docs.insurance?.expires_on ?? null, docs.foodHandler?.expires_on ?? null, dateKey)) {
      throw new ApiError(409, 'documents_not_valid', ruleCopy.documentsNotValid(deps.clock.longDateFromKey(dateKey)));
    }

    const stationCount = input.shelfId === null ? 1 : 2;
    const newMinutes = bookingMinutes(input.start, input.end, stationCount);
    const oldMinutes = bookingMinutesOf(b);
    const delta = newMinutes - oldMinutes;
    const packId = b.pack_id!;
    if (delta > 0) {
      const available = await packAvailable(tx, packId, now);
      if (available < delta) {
        throw new ApiError(409, 'insufficient_hours', ruleCopy.insufficientHours(durationText(delta)));
      }
    }

    await lockPack(tx, packId);
    const occupancy = await readOccupancyWindow(tx, input.start, input.end + CLEANUP_MINUTES * 60_000);
    const stationIds = [input.stationId, ...(input.shelfId ? [input.shelfId] : [])];
    if (overlapExists(occupancy, stationIds, input.start, input.end + CLEANUP_MINUTES * 60_000, bookingId)) {
      throw new ApiError(409, 'slot_taken', ruleCopy.slotTaken(stationsText(stationIds)));
    }

    if (delta !== 0) {
      await writeMovement(tx, 'move_adjustment', packId, -delta, bookingId, now);
    }
    const oldStart = b.start; const oldEnd = b.end; const oldStation = b.station_id; const oldShelf = b.shelf_id;
    const newBufferEnd = input.end + CLEANUP_MINUTES * 60_000;
    await tx.query(
      `UPDATE bookings SET station_id=$2, shelf_id=$3, start=$4, "end"=$5, buffer_end=$6, debited_minutes=$7, move_count=1 WHERE id=$1`,
      [bookingId, input.stationId, input.shelfId, input.start, input.end, newBufferEnd, newMinutes],
    );
    // The booking's own occupancy never conflicts with its move: the old rows
    // go first, inside the same transaction, so no rival can take the old slot
    // while the new one is being written.
    await tx.query(`DELETE FROM booking_occupancies WHERE booking_id=$1`, [bookingId]);
    try {
      await tx.query(
        `INSERT INTO booking_occupancies (booking_id, station_id, start, buffer_end)
         VALUES ($1,$2,$3,$4)`,
        [bookingId, input.stationId, input.start, newBufferEnd],
      );
      if (input.shelfId !== null) {
        await tx.query(
          `INSERT INTO booking_occupancies (booking_id, station_id, start, buffer_end)
           VALUES ($1,$2,$3,$4)`,
          [bookingId, input.shelfId, input.start, newBufferEnd],
        );
      }
    } catch (e) {
      if (isExclusionViolation(e)) {
        throw new ApiError(409, 'slot_taken', ruleCopy.slotTaken(stationsText(stationIds)));
      }
      throw e;
    }
    const info = await tenantInfo(tx, tenantId);
    const balanceAfter = await packAvailable(tx, packId, now);
    await queueEmail(tx, tenantId, {
      kind: 'booking_moved',
      recordId: bookingId,
      toName: info.contact_name,
      toEmail: info.email,
      subject: `Booking moved: ${input.stationId} on ${deps.clock.longDateFromKey(dateKey)}`,
      body: `${confirmationBody(deps.clock, input.stationId, input.shelfId, input.start, input.end, newMinutes, balanceAfter, bookingId)}\n`
        + `Was: ${deps.clock.longDateFromKey(deps.clock.dateKey(oldStart))} ${deps.clock.hhmm(oldStart)}–${deps.clock.hhmm(oldEnd)} `
        + (oldShelf === null ? oldStation : `${oldStation} and ${oldShelf}`),
    }, now);
    return (await getBookingRow(tx, bookingId))!;
  });
}

export async function cancelBooking(deps: Deps, tenantId: string, bookingId: string): Promise<BookingRow> {
  return inWriteTx(deps, async (tx, now) => {
    await lockBooking(tx, bookingId);
    const b = await getBookingRow(tx, bookingId);
    if (!b || b.tenant_id !== tenantId) throw new ApiError(404, 'not_found', "That record isn't available.");
    if (b.status !== 'held' && b.status !== 'confirmed') {
      throw new ApiError(409, 'invalid_transition', ruleCopy.invalidTransitionCancel);
    }
    if (b.status === 'held') {
      await tx.query(`UPDATE bookings SET status='cancelled', cancel_reason='tenant', live=0 WHERE id=$1`, [bookingId]);
      await tx.query(`DELETE FROM booking_occupancies WHERE booking_id=$1`, [bookingId]);
    } else {
      const cutoff = cutoffFor(deps.clock, b.start);
      const credit = now <= cutoff ? (b.debited_minutes ?? 0) : 0;
      if (credit > 0) {
        await lockPack(tx, b.pack_id!);
        await writeMovement(tx, 'cancellation_credit', b.pack_id!, credit, bookingId, now);
      }
      await tx.query(
        `UPDATE bookings SET status='cancelled', cancel_reason='tenant', live=0, refunded_minutes=$2 WHERE id=$1`,
        [bookingId, credit],
      );
      await tx.query(`DELETE FROM booking_occupancies WHERE booking_id=$1`, [bookingId]);
    }
    return (await getBookingRow(tx, bookingId))!;
  });
}
