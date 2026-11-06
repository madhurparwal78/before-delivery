import { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, errors } from './errors.js';
import { Store } from './store.js';
import type { StaffRow, PlacementRow, EventRow, ObjectRow, PhotoRow, WallRow, PreviewRow } from './store.js';
import type { AppConfig } from './config.js';
import { Services } from './services.js';
import {
  checkHangRules, hangRejectionMessage, mayMovePlacement, canTransition,
  canPreviewTransition, undoWindow, remainingMs, UNDO_WINDOW_MS,
} from './rules.js';
import type { HangCheckResult } from './rules.js';
import { unitToMm, type Unit } from './units.js';
import { display, isoWithZone, openHours, parseDateParts, zonedTime } from './dates.js';
import { isIdempotencyKey, randomId, sha256Hex, linkToken as generateToken } from './util.js';
import type { DbClient } from './db.js';
import { queueWithdrawalMail } from './publisher.js';

export interface Body {
  [key: string]: unknown;
}

const JSON_BODY_LIMIT = 65_536;
const PHOTO_BODY_LIMIT = 10_000_000;

export class Api {
  constructor(
    private readonly cfg: AppConfig,
    private readonly store: Store,
    private readonly services: Services,
    private readonly timeZone: string,
    private readonly openHoursValue: number
  ) {}

  async handle(req: IncomingMessage, res: ServerResponse, path: string, url: URL): Promise<boolean> {
    try {
      return await this.route(req, res, path, url);
    } catch (e) {
      if (e instanceof ApiError) {
        this.writeJson(res, e.status, e.body());
        const oversized = e as ApiError & { request?: IncomingMessage };
        if (oversized.request !== undefined) {
          setImmediate(() => oversized.request?.destroy());
        }
        return true;
      }
      throw e;
    }
  }

  private async route(
    req: IncomingMessage, res: ServerResponse, path: string, url: URL
  ): Promise<boolean> {
    const method = req.method ?? 'GET';

    if (path === '/api/health' && method === 'GET') {
      this.writeJson(res, 200, { status: 'ok' });
      return true;
    }
    if (path === '/api/status' && method === 'GET') {
      const status = await this.services.current();
      this.writeJson(res, 200, status);
      return true;
    }
    if (path === '/api/staff' && method === 'GET') {
      const staff = await this.guardDatabase(() => this.store.staff());
      this.writeJson(res, 200, { staff });
      return true;
    }

    // Lender capability links: read-only, no staff identity. Only /api/p/... is
    // the JSON snapshot route; /p/... is the HTML page served by main.
    if (path.startsWith('/api/p/')) {
      return await this.handleLender(req, res, path, url, method);
    }

    if (!path.startsWith('/api/')) return false;

    // Photo uploads carry raw image bodies; match them before reading JSON.
    const photoMatch = /^\/api\/objects\/([^/]+)\/photos\/?$/i.exec(path);
    if (photoMatch && method === 'POST') {
      const staff = await this.requireStaff(req);
      return await this.uploadPhoto(req, res, photoMatch[1]!, '', staff);
    }

    const staff = await this.requireStaff(req);
    const body = await this.readJsonBody(req);

    if (path === '/api/exhibition' && method === 'GET') return await this.exhibition(res);
    if (path === '/api/events' && method === 'GET') return await this.events(res, url, staff);
    if (path === '/api/objects' && method === 'GET') return await this.listObjects(res, url, staff);
    if (path === '/api/objects' && method === 'POST') return await this.createObject(req, res, body, staff);
    if (path === '/api/placements' && method === 'GET') return await this.listPlacements(res);
    if (path === '/api/placements' && method === 'POST') return await this.createPlacement(req, res, body, staff);
    if (path === '/api/preview' && method === 'GET') return await this.getPreview(res);

    const match = /^\/api\/(objects|placements|walls|preview|undo)(\/.*)?$/.exec(path);
    if (!match) throw errors.notFound('No such API route.');
    const kind = match[1]!;
    const rest = match[2] ?? '';

    if (kind === 'walls' && method === 'PATCH') return await this.patchWall(res, rest, body, staff);
    if (kind === 'objects') {
      if (rest.startsWith('/') && rest.split('/').length === 2 && method === 'GET') {
        return await this.getObject(res, rest.slice(1));
      }
      if (rest.startsWith('/') && rest.split('/').length === 2 && method === 'PATCH') {
        return await this.patchObject(res, rest.slice(1), body, staff);
      }
      if (rest.split('/').length === 4) {
        const parts = rest.split('/');
        if (method === 'GET') return await this.getPhoto(res, parts[1]!, parts[3]!);
      }
    }
    if (kind === 'placements' && rest.startsWith('/') && rest.includes('/')) {
      const parts = rest.split('/');
      if (parts.length === 2 && method === 'PATCH') return await this.patchPlacement(res, parts[1]!, body, staff);
      if (parts.length === 2 && method === 'DELETE') return await this.deletePlacement(res, parts[1]!, staff);
      if (parts.length === 3 && method === 'POST') {
        switch (parts[2]) {
          case 'claim': return await this.claim(res, parts[1]!, staff);
          case 'release': return await this.release(res, parts[1]!, staff);
          case 'hang': return await this.hang(res, parts[1]!, staff);
          case 'sign-off': return await this.signOff(res, parts[1]!, staff);
        }
      }
    }
    if (kind === 'undo' && rest.startsWith('/') && method === 'POST') {
      return await this.undo(res, rest.slice(1), staff);
    }
    if (kind === 'preview') {
      if (rest === '/schedule' && method === 'POST') return await this.schedulePreview(res, body, staff);
      if (rest === '/cancel' && method === 'POST') return await this.cancelPreview(res, staff);
      if (rest === '/withdraw' && method === 'POST') return await this.withdrawPreview(res, staff);
    }

    throw errors.notFound('No such API route.');
  }

  // ---------- identity ----------

  private async requireStaff(req: IncomingMessage): Promise<StaffRow> {
    const id = req.headers['x-staff-id'];
    const staffId = Array.isArray(id) ? id[0] : id;
    if (staffId === undefined) throw errors.unknownStaff();
    const staff = await this.guardDatabase(() => this.store.staffById(staffId));
    if (staff === null) throw errors.unknownStaff();
    return staff;
  }

