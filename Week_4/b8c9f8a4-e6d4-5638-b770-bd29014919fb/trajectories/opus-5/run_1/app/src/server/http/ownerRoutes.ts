import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { ERRORS } from '../../shared/copy';
import { formatSlotLabel, londonZoneOf } from '../../shared/format';
import { isGaugeable, panelById } from '../../shared/panels';
import type { Severity, Stance } from '../../shared/types';
import { query, queryOne, transaction } from '../db';
import { MICRONS_MAX, MICRONS_MIN } from '../domain/bands';
import { illegalTransition, listingClosed, notFound, refuse, validationFailure } from '../domain/errors';
import { SEVERITIES, roundAnchor } from '../domain/findings';
import { acceptsCarChanges, isLegalTransition } from '../domain/listing';
import { resolveLondonLocalStart } from '../domain/london';
import { advisoryId, textReturnsLater } from '../domain/record';
import { alertDto, listAlerts, retryAlert } from '../repo/alerts';
import {
  buildCarDto,
  buildPanels,
  findCarRow,
  listCarRows,
  loadFindingDtos,
  loadLatestPull,
  loadWorkingRecord,
  lockCarRow,
  type CarRow,
} from '../repo/cars';
import { buildLinkDto, expiryFromNow, findLinkById, insertLink, listLinks, newToken } from '../repo/links';
import { requireIdempotencyKey } from '../repo/idempotency';
import { listVersions, loadVersion, versionDto } from '../repo/versions';
import { pullVehicleRecord } from '../services/recordApi';
import { completeSale, publishCar } from '../services/publishing';
import { getObject, objectKeys } from '../services/storage';
import { acceptOffer, declineOffer, listOwnerOffers } from '../services/offers';
import { uploadRoute, uploadsListRoute } from './uploadRoutes';
import { asRecord, enumField, FieldErrors, integerField, normaliseRegistration, textField } from './validate';

export const ownerRouter = Router();

const carOf = async (request: Request): Promise<CarRow> => {
  const car = await findCarRow(String(request.params.id));
  if (car === null) throw notFound();
  return car;
};

const requireCarChanges = (car: CarRow): void => {
  if (!acceptsCarChanges(car.listing_status)) throw listingClosed();
};

ownerRouter.get('/cars', async (_request: Request, response: Response) => {
  const rows = await listCarRows();
  const cars = await Promise.all(rows.map(buildCarDto));
  response.json({ cars });
});

ownerRouter.post('/cars', async (request: Request, response: Response) => {
  const body = asRecord(request.body);
  const errors = new FieldErrors();
  const name = textField(errors, body.name, 'name', 1, 80);
  const registration = normaliseRegistration(errors, body.registration);
  const askingPounds = integerField(errors, body.askingPounds, 'askingPounds', 1, 10_000_000);
  const viewingArea = textField(errors, body.viewingArea, 'viewingArea', 1, 80);
  const homeAddress = textField(errors, body.homeAddress, 'homeAddress', 1, 200);
  const story = textField(errors, body.story, 'story', 1, 1_000);
  errors.throwIfAny();

  const id = randomUUID();
  await query(
    `INSERT INTO car (id, name, registration, asking_pounds, viewing_area, home_address, story, listing_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')`,
    [id, name, registration, askingPounds, viewingArea, homeAddress, story],
  );
  const car = await findCarRow(id);
  if (car === null) throw new Error('The new car file could not be read back');
  response.status(201).json(await buildCarDto(car));
});

ownerRouter.get('/cars/:id', async (request: Request, response: Response) => {
  response.json(await buildCarDto(await carOf(request)));
});

ownerRouter.get('/cars/:id/panels', async (request: Request, response: Response) => {
  const car = await carOf(request);
  response.json(await buildPanels(car.id, { includeNames: true, includeInspector: true }));
});

