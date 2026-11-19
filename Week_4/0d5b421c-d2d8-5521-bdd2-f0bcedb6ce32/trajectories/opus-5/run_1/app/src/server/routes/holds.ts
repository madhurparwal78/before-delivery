import { Router } from 'express';
import type { ConfirmResponse, HoldResponse } from '../../shared/types';
import { serverNow } from '../clock';
import { config } from '../config';
import { pool, query, withTransaction } from '../db';
import { eligibleUnitsAt } from '../domain/availability';
import { commitBooking } from '../domain/bookingFlow';
import { reserveReference } from '../domain/bookings';
import { claimKeysFor, enqueueFreedTables } from '../domain/claims';
import { fitsBySeatRange, loadLayout, requireUnit } from '../domain/floor';
import { eveningWindows, unitFreeForWindow } from '../domain/occupancy';
import { depositCents, isBookable, newToken, slotStartsAt, turnWindow } from '../domain/rules';
import { errors } from '../errors';
import { asyncHandler, sendJson } from '../http';
import { readIdempotencyKey, withIdempotency } from '../idempotency';
import { publishLiveEvent } from '../services/events';
import { claimSlots, releaseSlots, valkeyAnswering } from '../services/valkey';
import { addSeconds, isoUtc } from '../time';
import { asRecord, Validator } from '../validate';

export const holdsRouter = Router();

export interface HoldRow {
  hold_id: string;
  date: string;
  time: string;
  starts_at: Date;
  window_start: Date;
  window_end: Date;
  party_size: number;
  unit_id: string;
  pair_id: string | null;
  deposit_cents: number;
  status: string;
  expires_at: Date;
  reserved_reference: string | null;
}

const HOLD_COLUMNS = `
  hold_id, to_char(date, 'YYYY-MM-DD') as date, time, starts_at, window_start, window_end,
  party_size, unit_id, pair_id, deposit_cents, status, expires_at, reserved_reference
`;

async function findHold(holdId: string): Promise<HoldRow | null> {
  const result = await query<HoldRow>(
    pool,
    `select ${HOLD_COLUMNS} from holds where hold_id = $1`,
    [holdId],
  );
  return result.rows[0] ?? null;
}

function reportedStatus(hold: HoldRow, now: Date): HoldResponse['status'] {
  if (hold.status === 'live' && new Date(hold.expires_at).getTime() <= now.getTime()) {
    return 'expired';
  }
  return hold.status as HoldResponse['status'];
}

holdsRouter.post(
  '/holds',
  asyncHandler(async (req, res) => {
    const now = serverNow();
    const layout = await loadLayout();
    const body = asRecord(req.body);
    const validator = new Validator();
    const { date, time, partySize, unit } = validator.finish({
      date: validator.date('date', body.date, now),
      time: validator.slotTime('time', body.time),
      partySize: validator.partyFromBody('party_size', body.party_size),
      unit: validator.unit('table_id', body.table_id, layout),
    });

    if (!isBookable(date, time, now)) throw errors.slotNotBookable();
    if (!fitsBySeatRange(unit, partySize)) throw errors.tableNotForParty();

    const startsAt = slotStartsAt(date, time);
    const window = turnWindow(partySize, startsAt);
    const windows = await eveningWindows(pool, date, now);
    if (!unitFreeForWindow(windows, unit, window)) throw errors.tableTaken();
    const eligible = eligibleUnitsAt(layout, windows, partySize, startsAt);
    if (!eligible.some((candidate) => candidate.unitId === unit.unitId)) {
      throw errors.tableNotForParty();
    }
    if (!(await valkeyAnswering())) throw errors.holdsPaused();

    const holdId = newToken();
    const keys = claimKeysFor(unit, window);
    let claimed: boolean;
    try {
      claimed = await claimSlots(keys, holdId, config.holdSeconds * 1000);
    } catch {
      throw errors.holdsPaused();
    }
    if (!claimed) throw errors.tableTaken();

    const grantedAt = serverNow();
    const expiresAt = addSeconds(grantedAt, config.holdSeconds);
    const deposit = depositCents(partySize, unit.roomId);
    try {
      await withTransaction(async (client) => {
        const current = await eveningWindows(client, date, grantedAt);
        if (!unitFreeForWindow(current, unit, window)) throw errors.tableTaken();
        await query(
          client,
          `insert into holds(hold_id, date, time, starts_at, window_start, window_end, party_size,
             unit_id, pair_id, deposit_cents, status, expires_at, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'live', $11, now())`,
          [
            holdId,
            date,
            time,
            startsAt,
            window.start,
            window.end,
            partySize,
            unit.unitId,
            unit.isPair ? unit.unitId : null,
            deposit,
            expiresAt,
          ],
        );
        for (const tableId of unit.tableIds) {
          await query(client, 'insert into hold_tables(hold_id, table_id) values ($1, $2)', [
            holdId,
            tableId,
          ]);
        }
      });
    } catch (error) {
      await releaseSlots(keys, holdId).catch(() => undefined);
      throw error;
    }

    await publishLiveEvent({
      type: 'hold.created',
      date,
      time,
      tableIds: unit.tableIds,
      partySize,
      expiresAt,
    });

    const body201: HoldResponse = {
      hold_id: holdId,
      table_id: unit.unitId,
      date,
      time,
      party_size: partySize,
      status: 'live',
      expires_at: isoUtc(expiresAt),
      server_now: isoUtc(grantedAt),
      deposit_cents: deposit,
    };
    sendJson(res, 201, body201);
  }),
);