  private async guardDatabase<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw errors.databaseUnavailable();
    }
  }

  // ---------- body reading ----------

  private async readJsonBody(req: IncomingMessage): Promise<Body | undefined> {
    if (req.method === 'GET' || req.method === 'DELETE') return undefined;
    const raw = await this.readRawBody(req, JSON_BODY_LIMIT);
    if (raw.length === 0) return undefined;
    try {
      return JSON.parse(raw.toString('utf8')) as Body;
    } catch {
      throw errors.validationFailed({});
    }
  }

  private readRawBody(req: IncomingMessage, limit: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let done = false;
      req.on('data', (chunk: Buffer) => {
        if (done) return;
        size += chunk.length;
        if (size > limit) {
          done = true;
          const error = errors.bodyTooLarge();
          (error as ApiError & { request?: IncomingMessage }).request = req;
          req.removeAllListeners('data');
          req.removeAllListeners('end');
          req.pause();
          reject(error);
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (!done) resolve(Buffer.concat(chunks));
      });
      req.on('error', (e) => {
        if (!done) reject(e);
      });
    });
  }

  // ---------- idempotency ----------

  private async withIdempotency<T extends object>(
    req: IncomingMessage,
    res: ServerResponse,
    staff: StaffRow,
    route: string,
    fingerprint: string,
    produce: () => Promise<{ status: number; body: T }>
  ): Promise<void> {
    const rawKey = req.headers['idempotency-key'];
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (key === undefined) {
      const result = await produce();
      this.writeJson(res, result.status, result.body);
      return;
    }
    if (!isIdempotencyKey(key)) throw errors.validationFailed({ idempotencyKey: 'Choose a key of 1 to 64 letters, digits, - or _.' });
    const existing = await this.store.query(
      'SELECT status, body, request_fingerprint FROM idempotency WHERE staff_id = $1 AND route = $2 AND key = $3',
      [staff.id, route, key]
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0] as unknown as { status: number; body: string; request_fingerprint: string };
      if (row.request_fingerprint !== fingerprint) {
        throw new ApiError(409, 'idempotency_conflict', 'That idempotency key was used for a different request.');
      }
      this.writeJson(res, row.status, JSON.parse(row.body) as T);
      return;
    }
    const result = await produce();
    await this.store.query(
      `INSERT INTO idempotency (staff_id, route, key, status, body, request_fingerprint)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (staff_id, route, key) DO NOTHING`,
      [staff.id, route, key, result.status, JSON.stringify(result.body), fingerprint]
    );
    this.writeJson(res, result.status, result.body);
  }

  // ---------- GET routes ----------

  private async exhibition(res: ServerResponse): Promise<boolean> {
    const [exhibition, gallery, walls, lenders] = await this.guardDatabase(async () =>
      Promise.all([this.store.exhibition(), this.store.gallery(), this.store.walls(), this.store.lenders()])
    );
    this.writeJson(res, 200, {
      exhibition: {
        id: exhibition.id,
        title: exhibition.title,
        museum: exhibition.museum,
        timeZone: exhibition.timeZone,
        runStart: exhibition.runStart,
        runEnd: exhibition.runEnd,
        openHoursPerDay: exhibition.openHoursPerDay,
        closedWeekdays: exhibition.closedWeekdays,
        openHours: this.openHoursValue,
      },
      gallery: { id: gallery.id, name: gallery.name, walls },
      lenders,
    });
    return true;
  }

  private async events(res: ServerResponse, url: URL, _staff: StaffRow): Promise<boolean> {
    const afterParam = url.searchParams.get('after');
    let after = 0;
    if (afterParam !== null) {
      if (!/^\d+$/.test(afterParam) || Number(afterParam) < 0) {
        throw errors.validationFailed({ after: 'Enter a whole number of 0 or more.' });
      }
      after = Number(afterParam);
    }
    const events = afterParam === null
      ? []
      : await this.guardDatabase(() => this.store.events(after, 200));
    const latestSeq = await this.guardDatabase(() => this.store.latestSeq());
    this.writeJson(res, 200, { events, latestSeq });
    return true;
  }

  private async listObjects(res: ServerResponse, url: URL, _staff: StaffRow): Promise<boolean> {
    const fields: Record<string, string> = {};
    const q = url.searchParams.get('q');
    if (q !== null && q.length > 100) fields['q'] = 'Keep the search to 100 characters or fewer.';
    const lender = url.searchParams.get('lender');
    if (lender !== null && lender !== '' && lender !== 'collection') {
      const known = await this.store.lenderById(lender);
      if (known === null) fields['lender'] = 'Choose a lender, the collection, or all lenders.';
    }
    const sort = url.searchParams.get('sort') ?? 'number';
    if (!['number', 'title', 'lender', 'lux'].includes(sort)) {
      fields['sort'] = 'Sort by object number, title, lender or lux limit.';
    }
    const dir = url.searchParams.get('dir') ?? 'asc';
    if (!['asc', 'desc'].includes(dir)) {
      fields['dir'] = 'Choose ascending or descending.';
    }
    if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);
    const objects = await this.guardDatabase(async () => {
      const rows = await this.store.objects({
        q: q ?? undefined,
        lender: lender ?? undefined,
        sort: sort as 'number' | 'title' | 'lender' | 'lux',
        dir: dir as 'asc' | 'desc',
      });
      const detailed = await Promise.all(rows.map(async (o) => this.objectWithPlacement(o)));
      return detailed;
    });
    this.writeJson(res, 200, { objects });
    return true;
  }

  private async getObject(res: ServerResponse, id: string): Promise<boolean> {
    const object = await this.guardDatabase(() => this.store.objectById(id));
    if (object === null) throw errors.notFound('No such object.');
    this.writeJson(res, 200, { object: await this.objectWithPlacement(object) });
    return true;
  }

  private async objectWithPlacement(o: ObjectRow) {
    const [photos, placement] = await Promise.all([
      this.store.photosFor(o.id),
      this.store.activePlacementFor(o.id),
    ]);
    return {
      id: o.id,
      objectNumber: o.objectNumber,
      title: o.title,
      medium: o.medium,
      lenderId: o.lenderId,
      lenderName: o.lenderId === null ? 'Ashgrove collection' : o.lenderName,
      widthMm: o.widthMm,
      heightMm: o.heightMm,
      luxLimit: o.luxLimit,
      luxHourBudget: o.luxHourBudget,
      insuranceValueGbp: o.insuranceValueGbp,
      registrarNote: o.registrarNote,
      conditionRecorded: photos.length > 0,
      photos: photos.map(toPhotoJson),
      placementId: placement?.id ?? null,
      placementStatus: placement?.status ?? null,
    };
  }

  // ---------- objects ----------

  private validateObjectFields(
    body: Body,
    existing: ObjectRow | null,
    partial: boolean
  ): { fields: Record<string, string>; values: Partial<ObjectRow> } {
    const fields: Record<string, string> = {};
    const values: Partial<ObjectRow> = {};

    const str = (key: string): string | undefined =>
      key in body ? String((body as Body)[key] ?? '') : undefined;
    const num = (key: string): number | undefined => {
      if (!(key in body)) return undefined;
      const raw = (body as Body)[key];
      const parsed = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(parsed) ? parsed : NaN;
    };

    const title = str('title');
    if (title !== undefined) {
      if (title.trim() === '') fields['title'] = 'Enter a title.';
      else values.title = title.trim();
    } else if (!partial) {
      fields['title'] = 'Enter a title.';
    }

    const objectNumber = str('objectNumber');
    if (objectNumber !== undefined) {
      if (objectNumber.trim() === '') fields['objectNumber'] = 'Enter an object number.';
      else values.objectNumber = objectNumber.trim();
    } else if (!partial) {
      fields['objectNumber'] = 'Enter an object number.';
    }

    const lenderIdRaw = body['lenderId'];
    if ('lenderId' in body) {
      if (lenderIdRaw === null || lenderIdRaw === '') {
        values.lenderId = null;
      } else if (typeof lenderIdRaw === 'string') {
        values.lenderId = lenderIdRaw;
      } else {
        fields['lenderId'] = 'Choose a lender or the Ashgrove collection.';
      }
    } else if (!partial) {
      fields['lenderId'] = 'Choose a lender or the Ashgrove collection.';
    }

    const medium = str('medium');
    if (medium !== undefined) {
      if (medium.length > 120) fields['medium'] = 'Keep the medium to 120 characters or fewer.';
      else values.medium = medium;
    } else if (!partial) {
      values.medium = '';
    }

    const unit = str('unit');
    const hasSize = 'width' in body || 'height' in body;
    let unitValue: Unit | null = null;
    if (unit !== undefined) {
      if (unit !== 'cm' && unit !== 'in') fields['unit'] = 'Choose cm or in.';
      else unitValue = unit;
    } else if (hasSize) {
      fields['unit'] = 'Choose cm or in.';
    }

    if (hasSize && unitValue !== null) {
      const width = num('width');
      const height = num('height');
      const decimals = unitValue === 'cm' ? 1 : 2;
      for (const [value, key] of [
        [width, 'width'],
        [height, 'height'],
      ] as const) {
        if (value === undefined || !Number.isFinite(value) || value <= 0) {
          fields[key] = `Enter a ${key} above 0 and up to 20 metres, with at most 1 decimal in cm or 2 in inches.`;
          continue;
        }
        const text = String((body as Body)[key] ?? '');
        const [, decimalsPart = ''] = text.split('.');
        if (decimalsPart.length > decimals) {
          fields[key] = `Enter a ${key} above 0 and up to 20 metres, with at most 1 decimal in cm or 2 in inches.`;
          continue;
        }
        const mm = unitToMm(value, unitValue);
        if (mm < 1 || mm > 20_000) {
          fields[key] = `Enter a ${key} above 0 and up to 20 metres, with at most 1 decimal in cm or 2 in inches.`;
        } else {
          (values as Record<string, number>)[key === 'width' ? 'widthMm' : 'heightMm'] = mm;
        }
      }
    } else if (!partial && !(('width' in body) && ('height' in body))) {
      fields['width'] = 'Enter a width above 0 and up to 20 metres, with at most 1 decimal in cm or 2 in inches.';
      fields['height'] = 'Enter a height above 0 and up to 20 metres, with at most 1 decimal in cm or 2 in inches.';
    }

    const luxLimit = num('luxLimit');
    if ('luxLimit' in body) {
      if (luxLimit === undefined || !Number.isInteger(luxLimit) || luxLimit < 1 || luxLimit > 1000) {
        fields['luxLimit'] = 'Enter a lux limit from 1 to 1000.';
      } else {
        values.luxLimit = luxLimit;
      }
    } else if (!partial) {
      fields['luxLimit'] = 'Enter a lux limit from 1 to 1000.';
    }

    const luxHourBudget = num('luxHourBudget');
    if ('luxHourBudget' in body) {
      if (luxHourBudget === undefined || !Number.isInteger(luxHourBudget) || luxHourBudget < 1 || luxHourBudget > 10_000_000) {
        fields['luxHourBudget'] = 'Enter a lux-hour budget from 1 to 10,000,000.';
      } else {
        values.luxHourBudget = luxHourBudget;
      }
    } else if (!partial) {
      fields['luxHourBudget'] = 'Enter a lux-hour budget from 1 to 10,000,000.';
    }

    const insurance = num('insuranceValueGbp');
    if ('insuranceValueGbp' in body) {
      if (insurance === undefined || !Number.isInteger(insurance) || insurance < 0) {
        fields['insuranceValueGbp'] = 'Enter an insurance value in whole pounds.';
      } else {
        values.insuranceValueGbp = insurance;
      }
    } else if (!partial) {
      fields['insuranceValueGbp'] = 'Enter an insurance value in whole pounds.';
    }

    const note = str('registrarNote');
    if (note !== undefined) {
      if (note.length > 2000) fields['registrarNote'] = 'Keep the note to 2000 characters or fewer.';
      else values.registrarNote = note;
    } else if (!partial) {
      values.registrarNote = '';
    }

    void existing;
    return { fields, values };
  }

  private async createObject(
    req: IncomingMessage, res: ServerResponse, body: Body | undefined, staff: StaffRow
  ): Promise<boolean> {
    if (staff.role !== 'registrar') throw errors.forbidden('Only registrars register objects.');
    const payload = body ?? {};
    const { fields, values } = this.validateObjectFields(payload, null, false);
    if (values.lenderId !== undefined && values.lenderId !== null) {
      const lender = await this.store.lenderById(values.lenderId);
      if (lender === null) fields['lenderId'] = 'Choose a lender or the Ashgrove collection.';
    }
    if (values.objectNumber !== undefined) {
      const dupe = await this.store.objectByNumber(values.objectNumber);
      if (dupe !== null) fields['objectNumber'] = 'That object number is already in use.';
    }
    if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

    const id = randomId('obj');
    await this.withIdempotency(req, res, staff, 'POST /api/objects', fingerprintOf(payload), async () => {
      const created = await this.store.transaction(async (client) => {
        await client.query(
          `INSERT INTO objects (id, object_number, title, medium, lender_id, width_mm, height_mm,
             lux_limit, lux_hour_budget, insurance_value_gbp, registrar_note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [id, values.objectNumber, values.title, values.medium, values.lenderId,
           values.widthMm, values.heightMm, values.luxLimit, values.luxHourBudget,
           values.insuranceValueGbp, values.registrarNote]
        );
        const object = await this.store.objectById(id, client);
        if (object === null) throw errors.notFound('No such object.');
        const seq = await writeEvent(client, {
          kind: 'object.created', actor: staff, objectId: id, title: object.title,
        });
        return { object: await this.objectWithPlacement(object), seq };
      });
      return { status: 201, body: created };
    });
    return true;
  }

  private async patchObject(
    res: ServerResponse, id: string, body: Body | undefined, staff: StaffRow
  ): Promise<boolean> {
    if (staff.role !== 'registrar') throw errors.forbidden('Only registrars edit objects.');
    const object = await this.guardDatabase(() => this.store.objectById(id));
    if (object === null) throw errors.notFound('No such object.');
    const payload = body ?? {};
    const { fields, values } = this.validateObjectFields(payload, object, true);
    if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);
    if (values.objectNumber !== undefined && values.objectNumber !== object.objectNumber) {
      const dupe = await this.store.objectByNumber(values.objectNumber);
      if (dupe !== null) throw errors.validationFailed({ objectNumber: 'That object number is already in use.' });
    }
    const placement = await this.store.activePlacementFor(id);
    const changesSize = values.widthMm !== undefined || values.heightMm !== undefined;
    if (placement !== null && changesSize) {
      throw new ApiError(409, 'object_placed', "You can't change the dimensions while the work is placed.");
    }
    const updated = await this.store.transaction(async (client) => {
      await client.query(
        `UPDATE objects SET
           object_number = COALESCE($2, object_number),
           title = COALESCE($3, title),
           medium = COALESCE($4, medium),
           lender_id = COALESCE($5, lender_id),
           width_mm = COALESCE($6, width_mm),
           height_mm = COALESCE($7, height_mm),
           lux_limit = COALESCE($8, lux_limit),
           lux_hour_budget = COALESCE($9, lux_hour_budget),
           insurance_value_gbp = COALESCE($10, insurance_value_gbp),
           registrar_note = COALESCE($11, registrar_note)
         WHERE id = $1`,
        [id, values.objectNumber, values.title, values.medium, values.lenderId,
         values.widthMm, values.heightMm, values.luxLimit, values.luxHourBudget,
         values.insuranceValueGbp, values.registrarNote]
      );
      const after = await this.store.objectById(id, client);
      if (after === null) throw errors.notFound('No such object.');
      const seq = await writeEvent(client, {
        kind: 'object.updated', actor: staff, objectId: id, title: after.title,
      });
      return {
        object: await this.objectWithPlacement(after),
        placements: placement ? [toPlacementJson(placement)] : [],
        seq,
      };
    });
    this.writeJson(res, 200, updated);
    return true;
  }

  // ---------- photos ----------

  private async uploadPhoto(
    req: IncomingMessage, res: ServerResponse, objectId: string, _photoRoute: string, staff: StaffRow
  ): Promise<boolean> {
    if (staff.role !== 'registrar') throw errors.forbidden('Only registrars attach condition photos.');
    const object = await this.guardDatabase(() => this.store.objectById(objectId));
    if (object === null) throw errors.notFound('No such object.');

    const contentTypeHeader = req.headers['content-type'];
    const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader;
    if (contentType !== 'image/jpeg' && contentType !== 'image/png') {
      throw errors.unsupportedMediaType();
    }
    const raw = await this.readRawBody(req, PHOTO_BODY_LIMIT);
    if (raw.length === 0) throw errors.validationFailed({ body: 'Attach a JPEG or PNG photo.' });

    const photoId = randomId('photo');
    const key = `condition/${objectId}/${photoId}.${contentType === 'image/png' ? 'png' : 'jpg'}`;
    const fingerprint = `photo:${contentType}:${sha256Hex(raw)}`;

    await this.withIdempotency(req, res, staff, `POST /api/objects/${objectId}/photos`, fingerprint, async () => {
      const s3 = this.services.imageStore();
      try {
        await s3.put(key, raw, contentType);
      } catch {
        throw errors.imageStoreUnavailable();
      }
      const stored = await this.store.transaction(async (client) => {
        await client.query(
          `INSERT INTO photos (id, object_id, key, bytes, sha256, content_type)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [photoId, objectId, key, raw.length, sha256Hex(raw), contentType]
        );
        const seq = await writeEvent(client, {
          kind: 'photo.attached', actor: staff, objectId, title: object.title,
        });
        return { photo: toPhotoJson({
          id: photoId, objectId, key, bytes: raw.length, sha256: sha256Hex(raw),
          contentType, attachedAt: new Date().toISOString(),
        }), seq };
      });
      return { status: 201, body: stored };
    });
    return true;
  }

  private async getPhoto(res: ServerResponse, objectId: string, photoId: string): Promise<boolean> {
    const photo = await this.guardDatabase(() => this.store.photoById(objectId, photoId));
    if (photo === null) throw errors.notFound('No such photo.');
    let data: Buffer;
    try {
      const stored = await this.services.imageStore().get(photo.key);
      if (stored === null) throw errors.notFound('No such photo.');
      data = stored.data;
    } catch {
      throw errors.imageStoreUnavailable();
    }
    res.writeHead(200, {
      'content-type': photo.contentType,
      'content-length': String(data.length),
      'cache-control': 'private, max-age=3600',
    });
    res.end(data);
    return true;
  }

  // ---------- placements ----------

  private async listPlacements(res: ServerResponse): Promise<boolean> {
    const [placements, overBudgetCount] = await this.guardDatabase(async () =>
      Promise.all([this.store.placements(), this.store.overBudgetCount()])
    );
    this.writeJson(res, 200, {
      placements: placements.map(toPlacementJson),
      overBudgetCount,
    });
    return true;
  }

  private async createPlacement(
    req: IncomingMessage, res: ServerResponse, body: Body | undefined, staff: StaffRow
  ): Promise<boolean> {
    if (staff.role !== 'curator') throw errors.forbidden('Only curators place works.');
    const payload = body ?? {};
    const objectId = typeof payload['objectId'] === 'string' ? payload['objectId'] : '';
    const wallId = typeof payload['wallId'] === 'string' ? payload['wallId'] : '';
    const offsetMm = intField(payload['offsetMm']);
    const centreHeightMm = intField(payload['centreHeightMm']);
    const heightOverride = payload['heightOverride'] === true;
    const fields: Record<string, string> = {};
    if (offsetMm === null) fields['offsetMm'] = 'Enter a whole number of millimetres.';
    if (centreHeightMm === null) fields['centreHeightMm'] = 'Enter a whole number of millimetres.';
    if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

    const object = await this.guardDatabase(() => this.store.objectById(objectId));
    if (object === null) throw errors.notFound('No such object.');
    const wall = await this.guardDatabase(() => this.store.wallById(wallId));
    if (wall === null) throw errors.notFound('No such wall.');
    const existing = await this.store.activePlacementFor(objectId);
    if (existing !== null) throw new ApiError(409, 'already_placed', 'This work already has a placement.');

    const neighbours = (await this.store.placementsOnWall(wallId))
      .filter((p) => p.objectId !== objectId)
      .map((p) => ({ placementId: p.id, offsetMm: p.offsetMm, widthMm: p.widthMm, title: p.objectTitle }));
    const check = checkHangRules(
      { widthMm: object.widthMm, heightMm: object.heightMm, wallId, offsetMm: offsetMm ?? 0,
        centreHeightMm: centreHeightMm ?? 0, heightOverride },
      wall, neighbours, object.luxLimit, wall.plannedLux
    );
    if (check.reason !== null) throw this.hangRejected(check, wall, object.luxLimit, wall.plannedLux);

    const id = randomId('pl');
    const fingerprint = JSON.stringify([objectId, wallId, offsetMm, centreHeightMm, heightOverride]);
    await this.withIdempotency(req, res, staff, 'POST /api/placements', fingerprint, async () => {
      const created = await this.store.transaction(async (client) => {
        await client.query(
          `INSERT INTO placements (id, object_id, wall_id, offset_mm, centre_height_mm, height_override, status, version)
           VALUES ($1,$2,$3,$4,$5,$6,'proposed',1)`,
          [id, objectId, wallId, offsetMm ?? 0, centreHeightMm ?? 0, heightOverride]
        );
        const seq = await writeEvent(client, {
          kind: 'placement.placed', actor: staff, placementId: id, objectId,
          wallId, title: object.title, wallName: wall.name, offsetMm: offsetMm ?? 0,
        });
        const placement = await this.store.placementById(id, client);
        if (placement === null) throw errors.notFound('No such placement.');
        return { placement: toPlacementJson(placement), seq };
      });
      return { status: 201, body: created };
    });
    return true;
  }

  private hangRejected(
    check: HangCheckResult, wall: WallRow, luxLimit: number, plannedLux: number
  ): ApiError {
    const message = hangRejectionMessage(check.reason ?? 'off_wall', {
      wallName: wall.name, plannedLux, luxLimit, neighbourTitle: check.neighbourTitle,
    });
    return errors.placementRejected(check.reason ?? 'off_wall', message);
  }

  private async patchPlacement(
    res: ServerResponse, id: string, body: Body | undefined, staff: StaffRow
  ): Promise<boolean> {
    const payload = body ?? {};
    const version = intField(payload['version']);
    if (version === null) {
      throw errors.validationFailed({ version: 'Send the placement version you are changing.' });
    }
    void version;
    const placement = await this.guardDatabase(() => this.store.placementById(id));
    if (placement === null) throw errors.notFound('No such placement.');

    const wantsWallChange = typeof payload['wallId'] === 'string' && payload['wallId'] !== placement.wallId;
    const moveError = mayMovePlacement(staff, placement, wantsWallChange);
    if (moveError !== null) throw moveError;

    const newWallId = wantsWallChange ? String(payload['wallId']) : placement.wallId;
    const wall = await this.guardDatabase(() => this.store.wallById(newWallId));
    if (wall === null) throw errors.notFound('No such wall.');
    const offsetMm = payload['offsetMm'] !== undefined ? intField(payload['offsetMm']) : placement.offsetMm;
    const centreHeightMm = payload['centreHeightMm'] !== undefined ? intField(payload['centreHeightMm']) : placement.centreHeightMm;
    const heightOverride = payload['heightOverride'] !== undefined
      ? payload['heightOverride'] === true
      : placement.heightOverride;
    if (offsetMm === null || centreHeightMm === null) {
      throw errors.validationFailed({
        ...(offsetMm === null ? { offsetMm: 'Enter a whole number of millimetres.' } : {}),
        ...(centreHeightMm === null ? { centreHeightMm: 'Enter a whole number of millimetres.' } : {}),
      });
    }

    const object = await this.store.objectById(placement.objectId);
    if (object === null) throw errors.notFound('No such object.');
    const neighbours = (await this.store.placementsOnWall(newWallId))
      .filter((p) => p.id !== id)
      .map((p) => ({ placementId: p.id, offsetMm: p.offsetMm, widthMm: p.widthMm, title: p.objectTitle }));
    const check = checkHangRules(
      { widthMm: object.widthMm, heightMm: object.heightMm, wallId: newWallId,
        offsetMm, centreHeightMm, heightOverride },
      wall, neighbours, object.luxLimit, wall.plannedLux
    );
    if (check.reason !== null) throw this.hangRejected(check, wall, object.luxLimit, wall.plannedLux);

    const result = await this.store.transaction(async (client) => {
      const locked = await client.query(
        'SELECT version FROM placements WHERE id = $1 FOR UPDATE', [id]
      );
      const currentVersion = (locked.rows[0] as unknown as { version: number } | undefined)?.version;
      if (currentVersion === undefined) throw errors.notFound('No such placement.');
      if (currentVersion !== version) {
        const current = await this.store.placementById(id, client);
        throw errors.staleVersion(current ? toPlacementJson(current) : null);
      }
      await client.query(
        `UPDATE placements SET wall_id = $2, offset_mm = $3, centre_height_mm = $4,
           height_override = $5, version = version + 1
         WHERE id = $1`,
        [id, newWallId, offsetMm, centreHeightMm, heightOverride]
      );
      const actionId = randomId('act');
      const window = undoWindow(new Date(), actionId, 'move');
      const undoUntil = new Date(window.undoUntil);
      await client.query(
        `INSERT INTO undo_actions (action_id, staff_id, placement_id, kind,
           before_wall_id, before_offset_mm, before_centre_height_mm, before_height_override, undo_until)
         VALUES ($1,$2,$3,'move',$4,$5,$6,$7,$8)`,
        [actionId, staff.id, id, placement.wallId, placement.offsetMm,
         placement.centreHeightMm, placement.heightOverride, undoUntil]
      );
      const seq = await writeEvent(client, {
        kind: 'placement.moved', actor: staff, placementId: id, objectId: placement.objectId,
        wallId: newWallId, title: placement.objectTitle, wallName: wall.name, offsetMm,
      });
      const after = await this.store.placementById(id, client);
      if (after === null) throw errors.notFound('No such placement.');
      return {
        placement: toPlacementJson(after),
        undo: {
          actionId,
          kind: 'move' as const,
          undoUntil: window.undoUntil,
          remainingMs: window.remainingMs,
        },
        seq,
      };
    });
    this.writeJson(res, 200, result);
    return true;
  }

  private async deletePlacement(res: ServerResponse, id: string, staff: StaffRow): Promise<boolean> {
    if (staff.role !== 'curator') throw errors.forbidden('Only curators remove works.');
    const placement = await this.guardDatabase(() => this.store.placementById(id));
    if (placement === null) throw errors.notFound('No such placement.');
    if (placement.status !== 'proposed') {
      throw new ApiError(409, 'illegal_transition', 'Only proposed works can be removed.');
    }
    const result = await this.store.transaction(async (client) => {
      await client.query(
        `UPDATE placements SET status = 'removed', version = version + 1, claimed_by = NULL WHERE id = $1`,
        [id]
      );
      const actionId = randomId('act');
      const window = undoWindow(new Date(), actionId, 'remove');
      const undoUntil = new Date(window.undoUntil);
      await client.query(
        `INSERT INTO undo_actions (action_id, staff_id, placement_id, kind,
           before_wall_id, before_offset_mm, before_centre_height_mm, before_height_override,
           before_status, before_claimed_by, undo_until)
         VALUES ($1,$2,$3,'remove',$4,$5,$6,$7,'proposed',NULL,$8)`,
        [actionId, staff.id, id, placement.wallId, placement.offsetMm,
         placement.centreHeightMm, placement.heightOverride, undoUntil]
      );
      const seq = await writeEvent(client, {
        kind: 'placement.removed', actor: staff, placementId: id, objectId: placement.objectId,
        wallId: placement.wallId, title: placement.objectTitle, wallName: placement.wallName,
      });
      const after = await this.store.placementById(id);
      return {
        placement: after ? toPlacementJson(after) : null,
        undo: {
          actionId,
          kind: 'remove' as const,
          undoUntil: window.undoUntil,
          remainingMs: window.remainingMs,
        },
        seq,
      };
    });
    this.writeJson(res, 200, result);
    return true;
  }

  private async undo(res: ServerResponse, actionId: string, staff: StaffRow): Promise<boolean> {
    const action = await this.guardDatabase(() => this.store.undoById(actionId));
    if (action === null) throw errors.notFound('No such undo action.');
    if (action.staffId !== staff.id) throw errors.forbidden("Only the person who did it can undo it.");
    if (action.undone) throw new ApiError(409, 'already_undone', "Can't undo: this has already been undone.");
    if (new Date(action.undoUntil).getTime() <= Date.now()) {
      throw new ApiError(410, 'undo_expired', 'Too late to undo: the 10-second window has closed.');
    }
    const result = await this.store.transaction(async (client) => {
      const locked = await client.query(
        'SELECT status, version, wall_id, offset_mm, centre_height_mm FROM placements WHERE id = $1 FOR UPDATE',
        [action.placementId]
      );
      const current = locked.rows[0] as unknown as {
        status: string; version: number; wall_id: string;
        offset_mm: number; centre_height_mm: number;
      } | undefined;
      if (current === undefined) throw errors.notFound('No such placement.');

      const now = new Date();
      if (new Date(action.undoUntil).getTime() <= now.getTime()) {
        throw new ApiError(410, 'undo_expired', 'Too late to undo: the 10-second window has closed.');
      }
      const marked = await client.query(
        'UPDATE undo_actions SET undone = true WHERE action_id = $1 AND NOT undone RETURNING action_id',
        [actionId]
      );
      if (marked.rows.length === 0) {
        throw new ApiError(409, 'already_undone', "Can't undo: this has already been undone.");
      }

      if (action.kind === 'move') {
        if (
          current.wall_id !== action.beforeWallId ||
          current.offset_mm !== action.beforeOffsetMm ||
          current.centre_height_mm !== action.beforeCentreHeightMm
        ) {
          throw new ApiError(409, 'undo_conflict', "Can't undo: this has changed since.");
        }
        await client.query(
          `UPDATE placements SET wall_id = $2, offset_mm = $3, centre_height_mm = $4,
             height_override = $5, version = version + 1
           WHERE id = $1`,
          [action.placementId, action.beforeWallId, action.beforeOffsetMm,
           action.beforeCentreHeightMm, action.beforeHeightOverride]
        );
        const placement = await this.store.placementById(action.placementId, client);
        if (placement === null) throw errors.notFound('No such placement.');
        const seq = await writeEvent(client, {
          kind: 'placement.moved', actor: staff, placementId: placement.id,
          objectId: placement.objectId, wallId: placement.wallId,
          title: placement.objectTitle, wallName: placement.wallName, offsetMm: placement.offsetMm,
        });
        return { placement: toPlacementJson(placement), seq };
      }

      // remove undo: restore as proposed at its old position
      if (current.status !== 'removed') {
        throw new ApiError(409, 'undo_conflict', "Can't undo: this has changed since.");
      }
      const restoredPlacement = await this.store.placementById(action.placementId, client);
      const objectId = restoredPlacement?.objectId ?? '';
      const object = await this.store.objectById(objectId, client);
      const wall = await this.store.wallById(action.beforeWallId ?? '');
      if (wall === null || object === null) throw errors.notFound('No such placement.');
      const neighbours = (await this.store.placementsOnWall(wall.id))
        .filter((p) => p.id !== action.placementId)
        .map((p) => ({ placementId: p.id, offsetMm: p.offsetMm, widthMm: p.widthMm, title: p.objectTitle }));
      const check = checkHangRules(
        { widthMm: object.widthMm, heightMm: object.heightMm, wallId: wall.id,
          offsetMm: action.beforeOffsetMm ?? 0, centreHeightMm: action.beforeCentreHeightMm ?? 0,
          heightOverride: action.beforeHeightOverride ?? false },
        wall, neighbours, object.luxLimit, wall.plannedLux
      );
      if (check.reason !== null) throw this.hangRejected(check, wall, object.luxLimit, wall.plannedLux);

      await client.query(
        `UPDATE placements SET status = 'proposed', wall_id = $2, offset_mm = $3,
           centre_height_mm = $4, height_override = $5, version = version + 1, claimed_by = NULL
         WHERE id = $1`,
        [action.placementId, wall.id, action.beforeOffsetMm, action.beforeCentreHeightMm, action.beforeHeightOverride]
      );
      const placement = await this.store.placementById(action.placementId, client);
      if (placement === null) throw errors.notFound('No such placement.');
      const seq = await writeEvent(client, {
        kind: 'placement.restored', actor: staff, placementId: placement.id,
        objectId: placement.objectId, wallId: placement.wallId,
        title: placement.objectTitle, wallName: placement.wallName,
      });
      return { placement: toPlacementJson(placement), seq };
    });
    this.writeJson(res, 200, result);
    return true;
  }

  private async lifecycle(
    res: ServerResponse, id: string, staff: StaffRow,
    action: 'claim' | 'release' | 'hang' | 'sign-off'
  ): Promise<boolean> {
    const placement = await this.guardDatabase(() => this.store.placementById(id));
    if (placement === null) throw errors.notFound('No such placement.');

    const roleCheck: Record<typeof action, boolean> = {
      claim: staff.role === 'preparator',
      release: placement.claimedBy?.id === staff.id,
      hang: placement.claimedBy?.id === staff.id,
      'sign-off': staff.role === 'registrar',
    };
    if (!roleCheck[action]) {
      throw errors.forbidden(
        action === 'sign-off' ? 'Only registrars sign off works.' :
        action === 'claim' ? 'Only preparators claim works.' :
        'Only the claim holder may do that.'
      );
    }

    if (action === 'claim' && placement.status === 'claimed' && placement.claimedBy?.id === staff.id) {
      this.writeJson(res, 200, { placement: toPlacementJson(placement) });
      return true;
    }

    const transitions: Record<typeof action, { from: PlacementRow['status']; to: PlacementRow['status']; event: EventRow['kind'] }> = {
      claim: { from: 'proposed', to: 'claimed', event: 'placement.claimed' },
      release: { from: 'claimed', to: 'proposed', event: 'placement.released' },
      hang: { from: 'claimed', to: 'hung', event: 'placement.hung' },
      'sign-off': { from: 'hung', to: 'signed_off', event: 'placement.signed_off' },
    };
    const t = transitions[action];
    if (!canTransition(placement.status, t.to, action === 'sign-off' ? 'sign-off' : action)) {
      if (action === 'sign-off') {
        if (placement.status !== 'hung') {
          throw new ApiError(409, 'illegal_transition', 'Only hung works can be signed off.');
        }
      }
      throw new ApiError(409, 'illegal_transition', 'This work is not in a state that allows that.');
    }

    if (action === 'sign-off') {
      const photos = await this.store.photosFor(placement.objectId);
      if (photos.length === 0) {
        throw new ApiError(409, 'condition_not_recorded', `Add a condition photo before signing off ${placement.objectTitle}.`);
      }
      if (placement.luxStatus === 'over') {
        throw new ApiError(409, 'over_budget', `${placement.objectTitle} is over its light budget and can't be signed off.`);
      }
    }

    const result = await this.store.transaction(async (client) => {
      const locked = await client.query(
        'SELECT status, claimed_by FROM placements WHERE id = $1 FOR UPDATE', [id]
      );
      const current = locked.rows[0] as unknown as { status: string; claimed_by: string | null } | undefined;
      if (current === undefined) throw errors.notFound('No such placement.');
      if (current.status !== t.from) {
        if (action === 'claim' && current.status === 'claimed') {
          if (current.claimed_by === staff.id) {
            const same = await this.store.placementById(id, client);
            if (same === null) throw errors.notFound('No such placement.');
            this.writeJson(res, 200, { placement: toPlacementJson(same) });
            return null;
          }
          const winner = await this.store.staffById(current.claimed_by ?? '');
          throw new ApiError(409, 'already_claimed',
            `${winner?.name ?? 'Someone'} claimed ${placement.objectTitle} first.`,
            { claimedBy: winner ? { id: winner.id, name: winner.name } : null });
        }
        throw new ApiError(409, 'illegal_transition', 'This work is not in a state that allows that.');
      }
      await client.query(
        `UPDATE placements SET status = $2, claimed_by = $3, version = version + 1 WHERE id = $1`,
        [id, t.to, action === 'claim' ? staff.id : action === 'release' ? null : placement.claimedBy?.id ?? null]
      );
      const seq = await writeEvent(client, {
        kind: t.event, actor: staff, placementId: id, objectId: placement.objectId,
        wallId: placement.wallId, title: placement.objectTitle, wallName: placement.wallName,
      });
      const after = await this.store.placementById(id, client);
      if (after === null) throw errors.notFound('No such placement.');
      return { placement: toPlacementJson(after), seq };
    });
    if (result === null) return true;
    this.writeJson(res, 200, result);
    return true;
  }

  private claim(res: ServerResponse, id: string, staff: StaffRow): Promise<boolean> {
    return this.lifecycle(res, id, staff, 'claim');
  }
  private release(res: ServerResponse, id: string, staff: StaffRow): Promise<boolean> {
    return this.lifecycle(res, id, staff, 'release');
  }
  private hang(res: ServerResponse, id: string, staff: StaffRow): Promise<boolean> {
    return this.lifecycle(res, id, staff, 'hang');
  }
  private signOff(res: ServerResponse, id: string, staff: StaffRow): Promise<boolean> {
    return this.lifecycle(res, id, staff, 'sign-off');
  }

  // ---------- walls ----------

  private async patchWall(
    res: ServerResponse, rest: string, body: Body | undefined, staff: StaffRow
  ): Promise<boolean> {
    if (staff.role !== 'curator') throw errors.forbidden('Only curators change wall lighting.');
    const id = rest.replace(/^\//, '');
    const wall = await this.guardDatabase(() => this.store.wallById(id));
    if (wall === null) throw errors.notFound('No such wall.');
    const payload = body ?? {};
    const lux = intField(payload['plannedLux']);
    if (lux === null || lux < 1 || lux > 1000) {
      throw errors.validationFailed({ plannedLux: 'Enter a lux level from 1 to 1000.' });
    }
    const result = await this.store.transaction(async (client) => {
      await client.query('UPDATE walls SET planned_lux = $2 WHERE id = $1', [id, lux]);
      const seq = await writeEvent(client, {
        kind: 'wall.lux_changed', actor: staff, wallId: id, wallName: wall.name, plannedLux: lux,
      });
      const placements = await this.store.placementsOnWall(id, client);
      return { wall: { ...wall, plannedLux: lux }, placements: placements.map(toPlacementJson), seq };
    });
    this.writeJson(res, 200, result);
    return true;
  }

  // ---------- preview ----------

  private async getPreview(res: ServerResponse): Promise<boolean> {
    const preview = await this.guardDatabase(() => this.previewJson());
    this.writeJson(res, 200, { preview });
    return true;
  }

  private async previewJson(): Promise<unknown> {
    const row = await this.store.preview();
    return previewToJson(row, new Date(), this.timeZone, this.cfg.publishDelaySeconds !== null);
  }

  private async schedulePreview(
    res: ServerResponse, body: Body | undefined, staff: StaffRow
  ): Promise<boolean> {
    if (staff.role !== 'curator') throw errors.forbidden('Only curators schedule the preview.');
    const payload = body ?? {};
    const date = typeof payload['date'] === 'string' ? payload['date'] : '';
    const parsed = parseDateParts(date);
    if (parsed === null) {
      throw errors.validationFailed({ date: 'Enter a date as YYYY-MM-DD.' });
    }
    const exhibition = await this.store.exhibition();
    let publishAt: Date;
    if (this.cfg.publishDelaySeconds !== null) {
      publishAt = new Date(Date.now() + this.cfg.publishDelaySeconds * 1000);
    } else {
      publishAt = zonedTime(parsed.year, parsed.month, parsed.day, 9, 0, exhibition.timeZone);
      if (publishAt.getTime() - Date.now() < 2 * 3600 * 1000) {
        throw errors.validationFailed({
          date: 'Choose a later date: 09:00 museum time on that date is less than 2 hours away.',
        });
      }
    }
    const current = await this.store.preview();
    if (!canPreviewTransition(current.status, 'scheduled', 'schedule')) {
      throw new ApiError(409, 'preview_conflict', 'The preview can\'t be scheduled right now.');
    }
    const id = randomId('prev');
    const result = await this.store.transaction(async (client) => {
      await client.query(
        `INSERT INTO previews (id, status, date, publish_at, scheduled_at)
         VALUES ($1, 'scheduled', $2, $3, now())`,
        [id, date, publishAt]
      );
      const seq = await writeEvent(client, {
        kind: 'preview.scheduled', actor: staff, previewId: id,
        publishAtDisplay: display(publishAt, exhibition.timeZone),
      });
      return { preview: previewToJson(await this.store.preview(), new Date(), this.timeZone, this.cfg.publishDelaySeconds !== null), seq };
    });
    this.writeJson(res, 200, result);
    return true;
  }

  private async cancelPreview(res: ServerResponse, staff: StaffRow): Promise<boolean> {
    if (staff.role !== 'curator') throw errors.forbidden('Only curators cancel the preview.');
    const current = await this.store.preview();
    if (!canPreviewTransition(current.status, 'draft', 'cancel')) {
      throw new ApiError(409, 'preview_conflict', 'The preview schedule can\'t be cancelled right now.');
    }
    const result = await this.store.transaction(async (client) => {
      await client.query(
        `UPDATE previews SET status = 'draft', date = NULL, publish_at = NULL WHERE id = $1`,
        [current.id]
      );
      const seq = await writeEvent(client, {
        kind: 'preview.cancelled', actor: staff, previewId: current.id ?? '',
      });
      return { preview: previewToJson(await this.store.preview(), new Date(), this.timeZone, false), seq };
    });
    this.writeJson(res, 200, result);
    return true;
  }

  private async withdrawPreview(res: ServerResponse, staff: StaffRow): Promise<boolean> {
    if (staff.role !== 'curator') throw errors.forbidden('Only curators withdraw the preview.');
    const current = await this.store.preview();
    if (!canPreviewTransition(current.status, 'withdrawn', 'withdraw')) {
      throw new ApiError(409, 'preview_conflict', 'The preview can\'t be withdrawn right now.');
    }
    const result = await this.store.transaction(async (client) => {
      await client.query(
        `UPDATE previews SET status = 'withdrawn', withdrawn_at = now() WHERE id = $1`,
        [current.id]
      );
      await client.query(
        `UPDATE preview_recipients SET delivery = 'cancelled' WHERE preview_id = $1 AND delivery = 'queued'`,
        [current.id]
      );
      const seq = await writeEvent(client, {
        kind: 'preview.withdrawn', actor: staff, previewId: current.id ?? '',
      });
      return { preview: previewToJson(await this.store.preview(), new Date(), this.timeZone, false), seq };
    });
    await queueWithdrawalMail(this.cfg, this.store, current.id ?? '');
    this.writeJson(res, 200, result);
    return true;
  }

  // ---------- lender pages and snapshots ----------

  private async handleLender(
    req: IncomingMessage, res: ServerResponse, path: string, url: URL, method: string
  ): Promise<boolean> {
    if (method !== 'GET') {
      throw errors.readOnly();
    }
    const isApi = path.startsWith('/api/p/');
    const rest = path.slice(isApi ? '/api/p/'.length : '/p/'.length);
    const parts = rest.split('/');
    const token = parts[0] ?? '';
    const wantsPng = parts[1] === 'snapshot.png';
    if (parts[1] !== undefined && !wantsPng) throw errors.notFound('No such preview link.');
    const record = await this.guardDatabase(async () => {
      const { rows } = await this.store.query(
        `SELECT pr.token, pr.lender_id, pr.delivery, pv.id AS preview_id, pv.status
         FROM preview_recipients pr JOIN previews pv ON pv.id = pr.preview_id
         WHERE pr.token = $1`, [token]
      );
      return rows[0] as unknown as {
        token: string; lender_id: string; preview_id: string; status: string;
      } | undefined;
    });
    if (record === undefined) throw errors.notFound('This preview link isn\'t valid.');
    if (record.status === 'withdrawn') {
      throw new ApiError(410, 'link_withdrawn', 'This preview has been withdrawn by the museum.');
    }
    if (record.status !== 'published') throw errors.notFound('This preview link isn\'t valid.');
    const key = `previews/${record.preview_id}/${record.lender_id}/snapshot.${wantsPng ? 'png' : 'json'}`;
    let stored;
    try {
      stored = await this.services.imageStore().get(key);
    } catch {
      throw errors.imageStoreUnavailable();
    }
    if (stored === null) throw errors.notFound('This preview link isn\'t valid.');
    if (wantsPng) {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(stored.data.length) });
      res.end(stored.data);
      return true;
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(stored.data);
    return true;
  }

  private writeJson(res: ServerResponse, status: number, body: unknown): void {
    const data = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(data),
    });
    res.end(data);
  }
}