ownerRouter.put('/cars/:id/readings', async (request: Request, response: Response) => {
  const car = await carOf(request);
  requireCarChanges(car);
  const body = asRecord(request.body);
  const readings = Array.isArray(body.readings) ? (body.readings as unknown[]) : [];
  const errors: Record<string, string> = {};
  const accepted: { panelId: string; microns: number }[] = [];

  for (const entry of readings) {
    const row = asRecord(entry);
    const panelId = typeof row.panelId === 'string' ? row.panelId : '';
    const panel = panelById(panelId);
    if (panel === undefined) {
      errors[panelId] = 'That is not a panel on this car';
      continue;
    }
    if (!isGaugeable(panel)) {
      errors[panelId] = ERRORS.plasticPanel;
      continue;
    }
    const microns = row.microns;
    if (typeof microns !== 'number' || !Number.isInteger(microns) || microns < MICRONS_MIN || microns > MICRONS_MAX) {
      errors[panelId] = ERRORS.readingRange;
      continue;
    }
    accepted.push({ panelId, microns });
  }

  if (Object.keys(errors).length > 0) throw validationFailure(errors);

  await transaction(async (tx) => {
    for (const reading of accepted) {
      await tx.query(
        `INSERT INTO panel_reading (car_id, panel_id, microns, read_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (car_id, panel_id) DO UPDATE SET microns = excluded.microns, read_at = now()`,
        [car.id, reading.panelId, reading.microns],
      );
    }
  });

  response.json(await buildPanels(car.id, { includeNames: true, includeInspector: true }));
});

ownerRouter.get('/cars/:id/findings', async (request: Request, response: Response) => {
  const car = await carOf(request);
  response.json({ findings: await loadFindingDtos(car.id) });
});

interface FindingFields {
  panelId: string;
  u: number;
  v: number;
  title: string;
  wording: string;
  severity: Severity;
  photoId: string | null;
}

const readFindingFields = async (
  carId: string,
  body: Record<string, unknown>,
  partial: boolean,
): Promise<Partial<FindingFields>> => {
  const errors = new FieldErrors();
  const out: Partial<FindingFields> = {};

  const present = (field: string): boolean => Object.prototype.hasOwnProperty.call(body, field);

  if (!partial || present('panelId')) {
    const panelId = typeof body.panelId === 'string' ? body.panelId : '';
    if (panelById(panelId) === undefined) errors.add('panelId', 'Choose a panel on this car');
    else out.panelId = panelId;
  }
  for (const field of ['u', 'v'] as const) {
    if (!partial || present(field)) {
      const value = body[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        errors.add(field, 'Enter a number from 0 to 1');
      } else {
        out[field] = roundAnchor(value);
      }
    }
  }
  if (!partial || present('title')) out.title = textField(errors, body.title, 'title', 1, 80);
  if (!partial || present('wording')) out.wording = textField(errors, body.wording, 'wording', 1, 600);
  if (!partial || present('severity')) out.severity = enumField(errors, body.severity, 'severity', SEVERITIES);
  if (!partial || present('photoId')) {
    const photoId = body.photoId;
    if (photoId === null || photoId === undefined) {
      out.photoId = null;
    } else if (typeof photoId !== 'string') {
      errors.add('photoId', 'Choose a stored photo of this car');
    } else {
      const stored = await queryOne<{ id: string }>(
        "SELECT id FROM upload WHERE id = $1 AND car_id = $2 AND kind = 'photo'",
        [photoId, carId],
      );
      if (stored === null) errors.add('photoId', 'Choose a stored photo of this car');
      else out.photoId = photoId;
    }
  }

  errors.throwIfAny();
  return out;
};

const findingResponse = async (carId: string, findingId: string) => {
  const findings = await loadFindingDtos(carId);
  const finding = findings.find((candidate) => candidate.id === findingId);
  if (finding === undefined) throw notFound();
  return finding;
};

