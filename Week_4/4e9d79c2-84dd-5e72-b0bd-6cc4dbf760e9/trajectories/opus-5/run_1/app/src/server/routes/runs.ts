import { Route, assertKnown, jsonBody, pathParam, route } from './router.js';
import { conflict, gone, invalid, notFound, providerUnavailable } from '../errors.js';
import { chargesAccepted, copy, driverClash, missingHour, runMoved } from '../copy.js';
import { makeId, query } from '../db.js';
import { requireDesk } from '../session.js';
import { moneyString } from '../../domain/money.js';
import { Block, BlockKind } from '../../domain/hours.js';
import {
  addDays,
  clockChangeLabel,
  instantString,
  isDateString,
  isTimeString,
  mondayOfIsoWeek,
  readWall,
  startOfUkDay,
  ukDateOf,
  ukHoursInDay,
  ukTimeOf,
} from '../../domain/time.js';
import {
  PRESS_KINDS,
  PRESS_ORDER,
  PressKind,
  RunRecord,
  chargeForPress,
  chargesTotal,
  dutySpanOf,
  driverClashOf,
  flightLanding,
  hoursOf,
  pressesOf,
  runById,
  runByToken,
  runsBetween,
  runMessage,
  runTitle,
} from '../data/runs.js';
import { loadHire } from '../data/hires.js';
import { acceptCharges, addSecondDriverCharge } from '../data/payments.js';
import { PushDown, publishToDriver } from '../providers/push.js';
import { foldTelephone } from '../../domain/text.js';

const BLOCK_KINDS: BlockKind[] = ['drive', 'break', 'wait', 'rest'];

function runJson(run: RunRecord): Record<string, unknown> {
  return {
    id: run.id,
    number: run.number,
    hireId: run.hireId,
    vehicleId: run.vehicleId,
    seats: run.seats,
    driver: run.driverName ? { name: run.driverName, telephone: run.driverTelephone } : null,
    toldAt: run.toldAt === null ? null : instantString(run.toldAt),
    confirmed: run.confirmed,
    sheetPath: `/r/${run.sheetToken}`,
    departAt: run.departAt,
    departInstant: instantString(run.departInstant),
    secondDriver: run.secondDriver,
    stops: run.stops.map((stop) => ({ id: stop.id, text: stop.text, flightCode: stop.flightCode })),
    charges: run.charges.map((charge) => ({
      stopId: charge.stopId,
      kind: charge.kind,
      minutes: charge.minutes,
      amount: moneyString(charge.amount),
      accepted: charge.accepted,
    })),
    chargesTotal: moneyString(chargesTotal(run)),
  };
}

async function tellDriver(run: RunRecord, changed: boolean): Promise<void> {
  if (!run.driverTelephone) throw conflict('noDriver', 'That run has no driver.');
  await publishToDriver(run.driverTelephone, runTitle(run), runMessage(run, changed));
}

