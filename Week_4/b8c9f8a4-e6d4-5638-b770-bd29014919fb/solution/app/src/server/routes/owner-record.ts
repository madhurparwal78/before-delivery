// Pulling the roadworthiness record and answering its advisories.

import { randomUUID } from 'node:crypto';
import { query } from '../db/pool.js';
import { fail } from '../http/errors.js';
import { asObject, readJson, type Context } from '../http/request.js';
import { sendJson } from '../http/respond.js';
import type { Router } from '../http/router.js';
import { requireOwner } from '../http/session.js';
import { Fields } from '../http/validate.js';
import { RECURRED_FLAG } from '../../shared/copy.js';
import { pullRecord } from '../services/record-api.js';
import { requireOpenForEditing } from '../domain/listing.js';
import { STANCES, buildAdvisories, hasLaterTest, type ConditionRecord } from '../domain/record.js';
import { latestPull, loadCar, workingRecord, type CarRow } from '../domain/state.js';

async function ownedCar(context: Context): Promise<CarRow> {
  await requireOwner(context.request);
  const car = await loadCar(context.params.id);
  if (!car) fail(404, 'not_found', 'That car file is not one of ours.');
  return car;
}

export function registerRecord(router: Router): void {
  router.post('/api/owner/cars/:id/record/pull', async (context) => {
    const car = await ownedCar(context);
    const result = await pullRecord(car.registration);
    if (result.kind === 'not_found') fail(404, 'record_not_found', 'No test record was found for this registration.');
    if (result.kind === 'throttled') {
      fail(429, 'record_throttled', 'The record service is busy.', { retryAfterSeconds: result.retryAfterSeconds });
    }
    if (result.kind === 'unreachable') {
      fail(503, 'record_unreachable', 'The roadworthiness record service is not answering.');
    }
    await query('INSERT INTO record_pull (id, car_id, payload) VALUES ($1, $2, $3)', [
      randomUUID(),
      car.id,
      JSON.stringify(result.payload),
    ]);
    const record = await workingRecord(car.id);
    sendJson(context.response, 201, record);
  });

  router.get('/api/owner/cars/:id/record', async (context) => {
    const car = await ownedCar(context);
    const record = await workingRecord(car.id);
    if (!record) fail(404, 'no_record_pull', 'This car has never been pulled.');
    sendJson(context.response, 200, record);
  });

  router.put('/api/owner/cars/:id/advisories/:advisoryId', async (context) => {
    const car = await ownedCar(context);
    const body = asObject(readJson(context));
    requireOpenForEditing(car.listing_status);
    const pull = await latestPull(car.id);
    if (!pull) fail(404, 'not_found', 'That advisory is not on the latest pull.');
    const advisories = buildAdvisories(pull.payload, []);
    const advisory = advisories.find((item) => item.id === context.params.advisoryId);
    if (!advisory) fail(404, 'not_found', 'That advisory is not on the latest pull.');

    const fields = new Fields();
    const stance = fields.choice('stance', body.stance, STANCES);
    const note = fields.text('note', body.note, 1, 500);
    if (!fields.bad && stance === 'repaired' && hasLaterTest(sorted(pull.payload.motTests), advisory)) {
      fields.add('stance', RECURRED_FLAG);
    }
    fields.done();

    await query(
      `INSERT INTO advisory_response (car_id, advisory_id, stance, note, answered_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (car_id, advisory_id) DO UPDATE SET stance = EXCLUDED.stance, note = EXCLUDED.note,
         answered_at = now()`,
      [car.id, advisory.id, stance, note],
    );
    const record = (await workingRecord(car.id)) as ConditionRecord; // a pull exists, checked above
    const saved = record.advisories.find((item) => item.id === advisory.id);
    sendJson(context.response, 200, saved);
  });
}

function sorted<T extends { completedDate: string }>(tests: T[]): T[] {
  return [...tests].sort((a, b) => new Date(a.completedDate).getTime() - new Date(b.completedDate).getTime());
}