function intField(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  return null;
}

function fingerprintOf(body: Body): string {
  return JSON.stringify(body);
}

export function toPhotoJson(p: PhotoRow) {
  return {
    id: p.id, objectId: p.objectId, key: p.key, bytes: p.bytes,
    sha256: p.sha256, contentType: p.contentType, attachedAt: p.attachedAt,
  };
}

export function toPlacementJson(p: PlacementRow) {
  return {
    id: p.id,
    objectId: p.objectId,
    objectTitle: p.objectTitle,
    objectNumber: p.objectNumber,
    lenderId: p.lenderId,
    wallId: p.wallId,
    wallName: p.wallName,
    offsetMm: p.offsetMm,
    centreHeightMm: p.centreHeightMm,
    heightOverride: p.heightOverride,
    widthMm: p.widthMm,
    heightMm: p.heightMm,
    plannedLux: p.plannedLux,
    plannedLuxHours: p.plannedLuxHours,
    luxLimit: p.luxLimit,
    luxHourBudget: p.luxHourBudget,
    luxStatus: p.luxStatus,
    status: p.status,
    claimedBy: p.claimedBy,
    version: p.version,
  };
}

export function previewToJson(
  row: PreviewRow, now: Date, timeZone: string, delayed: boolean
): unknown {
  const publishAtDisplay = row.publishAt ? display(new Date(row.publishAt), timeZone) : null;
  const publishedAtDisplay = row.publishedAt ? display(new Date(row.publishedAt), timeZone) : null;
  const withdrawnAtDisplay = row.withdrawnAt ? display(new Date(row.withdrawnAt), timeZone) : null;
  return {
    id: row.id,
    status: row.status,
    date: row.date,
    publishAt: row.publishAt,
    publishAtDisplay,
    remainingMs: row.status === 'scheduled' && row.publishAt !== null
      ? remainingMs(now, row.publishAt)
      : null,
    publishedAt: row.publishedAt,
    publishedAtDisplay,
    withdrawnAt: row.withdrawnAt,
    withdrawnAtDisplay,
    recipients: row.recipients.map((r) => ({
      lenderId: r.lenderId,
      lenderName: r.lenderName,
      email: r.email,
      delivery: r.delivery,
      sentAt: r.sentAt,
    })),
  };
}

/** Writes one event inside the caller's transaction and returns its seq. */
export async function writeEvent(
  client: DbClient,
  event: {
    kind: EventRow['kind'];
    actor: StaffRow | null;
    placementId?: string;
    objectId?: string;
    wallId?: string;
    title?: string;
    wallName?: string;
    offsetMm?: number;
    plannedLux?: number;
    previewId?: string;
    publishAtDisplay?: string;
    recipientCount?: number;
  }
): Promise<number> {
  const { rows } = await client.query(
    `INSERT INTO events (kind, actor_id, actor_name, placement_id, object_id, wall_id,
       title, wall_name, offset_mm, planned_lux, preview_id, publish_at_display, recipient_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING seq`,
    [event.kind, event.actor?.id ?? null, event.actor?.name ?? 'Server', event.placementId ?? null,
     event.objectId ?? null, event.wallId ?? null, event.title ?? null, event.wallName ?? null,
     event.offsetMm ?? null, event.plannedLux ?? null, event.previewId ?? null,
     event.publishAtDisplay ?? null, event.recipientCount ?? null]
  );
  return Number((rows[0] as unknown as { seq: string })['seq']);
}