export const runRoutes: Route[] = [
  route('GET', '/api/diary', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const week = ctx.queryValue('week') ?? '';
    const monday = mondayOfIsoWeek(week);
    if (!monday) throw invalid('That is not a week.', { week: 'That is not a week.' });
    const from = startOfUkDay(monday);
    const to = startOfUkDay(addDays(monday, 7));
    const runs = await runsBetween(desk.id, from, to);
    ctx.json(200, {
      week,
      days: Array.from({ length: 7 }, (_unused, index) => {
        const date = addDays(monday, index);
        return { date, hours: ukHoursInDay(date), label: clockChangeLabel(date) };
      }),
      rows: runs.map((run) => ({
        runId: run.id,
        number: run.number,
        hireId: run.hireId,
        seats: run.seats,
        driver: run.driverName ? { name: run.driverName, telephone: run.driverTelephone } : null,
        departAt: run.departAt,
        departInstant: instantString(run.departInstant),
      })),
    });
  }),

  route('GET', '/api/runs/:id', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    ctx.json(200, runJson(assertKnown(await runById(desk.id, pathParam(ctx, 'id')))));
  }),

  route('PUT', '/api/runs/:id/departure', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const run = assertKnown(await runById(desk.id, pathParam(ctx, 'id')));
    const body = await jsonBody(ctx);
    const departAt = body.departAt;
    if (departAt === null || typeof departAt !== 'object' || Array.isArray(departAt)) {
      throw invalid(copy.enterDate, { departAt: copy.enterDate });
    }
    const asked = departAt as Record<string, unknown>;
    if (!isDateString(asked.date)) throw invalid(copy.enterDate, { departAt: copy.enterDate });
    const time = typeof asked.time === 'string' ? asked.time : run.departAt.time;
    if (!isTimeString(time)) throw invalid(copy.chooseHourAndMinutes, { departAt: copy.chooseHourAndMinutes });
    const reading = readWall({ date: asked.date, time });
    if (!reading) {
      throw invalid(missingHour(time, asked.date), { departAt: missingHour(time, asked.date) });
    }
    const moved: RunRecord = {
      ...run,
      departAt: { date: asked.date, time },
      departInstant: reading.instant,
      blocksStart: run.blocksStart ? { date: asked.date, time: run.blocksStart.time } : null,
    };
    const clash = await driverClashOf(moved, run.driverTelephone, dutySpanOf(moved));
    if (clash) {
      throw conflict('driverClash', driverClash(clash.number, ukTimeOf(dutySpanOf(clash).from)));
    }
    await query(
      `update runs set depart_date = $3, depart_time = $4, depart_instant = $5,
         blocks_start_date = case when blocks_start_date is null then null else $3 end
       where desk_id = $1 and id = $2`,
      [desk.id, run.id, asked.date, time, reading.instant],
    );
    const fresh = assertKnown(await runById(desk.id, run.id));
    if (run.toldAt !== null) {
      try {
        await tellDriver(fresh, true);
      } catch (trouble) {
        if (trouble instanceof PushDown) {
          await query('update runs set told_at = null where desk_id = $1 and id = $2', [desk.id, run.id]);
          throw providerUnavailable(copy.driverPhoneFailed, 'driverPhoneDown');
        }
        throw trouble;
      }
    }
    ctx.json(200, { ...runJson(fresh), announcement: runMoved(fresh.number, fresh.departAt.date) });
  }),

  route('PUT', '/api/runs/:id/driver', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const run = assertKnown(await runById(desk.id, pathParam(ctx, 'id')));
    const body = await jsonBody(ctx);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const telephone = typeof body.telephone === 'string' ? body.telephone.trim() : '';
    if (name === '') throw invalid(copy.enterName, { name: copy.enterName });
    if (telephone === '') throw invalid(copy.enterTelephone, { telephone: copy.enterTelephone });
    const sameDriver =
      run.driverTelephone !== null && foldTelephone(run.driverTelephone) === foldTelephone(telephone);
    const clash = await driverClashOf(run, telephone, dutySpanOf(run));
    if (clash) throw conflict('driverClash', driverClash(clash.number, ukTimeOf(dutySpanOf(clash).from)));
    await query('update runs set driver_name = $3, driver_telephone = $4, driver_folded = $5 where desk_id = $1 and id = $2', [
      desk.id,
      run.id,
      name,
      telephone,
      foldTelephone(telephone),
    ]);
    const fresh = assertKnown(await runById(desk.id, run.id));
    if (sameDriver && run.toldAt !== null) {
      ctx.json(200, runJson(fresh));
      return;
    }
    try {
      await tellDriver(fresh, false);
    } catch (trouble) {
      if (trouble instanceof PushDown) {
        await query('update runs set told_at = null where desk_id = $1 and id = $2', [desk.id, run.id]);
        throw providerUnavailable(copy.driverPhoneFailed, 'driverPhoneDown');
      }
      throw trouble;
    }
    const at = Date.now();
    await query('update runs set told_at = $3 where desk_id = $1 and id = $2', [desk.id, run.id, at]);
    ctx.json(200, runJson(assertKnown(await runById(desk.id, run.id))));
  }),

  route('POST', '/api/runs/:id/tell', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const run = assertKnown(await runById(desk.id, pathParam(ctx, 'id')));
    await jsonBody(ctx);
    if (!run.driverName) throw conflict('noDriver', 'That run has no driver.');
    try {
      await tellDriver(run, run.toldAt !== null);
    } catch (trouble) {
      if (trouble instanceof PushDown) throw providerUnavailable(copy.driverPhoneFailed, 'driverPhoneDown');
      throw trouble;
    }
    await query('update runs set told_at = $3 where desk_id = $1 and id = $2', [desk.id, run.id, Date.now()]);
    ctx.json(200, runJson(assertKnown(await runById(desk.id, run.id))));
  }),

  route('PUT', '/api/runs/:id/blocks', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const run = assertKnown(await runById(desk.id, pathParam(ctx, 'id')));
    const body = await jsonBody(ctx);
    const startBody = body.startAt;
    let startDate = run.departAt.date;
    let startTime = run.departAt.time;
    if (startBody !== undefined && startBody !== null) {
      const asked = startBody as Record<string, unknown>;
      if (!isDateString(asked.date)) throw invalid(copy.enterDate, { startAt: copy.enterDate });
      if (!isTimeString(asked.time)) throw invalid(copy.chooseHourAndMinutes, { startAt: copy.chooseHourAndMinutes });
      startDate = asked.date;
      startTime = asked.time;
    }
    const rows = Array.isArray(body.blocks) ? (body.blocks as Record<string, unknown>[]) : [];
    const blocks: Block[] = rows.map((row) => {
      const kind = row.kind;
      const minutes = Number(row.minutes);
      if (typeof kind !== 'string' || !BLOCK_KINDS.includes(kind as BlockKind)) {
        throw invalid('Choose a block kind.', { blocks: 'Choose a block kind.' });
      }
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
        throw invalid('Blocks run from 0 to 1440 minutes.', { blocks: 'Blocks run from 0 to 1440 minutes.' });
      }
      return { kind: kind as BlockKind, minutes };
    });
    await query(
      'update runs set blocks = $3, blocks_start_date = $4, blocks_start_time = $5 where desk_id = $1 and id = $2',
      [desk.id, run.id, JSON.stringify(blocks), startDate, startTime],
    );
    ctx.json(200, await hoursOf(assertKnown(await runById(desk.id, run.id))));
  }),

  route('GET', '/api/runs/:id/hours', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    ctx.json(200, await hoursOf(assertKnown(await runById(desk.id, pathParam(ctx, 'id')))));
  }),

  route('POST', '/api/runs/:id/second-driver', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const run = assertKnown(await runById(desk.id, pathParam(ctx, 'id')));
    await jsonBody(ctx);
    const hire = assertKnown(await loadHire(desk.id, run.hireId));
    await addSecondDriverCharge(desk.id, run.id, run.vehicleId, run.hireId, hire.rates.secondDriverCharge);
    ctx.json(200, runJson(assertKnown(await runById(desk.id, run.id))));
  }),

  route('POST', '/api/runs/:id/confirm', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const run = assertKnown(await runById(desk.id, pathParam(ctx, 'id')));
    await jsonBody(ctx);
    const hours = await hoursOf(run);
    if (hours.breaches.length > 0) throw conflict('overTheLimit', copy.overTheLimit);
    await query('update runs set confirmed = true where desk_id = $1 and id = $2', [desk.id, run.id]);
    ctx.json(200, runJson(assertKnown(await runById(desk.id, run.id))));
  }),

  route('PUT', '/api/runs/:id/stops/:stopId/flight', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const run = assertKnown(await runById(desk.id, pathParam(ctx, 'id')));
    const stopId = pathParam(ctx, 'stopId');
    if (!run.stops.some((stop) => stop.id === stopId)) throw notFound();
    const body = await jsonBody(ctx);
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (code === '') throw invalid('Enter a flight code.', { code: 'Enter a flight code.' });
    await query(
      'update run_stops set flight_code = $3, flight_checked_at = null, flight_actual = null where desk_id = $1 and id = $2',
      [desk.id, stopId, code],
    );
    ctx.json(200, runJson(assertKnown(await runById(desk.id, run.id))));
  }),

  route('POST', '/api/runs/:id/accept-charges', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const run = assertKnown(await runById(desk.id, pathParam(ctx, 'id')));
    await jsonBody(ctx);
    const answer = await acceptCharges(desk.id, run.id, run.vehicleId, run.hireId);
    const hire = assertKnown(await loadHire(desk.id, run.hireId));
    const vehicle = hire.vehicles.find((held) => held.id === run.vehicleId);
    ctx.json(200, {
      added: moneyString(answer.added),
      vehicleTotal: moneyString(vehicle?.total ?? 0),
      announcement: chargesAccepted(answer.added),
    });
  }),

  route('GET', '/api/r/:token', 'private', async (ctx) => {
    const run = await runByToken(pathParam(ctx, 'token'));
    if (!run) throw notFound();
    const hire = assertKnown(await loadHire(run.deskId, run.hireId));
    if (hire.cancelledAt !== null || hire.customer.erased) throw gone('pageEnded', copy.notFound);
    const presses = await pressesOf(run.deskId, run.id);
    const airport = run.stops.find((stop) => stop.flightCode);
    ctx.json(200, {
      number: run.number,
      departAt: run.departAt,
      departInstant: instantString(run.departInstant),
      stops: run.stops.map((stop) => ({
        id: stop.id,
        text: stop.text,
        presses: {
          arrived: pressInstant(presses, stop.id, 'arrived'),
          boarded: pressInstant(presses, stop.id, 'boarded'),
          left: pressInstant(presses, stop.id, 'left'),
        },
      })),
      flightLine: airport && airport.flightOk === false ? 'flightTimesUnavailable' : null,
      charges: run.charges.map((charge) => ({
        stopId: charge.stopId,
        kind: charge.kind,
        minutes: charge.minutes,
        amount: moneyString(charge.amount),
        accepted: charge.accepted,
      })),
    });
  }),

  route('POST', '/api/r/:token/presses', 'private', async (ctx) => {
    const run = await runByToken(pathParam(ctx, 'token'));
    if (!run) throw notFound();
    const hire = assertKnown(await loadHire(run.deskId, run.hireId));
    if (hire.cancelledAt !== null || hire.customer.erased) throw gone('pageEnded', copy.notFound);
    const body = await jsonBody(ctx);
    const stopId = typeof body.stopId === 'string' ? body.stopId : '';
    const stop = run.stops.find((held) => held.id === stopId);
    if (!stop) throw notFound();
    const kind = body.kind;
    if (typeof kind !== 'string' || !PRESS_KINDS.includes(kind as PressKind)) {
      throw invalid('Choose a press.', { kind: 'Choose a press.' });
    }
    const repeatKey = typeof body.repeatKey === 'string' && body.repeatKey.trim() !== '' ? body.repeatKey : null;
    if (!repeatKey) throw invalid('Send a repeat key.', { repeatKey: 'Send a repeat key.' });
    const secondsAgo = Number(body.secondsAgo ?? 0);
    if (!Number.isFinite(secondsAgo) || secondsAgo < 0) {
      throw invalid('Send the seconds since the press.', { secondsAgo: 'Send the seconds since the press.' });
    }
    const presses = await pressesOf(run.deskId, run.id);
    const held = presses.find((press) => press.repeatKey === repeatKey);
    if (held) {
      if (held.stopId !== stopId || held.kind !== kind) {
        throw conflict('repeatKeyConflict', 'That repeat key belongs to another press.');
      }
      ctx.json(201, { pressId: held.id, at: instantString(held.at) });
      return;
    }
    const wanted = kind as PressKind;
    if (presses.some((press) => press.stopId === stopId && press.kind === wanted)) {
      throw conflict('pressOutOfOrder', 'That press is already in.');
    }
    const needed = PRESS_ORDER[wanted];
    if (needed && !presses.some((press) => press.stopId === stopId && press.kind === needed)) {
      throw conflict('pressOutOfOrder', 'An earlier press at this stop is missing.');
    }
    const at = Date.now() - Math.floor(secondsAgo) * 1000;
    const pressId = makeId('PR');
    await query('insert into presses (desk_id, id, run_id, stop_id, kind, at, repeat_key) values ($1,$2,$3,$4,$5,$6,$7)', [
      run.deskId,
      pressId,
      run.id,
      stopId,
      wanted,
      at,
      repeatKey,
    ]);
    const charge = await chargeForPress(run, stop, wanted, at, presses, hire.rates.waitingRatePerHour);
    if (charge && charge.amount > 0) {
      await query(
        `insert into charges (desk_id, id, run_id, stop_id, vehicle_id, kind, minutes, amount)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [run.deskId, makeId('CH'), run.id, stopId, run.vehicleId, charge.kind, charge.minutes, charge.amount],
      );
    }
    ctx.json(201, { pressId, at: instantString(at) });
  }),
];

function pressInstant(
  presses: { stopId: string; kind: PressKind; at: number }[],
  stopId: string,
  kind: PressKind,
): string | null {
  const press = presses.find((held) => held.stopId === stopId && held.kind === kind);
  return press ? instantString(press.at) : null;
}

export { flightLanding, ukDateOf };
