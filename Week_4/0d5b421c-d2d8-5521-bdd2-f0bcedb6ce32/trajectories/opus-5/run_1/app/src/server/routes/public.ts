import { Router } from 'express';
import type { FloorResponse, RulesResponse, StatusResponse } from '../../shared/types';
import { serverNow, setServerNow } from '../clock';
import { config } from '../config';
import { pool } from '../db';
import { availabilityFor, planFor, tonightFor } from '../domain/availability';
import { loadLayout } from '../domain/floor';
import {
  BOOKING_HORIZON_DAYS,
  BOOKING_LEAD_MINUTES,
  DEPOSIT_CENTS_PER_COVER,
  DEPOSIT_MIN_PARTY,
  DEPOSIT_ROOMS,
  HOST_SESSION_HOURS,
  NO_SHOW_AFTER_MINUTES,
  REFUND_CUTOFF_HOURS,
  RESET_MINUTES,
  SLOT_TIMES,
  TURN_MINUTES,
} from '../domain/rules';
import { errors } from '../errors';
import { asyncHandler, sendJson } from '../http';
import { killBillReachable } from '../services/killbill';
import { valkeyReachable } from '../services/valkey';
import { isoUtc, RESTAURANT_TIMEZONE } from '../time';
import { asRecord, Validator } from '../validate';

export const publicRouter = Router();

publicRouter.get('/health', (_req, res) => {
  sendJson(res, 200, { status: 'ok' });
});

publicRouter.get('/status', (_req, res) => {
  const body: StatusResponse = {
    server_now: isoUtc(serverNow()),
    holds: valkeyReachable() ? 'ok' : 'paused',
    deposits: killBillReachable() ? 'ok' : 'paused',
  };
  sendJson(res, 200, body);
});

publicRouter.get('/rules', (_req, res) => {
  const body: RulesResponse = {
    timezone: RESTAURANT_TIMEZONE,
    slot_times: [...SLOT_TIMES],
    booking_lead_minutes: BOOKING_LEAD_MINUTES,
    booking_horizon_days: BOOKING_HORIZON_DAYS,
    hold_seconds: config.holdSeconds,
    offer_seconds: config.offerSeconds,
    turn_minutes: TURN_MINUTES,
    reset_minutes: RESET_MINUTES,
    deposit_cents_per_cover: DEPOSIT_CENTS_PER_COVER,
    deposit_min_party: DEPOSIT_MIN_PARTY,
    deposit_rooms: [...DEPOSIT_ROOMS],
    refund_cutoff_hours: REFUND_CUTOFF_HOURS,
    no_show_after_minutes: NO_SHOW_AFTER_MINUTES,
    host_session_hours: HOST_SESSION_HOURS,
  };
  sendJson(res, 200, body);
});

publicRouter.get(
  '/floor',
  asyncHandler(async (_req, res) => {
    const layout = await loadLayout();
    const body: FloorResponse = {
      rooms: layout.rooms.map((room) => ({
        room_id: room.roomId,
        name: room.name,
        seats: room.seats,
        tables: room.tables.map((table) => ({
          table_id: table.tableId,
          min_seats: table.minSeats,
          max_seats: table.maxSeats,
        })),
      })),
      joinable_pairs: layout.pairs.map((pair) => ({
        pair_id: pair.pairId,
        tables: [...pair.tableIds],
        min_seats: pair.minSeats,
        max_seats: pair.maxSeats,
      })),
    };
    sendJson(res, 200, body);
  }),
);

publicRouter.get(
  '/tonight',
  asyncHandler(async (_req, res) => {
    sendJson(res, 200, await tonightFor(pool, serverNow()));
  }),
);

publicRouter.get(
  '/availability',
  asyncHandler(async (req, res) => {
    const now = serverNow();
    const validator = new Validator();
    const { date, party } = validator.finish({
      date: validator.date('date', req.query.date, now),
      party: validator.partyFromQuery('party', req.query.party),
    });
    sendJson(res, 200, await availabilityFor(pool, date, party, now));
  }),
);

publicRouter.get(
  '/plan',
  asyncHandler(async (req, res) => {
    const now = serverNow();
    const validator = new Validator();
    const { date, time, party } = validator.finish({
      date: validator.date('date', req.query.date, now),
      time: validator.slotTime('time', req.query.time),
      party: validator.partyFromQuery('party', req.query.party),
    });
    sendJson(res, 200, await planFor(pool, date, time, party, now));
  }),
);

publicRouter.put(
  '/clock',
  asyncHandler(async (req, res) => {
    if (!config.clockControl) throw errors.notFound();
    const validator = new Validator();
    const body = asRecord(req.body);
    const { instant } = validator.finish({
      instant: validator.isoInstant('now', body.now),
    });
    await setServerNow(instant);
    sendJson(res, 200, { server_now: isoUtc(serverNow()) });
  }),
);