ownerRouter.post('/cars/:id/findings', async (request: Request, response: Response) => {
  const car = await carOf(request);
  requireCarChanges(car);
  const fields = (await readFindingFields(car.id, asRecord(request.body), false)) as FindingFields;
  const id = randomUUID();
  await query(
    `INSERT INTO finding (id, car_id, panel_id, u, v, title, wording, severity, photo_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, car.id, fields.panelId, fields.u, fields.v, fields.title, fields.wording, fields.severity, fields.photoId],
  );
  response.status(201).json(await findingResponse(car.id, id));
});

const requireIfMatch = (request: Request): number => {
  const header = request.headers['if-match'];
  if (typeof header !== 'string') {
    throw refuse(428, 'precondition_required', 'Send the finding revision in If-Match');
  }
  const parsed = Number(header.replace(/^W\//, '').replace(/"/g, ''));
  if (!Number.isInteger(parsed)) {
    throw refuse(428, 'precondition_required', 'Send the finding revision in If-Match');
  }
  return parsed;
};

ownerRouter.patch('/cars/:id/findings/:findingId', async (request: Request, response: Response) => {
  const car = await carOf(request);
  const findingId = String(request.params.findingId);
  const expected = requireIfMatch(request);
  const fields = await readFindingFields(car.id, asRecord(request.body), true);

  await transaction(async (tx) => {
    const current = await tx.queryOne<{ revision: number }>(
      'SELECT revision FROM finding WHERE id = $1 AND car_id = $2 FOR UPDATE',
      [findingId, car.id],
    );
    if (current === null) throw notFound();
    requireCarChanges(car);
    if (current.revision !== expected) {
      throw refuse(412, 'stale_finding', 'This finding has changed', { currentRevision: current.revision });
    }
    await tx.query(
      `UPDATE finding SET
         panel_id = coalesce($3, panel_id),
         u = coalesce($4, u),
         v = coalesce($5, v),
         title = coalesce($6, title),
         wording = coalesce($7, wording),
         severity = coalesce($8, severity),
         photo_id = CASE WHEN $9 THEN $10 ELSE photo_id END,
         revision = revision + 1
       WHERE id = $1 AND car_id = $2`,
      [
        findingId,
        car.id,
        fields.panelId ?? null,
        fields.u ?? null,
        fields.v ?? null,
        fields.title ?? null,
        fields.wording ?? null,
        fields.severity ?? null,
        Object.prototype.hasOwnProperty.call(asRecord(request.body), 'photoId'),
        fields.photoId ?? null,
      ],
    );
  });

  response.json(await findingResponse(car.id, findingId));
});

ownerRouter.delete('/cars/:id/findings/:findingId', async (request: Request, response: Response) => {
  const car = await carOf(request);
  const findingId = String(request.params.findingId);
  const expected = requireIfMatch(request);

  await transaction(async (tx) => {
    const current = await tx.queryOne<{ revision: number }>(
      'SELECT revision FROM finding WHERE id = $1 AND car_id = $2 FOR UPDATE',
      [findingId, car.id],
    );
    if (current === null) throw notFound();
    requireCarChanges(car);
    if (current.revision !== expected) {
      throw refuse(412, 'stale_finding', 'This finding has changed', { currentRevision: current.revision });
    }
    await tx.query('DELETE FROM finding WHERE id = $1 AND car_id = $2', [findingId, car.id]);
  });

  response.status(204).end();
});

ownerRouter.post('/cars/:id/uploads', uploadRoute);
ownerRouter.get('/cars/:id/uploads', uploadsListRoute);

ownerRouter.post('/cars/:id/record/pull', async (request: Request, response: Response) => {
  const car = await carOf(request);
  const payload = await pullVehicleRecord(car.registration);
  const pulledAt = new Date();
  await query('INSERT INTO record_pull (id, car_id, pulled_at, first_used_date, payload) VALUES ($1, $2, $3, $4, $5)', [
    randomUUID(),
    car.id,
    pulledAt,
    payload.firstUsedDate,
    JSON.stringify(payload),
  ]);
  const record = await loadWorkingRecord(car.id);
  response.status(201).json(record);
});

ownerRouter.get('/cars/:id/record', async (request: Request, response: Response) => {
  const car = await carOf(request);
  const record = await loadWorkingRecord(car.id);
  if (record === null) throw refuse(404, 'no_record_pull', 'This car has never been pulled');
  response.json(record);
});

ownerRouter.put('/cars/:id/advisories/:advisoryId', async (request: Request, response: Response) => {
  const car = await carOf(request);
  const pull = await loadLatestPull(car.id);
  if (pull === null) throw notFound();

  const wanted = String(request.params.advisoryId);
  const found = pull.payload.motTests
    .flatMap((test) =>
      test.defects
        .filter((defect) => defect.type === 'ADVISORY')
        .map((defect) => ({ test, text: defect.text, id: advisoryId(test.motTestNumber, defect.text) })),
    )
    .find((candidate) => candidate.id === wanted);
  if (found === undefined) throw notFound();

  requireCarChanges(car);

  const body = asRecord(request.body);
  const errors = new FieldErrors();
  const stance = enumField<Stance>(errors, body.stance, 'stance', ['repaired', 'monitoring', 'not_repaired']);
  const note = textField(errors, body.note, 'note', 1, 500);
  errors.throwIfAny();

  if (stance === 'repaired' && textReturnsLater(pull.payload.motTests, found.test, found.text)) {
    throw validationFailure({ stance: ERRORS.recurredFlag });
  }

  await query(
    `INSERT INTO advisory_response (car_id, mot_test_number, advisory_text, stance, note, answered_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (car_id, mot_test_number, advisory_text)
     DO UPDATE SET stance = excluded.stance, note = excluded.note, answered_at = now()`,
    [car.id, found.test.motTestNumber, found.text, stance, note],
  );

  const record = await loadWorkingRecord(car.id);
  const advisory = record?.advisories.find((candidate) => candidate.id === wanted);
  if (advisory === undefined) throw notFound();
  response.json(advisory);
});

ownerRouter.post('/cars/:id/publish', async (request: Request, response: Response) => {
  const car = await carOf(request);
  response.status(201).json(await publishCar(car.id));
});

ownerRouter.post('/cars/:id/withdraw', async (request: Request, response: Response) => {
  const car = await carOf(request);
  const updated = await transaction(async (tx) => {
    const locked = await lockCarRow(tx, car.id);
    if (locked === null) throw notFound();
    if (!isLegalTransition(locked.listing_status, 'withdrawn')) throw illegalTransition();
    const live = await tx.queryOne<{ one: number }>(
      "SELECT 1 AS one FROM offer WHERE car_id = $1 AND status IN ('open','needs_reread') AND lapses_at > now() LIMIT 1",
      [car.id],
    );
    if (live !== null) throw refuse(409, 'offers_open', 'This car still has a live offer');
    await tx.query("UPDATE car SET listing_status = 'withdrawn' WHERE id = $1", [car.id]);
    return true;
  });
  if (!updated) throw illegalTransition();
  const after = await findCarRow(car.id);
  if (after === null) throw notFound();
  response.json(await buildCarDto(after));
});

ownerRouter.post('/cars/:id/complete', async (request: Request, response: Response) => {
  const car = await carOf(request);
  response.status(201).json(await completeSale(car.id));
});

ownerRouter.get('/cars/:id/versions', async (request: Request, response: Response) => {
  const car = await carOf(request);
  const versions = await listVersions(car.id);
  response.json({
    versions: versions.map((row) => ({
      number: row.number,
      publishedAt: row.published_at.toISOString(),
      reportSha256: row.report_sha256,
    })),
  });
});

ownerRouter.get('/cars/:id/versions/:number', async (request: Request, response: Response) => {
  const car = await carOf(request);
  const version = await loadVersion(car.id, Number(request.params.number));
  if (version === null) throw notFound();
  response.json(versionDto(version));
});

const streamStored = async (response: Response, key: string, contentType: string): Promise<void> => {
  let stored;
  try {
    stored = await getObject(key);
  } catch {
    throw refuse(503, 'storage_unavailable', 'The file store is not answering');
  }
  response.setHeader('Content-Type', contentType);
  response.setHeader('Content-Length', String(stored.bytes.length));
  response.end(stored.bytes);
};

ownerRouter.get('/cars/:id/report/:number', async (request: Request, response: Response) => {
  const car = await carOf(request);
  const number = Number(request.params.number);
  const version = await loadVersion(car.id, number);
  if (version === null) throw notFound();
  await streamStored(response, objectKeys.report(car.id, number), 'application/pdf');
});

ownerRouter.get('/cars/:id/handover', async (request: Request, response: Response) => {
  const car = await carOf(request);
  if (car.listing_status !== 'sold') throw refuse(409, 'listing_not_sold', 'This car is not sold');
  await streamStored(response, objectKeys.handover(car.id), 'application/pdf');
});

ownerRouter.post('/cars/:id/links', async (request: Request, response: Response) => {
  const car = await carOf(request);
  if (car.current_version === null) {
    throw refuse(409, 'listing_not_published', 'Publish this car before issuing a link');
  }
  if (car.listing_status !== 'live') {
    throw refuse(409, 'listing_not_published', 'Only a live car can have a new link');
  }
  const body = asRecord(request.body);
  const errors = new FieldErrors();
  const role = enumField(errors, body.role, 'role', ['buyer', 'inspector'] as const);
  const name = textField(errors, body.name, 'name', 1, 80);
  errors.throwIfAny();

  const now = new Date();
  const link = await transaction((tx) => insertLink(tx, car.id, role, name, now));
  response.status(201).json({
    id: link.id,
    role: link.role,
    name: link.name,
    status: 'active',
    expiresAt: link.expires_at.toISOString(),
    secondsRemaining: Math.max(0, Math.floor((link.expires_at.getTime() - now.getTime()) / 1000)),
    token: link.token,
    path: `/l/${link.token}`,
  });
});

ownerRouter.get('/cars/:id/links', async (request: Request, response: Response) => {
  const car = await carOf(request);
  const rows = await listLinks(car.id);
  const now = new Date();
  const links = await Promise.all(rows.map((row) => buildLinkDto(row, car.current_version, now)));
  response.json({ links });
});

const linkAndCar = async (linkId: string): Promise<{ link: Awaited<ReturnType<typeof findLinkById>>; car: CarRow }> => {
  const link = await findLinkById(linkId);
  if (link === null) throw notFound();
  const car = await findCarRow(link.car_id);
  if (car === null) throw notFound();
  return { link, car };
};

ownerRouter.post('/links/:id/revoke', async (request: Request, response: Response) => {
  const { car } = await linkAndCar(String(request.params.id));
  const linkId = String(request.params.id);
  const now = new Date();
  await transaction(async (tx) => {
    const row = await tx.queryOne<{ revoked_at: Date | null; expires_at: Date; role: string }>(
      'SELECT revoked_at, expires_at, role FROM named_link WHERE id = $1 FOR UPDATE',
      [linkId],
    );
    if (row === null) throw notFound();
    if (row.revoked_at !== null || now.getTime() >= row.expires_at.getTime()) {
      throw refuse(409, 'link_already_ended', 'This link has already ended');
    }
    await tx.query('UPDATE named_link SET revoked_at = now() WHERE id = $1', [linkId]);
    await tx.query('UPDATE viewing_slot SET holder_link_id = NULL WHERE holder_link_id = $1', [linkId]);
  });
  const after = await findLinkById(linkId);
  if (after === null) throw notFound();
  response.json(await buildLinkDto(after, car.current_version, new Date()));
});

ownerRouter.post('/links/:id/renew', async (request: Request, response: Response) => {
  const { car } = await linkAndCar(String(request.params.id));
  const linkId = String(request.params.id);
  await transaction(async (tx) => {
    const row = await tx.queryOne<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM named_link WHERE id = $1 FOR UPDATE',
      [linkId],
    );
    if (row === null) throw notFound();
    if (row.revoked_at !== null) throw refuse(409, 'link_revoked', 'A revoked link cannot be renewed');
    await tx.query('UPDATE named_link SET expires_at = $2 WHERE id = $1', [linkId, expiryFromNow(new Date())]);
  });
  const after = await findLinkById(linkId);
  if (after === null) throw notFound();
  response.json(await buildLinkDto(after, car.current_version, new Date()));
});

ownerRouter.post('/links/:id/replace', async (request: Request, response: Response) => {
  const { car } = await linkAndCar(String(request.params.id));
  const linkId = String(request.params.id);
  const token = newToken();
  await transaction(async (tx) => {
    const row = await tx.queryOne<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM named_link WHERE id = $1 FOR UPDATE',
      [linkId],
    );
    if (row === null) throw notFound();
    if (row.revoked_at !== null) throw refuse(409, 'link_revoked', 'A revoked link cannot be replaced');
    await tx.query('UPDATE named_link SET token = $2, expires_at = $3 WHERE id = $1', [
      linkId,
      token,
      expiryFromNow(new Date()),
    ]);
  });
  const after = await findLinkById(linkId);
  if (after === null) throw notFound();
  const dto = await buildLinkDto(after, car.current_version, new Date());
  response.json({ ...dto, token, path: `/l/${token}` });
});

const ownerSlotDto = (row: {
  id: string;
  local_start: string;
  starts_at: Date;
  duration_minutes: number;
  holder_link_id: string | null;
  holder_name: string | null;
}) => ({
  id: row.id,
  localStart: row.local_start,
  zone: londonZoneOf(row.starts_at),
  startsAt: row.starts_at.toISOString(),
  durationMinutes: row.duration_minutes,
  label: formatSlotLabel(row.starts_at),
  held: row.holder_link_id !== null,
  heldByYou: false,
  holderName: row.holder_name,
});

const slotRows = (carId: string) =>
  query<{
    id: string;
    local_start: string;
    starts_at: Date;
    duration_minutes: number;
    holder_link_id: string | null;
    holder_name: string | null;
  }>(
    `SELECT s.id, s.local_start, s.starts_at, s.duration_minutes, s.holder_link_id, l.name AS holder_name
     FROM viewing_slot s LEFT JOIN named_link l ON l.id = s.holder_link_id
     WHERE s.car_id = $1 ORDER BY s.starts_at ASC`,
    [carId],
  );

ownerRouter.get('/cars/:id/slots', async (request: Request, response: Response) => {
  const car = await carOf(request);
  response.json({ slots: (await slotRows(car.id)).map(ownerSlotDto) });
});

ownerRouter.post('/cars/:id/slots', async (request: Request, response: Response) => {
  const car = await carOf(request);
  requireCarChanges(car);
  const body = asRecord(request.body);
  const errors = new FieldErrors();
  const durationMinutes = integerField(errors, body.durationMinutes, 'durationMinutes', 15, 240);
  const localStart = typeof body.localStart === 'string' ? body.localStart : '';
  const resolved = resolveLondonLocalStart(localStart);
  if (resolved.problem === 'malformed') errors.add('localStart', 'Enter a date and time as YYYY-MM-DDTHH:mm');
  if (resolved.problem === 'does_not_exist') errors.add('localStart', ERRORS.timeDoesNotExist);
  if (resolved.startsAt !== null && resolved.startsAt.getTime() <= Date.now()) {
    errors.add('localStart', ERRORS.timeInPast);
  }
  errors.throwIfAny();
  if (resolved.startsAt === null) throw new Error('The slot start could not be resolved');

  const id = randomUUID();
  await query(
    'INSERT INTO viewing_slot (id, car_id, local_start, starts_at, duration_minutes) VALUES ($1, $2, $3, $4, $5)',
    [id, car.id, localStart, resolved.startsAt, durationMinutes],
  );
  const rows = await slotRows(car.id);
  const created = rows.find((row) => row.id === id);
  if (created === undefined) throw notFound();
  response.status(201).json(ownerSlotDto(created));
});

ownerRouter.delete('/cars/:id/slots/:slotId', async (request: Request, response: Response) => {
  const car = await carOf(request);
  const slotId = String(request.params.slotId);
  await transaction(async (tx) => {
    const row = await tx.queryOne<{ holder_link_id: string | null }>(
      'SELECT holder_link_id FROM viewing_slot WHERE id = $1 AND car_id = $2 FOR UPDATE',
      [slotId, car.id],
    );
    if (row === null) throw notFound();
    if (row.holder_link_id !== null) throw refuse(409, 'slot_held', 'A buyer is holding that slot');
    await tx.query('DELETE FROM viewing_slot WHERE id = $1', [slotId]);
  });
  response.status(204).end();
});

ownerRouter.get('/cars/:id/offers', async (request: Request, response: Response) => {
  const car = await carOf(request);
  response.json({ offers: await listOwnerOffers(car.id, car.current_version) });
});

ownerRouter.post('/offers/:id/accept', async (request: Request, response: Response) => {
  const offerId = String(request.params.id);
  const key = requireIdempotencyKey(
    typeof request.headers['idempotency-key'] === 'string' ? request.headers['idempotency-key'] : undefined,
  );
  const result = await acceptOffer(offerId, key);
  response.status(result.status).json(result.response);
});

ownerRouter.post('/offers/:id/decline', async (request: Request, response: Response) => {
  response.json(await declineOffer(String(request.params.id)));
});

ownerRouter.get('/alerts', async (_request: Request, response: Response) => {
  response.json({ alerts: (await listAlerts()).map(alertDto) });
});

ownerRouter.post('/alerts/:id/retry', async (request: Request, response: Response) => {
  response.json(alertDto(await retryAlert(String(request.params.id))));
});

ownerRouter.get('/uploads/:id/original', async (request: Request, response: Response) => {
  const upload = await queryOne<{ id: string; car_id: string; content_type: string; file_name: string }>(
    'SELECT id, car_id, content_type, file_name FROM upload WHERE id = $1',
    [String(request.params.id)],
  );
  if (upload === null) throw notFound();
  let stored;
  try {
    stored = await getObject(objectKeys.original(upload.car_id, upload.id));
  } catch {
    throw refuse(503, 'storage_unavailable', 'The file store is not answering');
  }
  response.setHeader('Content-Type', upload.content_type);
  response.setHeader('Content-Length', String(stored.bytes.length));
  response.end(stored.bytes);
});

ownerRouter.get('/uploads/:id/derivative', async (request: Request, response: Response) => {
  const upload = await queryOne<{ id: string; car_id: string; kind: string }>(
    'SELECT id, car_id, kind FROM upload WHERE id = $1',
    [String(request.params.id)],
  );
  if (upload === null || upload.kind !== 'photo') throw notFound();
  await streamStored(response, objectKeys.derivative(upload.car_id, upload.id), 'image/jpeg');
});
