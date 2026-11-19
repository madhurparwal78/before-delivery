// Owner routes for the car file itself: the session, the garage, panels and readings, findings.

import { randomUUID, timingSafeEqual, scryptSync } from 'node:crypto';
import { one, query } from '../db/pool.js';
import { fail } from '../http/errors.js';
import { asObject, readJson, type Context } from '../http/request.js';
import { sendEmpty, sendJson } from '../http/respond.js';
import type { Router } from '../http/router.js';
import { endAllSessions, requireOwner, startSession } from '../http/session.js';
import { Fields, normaliseRegistration } from '../http/validate.js';
import { MESSAGE } from '../../shared/copy.js';
import { PANELS, isGaugeable, panel } from '../../shared/panels.js';
import { MICRONS_MAX, MICRONS_MIN } from '../../shared/measures.js';
import { requireOpenForEditing } from '../domain/listing.js';
import { SEVERITIES, toFinding, type FindingRow } from '../domain/findings.js';
import {
  bandOfPanel, carJson, findingRows, loadCar, loadReadings, panelsJson, type CarRow,
} from '../domain/state.js';

export function passphraseHash(passphrase: string, salt: string): string {
  return scryptSync(passphrase, salt, 32).toString('hex');
}

async function checkPassphrase(passphrase: string): Promise<boolean> {
  const row = await one<{ passphrase_hash: string }>('SELECT passphrase_hash FROM owner_secret WHERE id = 1');
  if (!row) return false;
  const [salt, digest] = row.passphrase_hash.split(':');
  const offered = Buffer.from(passphraseHash(passphrase, salt), 'hex');
  const stored = Buffer.from(digest, 'hex');
  return offered.length === stored.length && timingSafeEqual(offered, stored);
}

async function ownedCar(context: Context): Promise<CarRow> {
  await requireOwner(context.request);
  const car = await loadCar(context.params.id);
  if (!car) fail(404, 'not_found', 'That car file is not one of ours.');
  return car;
}