holdsRouter.get(
  '/holds/:holdId',
  asyncHandler(async (req, res) => {
    const now = serverNow();
    const hold = await findHold(req.params.holdId ?? '');
    if (!hold) throw errors.notFound();
    const body: HoldResponse = {
      hold_id: hold.hold_id,
      table_id: hold.unit_id,
      date: hold.date,
      time: hold.time,
      party_size: hold.party_size,
      status: reportedStatus(hold, now),
      expires_at: isoUtc(new Date(hold.expires_at)),
      server_now: isoUtc(now),
      deposit_cents: hold.deposit_cents,
    };
    sendJson(res, 200, body);
  }),
);

holdsRouter.delete(
  '/holds/:holdId',
  asyncHandler(async (req, res) => {
    const now = serverNow();
    const hold = await findHold(req.params.holdId ?? '');
    if (!hold) throw errors.notFound();
    const layout = await loadLayout();
    const unit = requireUnit(layout, hold.unit_id);
    const status = reportedStatus(hold, now);
    if (status === 'expired') throw errors.holdExpired();
    if (status === 'confirmed') throw errors.holdClosed();
    if (status === 'released') {
      res.status(204).end();
      return;
    }
    if (!(await valkeyAnswering())) throw errors.holdsPaused();

    try {
      await releaseSlots(
        claimKeysFor(unit, {
          start: new Date(hold.window_start),
          end: new Date(hold.window_end),
        }),
        hold.hold_id,
      );
    } catch {
      throw errors.holdsPaused();
    }

    const released = await withTransaction(async (client) => {
      const updated = await query<{ hold_id: string }>(
        client,
        "update holds set status = 'released' where hold_id = $1 and status = 'live' returning hold_id",
        [hold.hold_id],
      );
      if (updated.rowCount === 0) return false;
      await enqueueFreedTables(client, hold.date, unit.tableIds);
      return true;
    });
    if (released) {
      await publishLiveEvent({
        type: 'hold.released',
        date: hold.date,
        time: hold.time,
        tableIds: unit.tableIds,
        partySize: hold.party_size,
      });
    }
    res.status(204).end();
  }),
);

holdsRouter.post(
  '/holds/:holdId/confirm',
  asyncHandler(async (req, res) => {
    const key = readIdempotencyKey(req.headers['idempotency-key'] as string | undefined);
    const holdId = req.params.holdId ?? '';
    const outcome = await withIdempotency(
      key,
      'POST',
      `/api/holds/${holdId}/confirm`,
      req.body,
      async () => {
        const now = serverNow();
        const layout = await loadLayout();
        const hold = await findHold(holdId);
        if (!hold) throw errors.notFound();
        const unit = requireUnit(layout, hold.unit_id);
        const status = reportedStatus(hold, now);
        if (status === 'expired') throw errors.holdExpired();

        const body = asRecord(req.body);
        const validator = new Validator();
        const name = validator.name('name', body.name);
        const email = validator.email('email', body.email);
        const phone = validator.optionalPhone('phone', body.phone);
        validator.acceptedDeposit('accept_deposit', body.accept_deposit, hold.deposit_cents);
        const checked = validator.finish({ name, email });

        if (status !== 'live') throw errors.holdClosed();
        if (!(await valkeyAnswering())) throw errors.holdsPaused();

        const reference =
          hold.reserved_reference ??
          (await withTransaction(async (client) => {
            const candidate = await reserveReference(client);
            const updated = await query<{ reserved_reference: string }>(
              client,
              `update holds set reserved_reference = coalesce(reserved_reference, $2)
               where hold_id = $1 returning reserved_reference`,
              [hold.hold_id, candidate],
            );
            return updated.rows[0]?.reserved_reference ?? candidate;
          }));

        const result = await commitBooking({
          source: 'online',
          date: hold.date,
          time: hold.time,
          startsAt: new Date(hold.starts_at),
          windowStart: new Date(hold.window_start),
          windowEnd: new Date(hold.window_end),
          partySize: hold.party_size,
          unit,
          depositCents: hold.deposit_cents,
          reference,
          name: checked.name,
          email: checked.email,
          phone,
          owner: {
            kind: 'hold',
            id: hold.hold_id,
            claimKeys: claimKeysFor(unit, {
              start: new Date(hold.window_start),
              end: new Date(hold.window_end),
            }),
          },
        });
        const response: ConfirmResponse = {
          booking: result.booking,
          manage_url: result.manageUrl,
        };
        return { status: 201, body: response };
      },
    );
    sendJson(res, outcome.status, outcome.body);
  }),
);