export function registerOwnerCars(router: Router): void {
  router.post('/api/owner/session', async (context) => {
    const body = asObject(readJson(context));
    const passphrase = typeof body.passphrase === 'string' ? body.passphrase : '';
    if (!(await checkPassphrase(passphrase))) fail(401, 'bad_passphrase', MESSAGE.passphraseWrong);
    await startSession(context.response);
    sendJson(context.response, 200, { signedIn: true });
  });

  router.delete('/api/owner/session', async (context) => {
    await endAllSessions(context.response);
    sendEmpty(context.response, 204);
  });

  router.get('/api/owner/cars', async (context) => {
    await requireOwner(context.request);
    const rows = await query<CarRow>('SELECT * FROM car ORDER BY created_at ASC');
    sendJson(context.response, 200, { cars: await Promise.all(rows.map((row) => carJson(row))) });
  });

  router.post('/api/owner/cars', async (context) => {
    await requireOwner(context.request);
    const body = asObject(readJson(context));
    const fields = new Fields();
    const name = fields.text('name', body.name, 1, 80);
    const viewingArea = fields.text('viewingArea', body.viewingArea, 1, 80);
    const homeAddress = fields.text('homeAddress', body.homeAddress, 1, 200);
    const story = fields.text('story', body.story, 1, 1000);
    const askingPounds = fields.whole('askingPounds', body.askingPounds, 1, 10000000);
    const registration = normaliseRegistration(body.registration);
    if (registration === null) {
      fields.add('registration', 'Use 2 to 7 letters or digits.');
    }
    fields.done();
    const car = await one<CarRow>(
      `INSERT INTO car (id, name, registration, asking_pounds, viewing_area, home_address, story, listing_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft') RETURNING *`,
      [randomUUID(), name, registration, askingPounds, viewingArea, homeAddress, story],
    );
    sendJson(context.response, 201, await carJson(car as CarRow));
  });

  router.get('/api/owner/cars/:id', async (context) => {
    sendJson(context.response, 200, await carJson(await ownedCar(context)));
  });

  router.get('/api/owner/cars/:id/panels', async (context) => {
    const car = await ownedCar(context);
    sendJson(context.response, 200, await panelsJson(car.id, { kind: 'owner' }));
  });

  router.put('/api/owner/cars/:id/readings', async (context) => {
    const car = await ownedCar(context);
    const body = asObject(readJson(context));
    requireOpenForEditing(car.listing_status);
    const offered = Array.isArray(body.readings) ? body.readings : [];
    const fields = new Fields();
    const accepted: { panelId: string; microns: number }[] = [];
    for (const item of offered) {
      const row = asObject(item);
      const panelId = typeof row.panelId === 'string' ? row.panelId : '';
      const found = panel(panelId);
      if (!found) {
        fields.add(panelId || 'panelId', 'That is not one of the car’s panels.');
        continue;
      }
      if (!isGaugeable(panelId)) {
        fields.add(panelId, MESSAGE.plastic);
        continue;
      }
      const microns = row.microns;
      if (typeof microns !== 'number' || !Number.isInteger(microns) || microns < MICRONS_MIN || microns > MICRONS_MAX) {
        fields.add(panelId, MESSAGE.microns);
        continue;
      }
      accepted.push({ panelId, microns });
    }
    fields.done();
    for (const reading of accepted) {
      await query(
        `INSERT INTO reading (car_id, panel_id, microns, read_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (car_id, panel_id) DO UPDATE SET microns = EXCLUDED.microns, read_at = now()`,
        [car.id, reading.panelId, reading.microns],
      );
    }
    sendJson(context.response, 200, await panelsJson(car.id, { kind: 'owner' }));
  });

  router.get('/api/owner/cars/:id/findings', async (context) => {
    const car = await ownedCar(context);
    const rows = await findingRows(car.id);
    const readings = await loadReadings(car.id);
    sendJson(context.response, 200, {
      findings: rows.map((row, index) => toFinding(row, index + 1, bandOfPanel(row.panel_id, readings))),
    });
  });

  router.post('/api/owner/cars/:id/findings', async (context) => {
    const car = await ownedCar(context);
    const body = asObject(readJson(context));
    requireOpenForEditing(car.listing_status);
    const values = await readFindingFields(car, body, {});
    const row = await one<FindingRow>(
      `INSERT INTO finding (id, car_id, panel_id, u, v, title, wording, severity, photo_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [randomUUID(), car.id, values.panelId, values.u, values.v, values.title, values.wording, values.severity, values.photoId],
    );
    const rows = await findingRows(car.id);
    const readings = await loadReadings(car.id);
    const position = rows.findIndex((item) => item.id === (row as FindingRow).id) + 1;
    sendJson(context.response, 201, toFinding(row as FindingRow, position, bandOfPanel(values.panelId, readings)));
  });

  router.patch('/api/owner/cars/:id/findings/:findingId', async (context) => {
    const car = await ownedCar(context);
    const body = asObject(readJson(context));
    const existing = await loadFinding(car.id, context.params.findingId);
    requireOpenForEditing(car.listing_status);
    requireRevision(context, existing);
    const values = await readFindingFields(car, body, existing);
    const row = await one<FindingRow>(
      `UPDATE finding SET panel_id = $3, u = $4, v = $5, title = $6, wording = $7, severity = $8, photo_id = $9,
         revision = revision + 1
       WHERE car_id = $1 AND id = $2 RETURNING *`,
      [car.id, existing.id, values.panelId, values.u, values.v, values.title, values.wording, values.severity, values.photoId],
    );
    const rows = await findingRows(car.id);
    const readings = await loadReadings(car.id);
    const position = rows.findIndex((item) => item.id === existing.id) + 1;
    sendJson(context.response, 200, toFinding(row as FindingRow, position, bandOfPanel(values.panelId, readings)));
  });

  router.delete('/api/owner/cars/:id/findings/:findingId', async (context) => {
    const car = await ownedCar(context);
    const existing = await loadFinding(car.id, context.params.findingId);
    requireOpenForEditing(car.listing_status);
    requireRevision(context, existing);
    await query('UPDATE finding SET removed_at = now(), revision = revision + 1 WHERE id = $1', [existing.id]);
    sendEmpty(context.response, 204);
  });
}

async function loadFinding(carId: string, findingId: string): Promise<FindingRow> {
  if (!/^[0-9a-fA-F-]{36}$/.test(findingId)) fail(404, 'not_found', 'That finding is not on this car.');
  const row = await one<FindingRow>(
    'SELECT * FROM finding WHERE id = $1 AND car_id = $2 AND removed_at IS NULL',
    [findingId, carId],
  );
  if (!row) fail(404, 'not_found', 'That finding is not on this car.');
  return row;
}

function requireRevision(context: Context, existing: FindingRow): void {
  const header = context.request.headers['if-match'];
  const value = (Array.isArray(header) ? header[0] : header ?? '').trim();
  if (!value) fail(428, 'precondition_required', 'Send the revision you are changing in If-Match.');
  const offered = Number(value.replace(/^W\//, '').replace(/"/g, ''));
  if (offered !== existing.revision) {
    fail(412, 'stale_finding', MESSAGE.staleFinding, { currentRevision: existing.revision });
  }
}

interface FindingValues {
  panelId: string;
  u: number;
  v: number;
  title: string;
  wording: string;
  severity: 'cosmetic' | 'moderate' | 'serious';
  photoId: string | null;
}

async function readFindingFields(
  car: CarRow,
  body: Record<string, unknown>,
  existing: Partial<FindingRow>,
): Promise<FindingValues> {
  const fields = new Fields();
  const has = (name: string): boolean => Object.prototype.hasOwnProperty.call(body, name);
  const panelId = has('panelId') || existing.panel_id === undefined
    ? fields.choice('panelId', body.panelId, panelIds())
    : existing.panel_id;
  const u = has('u') || existing.u === undefined ? fields.fraction('u', body.u) : Number(existing.u);
  const v = has('v') || existing.v === undefined ? fields.fraction('v', body.v) : Number(existing.v);
  const title = has('title') || existing.title === undefined
    ? fields.text('title', body.title, 1, 80)
    : existing.title;
  const wording = has('wording') || existing.wording === undefined
    ? fields.text('wording', body.wording, 1, 600)
    : existing.wording;
  const severity = has('severity') || existing.severity === undefined
    ? fields.choice('severity', body.severity, SEVERITIES)
    : existing.severity;
  let photoId: string | null = existing.photo_id ?? null;
  if (has('photoId')) {
    const offered = body.photoId;
    if (offered === null) {
      photoId = null;
    } else if (typeof offered !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(offered)) {
      fields.add('photoId', 'Choose a stored photo of this car.');
    } else {
      const found = await one(
        "SELECT 1 AS found FROM upload WHERE id = $1 AND car_id = $2 AND kind = 'photo'",
        [offered, car.id],
      );
      if (!found) fields.add('photoId', 'Choose a stored photo of this car.');
      else photoId = offered;
    }
  }
  fields.done();
  return { panelId, u, v, title, wording, severity, photoId };
}

function panelIds(): readonly string[] {
  return PANELS.map((item) => item.id);
}
