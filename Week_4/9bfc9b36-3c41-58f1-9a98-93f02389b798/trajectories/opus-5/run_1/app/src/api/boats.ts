import { queryOne, transact } from '../db/pool';
import { invalid, notFound, refuse, storeUnavailable } from '../http/errors';
import { FIELD_COPY } from '../shared/copy';
import {
  boatByCode, boatView, currentRuleSet, dimensionsOfBoat, loftClosures, reader,
  type AccountRow, type BoatRow,
} from '../domain/model';
import { DIMENSION_ORDER } from '../domain/model';
import { readsAsInches } from '../domain/inches';
import { Check, normaliseEmail } from '../domain/validate';
import { audit, nextCode, opaqueId } from '../domain/records';
import { getObject, sha256OfBytes, StoreUnreachable } from '../services/s3';
import { tapePhotoKey, writeAndConfirm } from '../services/store';
import { settleDependentDrawings } from './drawings';
import { answerPage, numericIdSql, padNumber, pageClause } from './lists';
import { asOwner, boatVisible, onlyRoles, requireVisible } from './visibility';
import { jsonBody, reply, signedIn, type Ctx, type Reply } from './types';
import { readRevision, requireMatch } from './revisions';

/** Boats, their rig dimensions, their tape photographs and the unit-slip guard. */

export async function listBoats(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  const order = { at: null, id: numericIdSql('code') };
  const clause = pageClause(ctx, {}, order, 1);
  let scope = '';
  const scopeValues: unknown[] = [];
  if (caller.role === 'yacht-owner') {
    scope = ` AND owner_email = $${clause.values.length + 1}`;
    scopeValues.push(caller.email);
  } else if (caller.role === 'loft-hand') {
    scope = ` AND code IN (SELECT boat_code FROM drawing WHERE assigned_to = $${clause.values.length + 1})`;
    scopeValues.push(caller.email);
  }
  const page = await answerPage<BoatRow, Record<string, unknown>>(
    clause,
    {
      sql: `SELECT * FROM boat WHERE true ${clause.where} ${scope}
             ORDER BY code_number(code) DESC LIMIT ${clause.limit + 1}`,
      values: [...clause.values, ...scopeValues],
      countSql: `SELECT count(*)::text n FROM boat WHERE true ${scope.replace(/\$\d+/, '$1')}`,
      countValues: scopeValues,
      position: (row) => ({ at: '', id: padNumber(row.code) }),
    },
    (row) => boatView(reader, row, ctx.now, asOwner(caller)),
  );
  return reply(200, page);
}

async function visibleBoat(ctx: Ctx, code: string): Promise<BoatRow> {
  const caller = signedIn(ctx);
  const row = await boatByCode(reader, code);
  return requireVisible(row, row !== null && (await boatVisible(reader, caller, row)));
}

export async function getBoat(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  const row = await visibleBoat(ctx, ctx.params['code'] as string);
  const view = await boatView(reader, row, ctx.now, asOwner(caller));
  // Owners receive the boat with no ETag.
  return asOwner(caller)
    ? reply(200, view)
    : reply(200, view, { etag: `"${row.revision}"` });
}

export async function createBoat(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const body = jsonBody(ctx);
  const check = new Check(body);
  const name = check.text('name', 1, 60);
  const className = check.text('class_name', 1, 60);
  const notes = check.text('notes', 0, 500);
  const ownerEmail = typeof body['owner_email'] === 'string' ? normaliseEmail(body['owner_email']) : '';
  const owner = await queryOne<AccountRow>(
    `SELECT * FROM account WHERE email = $1 AND role = 'yacht-owner' AND deleted = false`,
    [ownerEmail],
  );
  if (owner === null) check.fail('owner_email', FIELD_COPY.ownerEmail);
  check.done();

  const created = await transact(async (tx) => {
    const code = await nextCode(tx, 'boat');
    const row = await tx.one<BoatRow>(
      `INSERT INTO boat (code, name, class_name, owner_email, notes, revision)
       VALUES ($1,$2,$3,$4,$5,1) RETURNING *`,
      [code, name, className, ownerEmail, notes],
    );
    await audit(tx, ctx.now, { actorEmail: caller.email, action: 'boat.create', target: code, after: name });
    return row as BoatRow;
  });
  const view = await boatView(reader, created, ctx.now, false);
  return reply(201, view, { etag: `"${created.revision}"` });
}

export async function patchBoat(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const code = ctx.params['code'] as string;
  const row = await boatByCode(reader, code);
  if (row === null) throw notFound();
  const wanted = readRevision(ctx);
  requireMatch(wanted, row.revision);
  const body = jsonBody(ctx);
  const check = new Check(body);
  const name = check.text('name', 1, 60);
  const className = check.text('class_name', 1, 60);
  const notes = check.text('notes', 0, 500);
  check.done();

  const updated = await transact(async (tx) => {
    const next = await tx.one<BoatRow>(
      `UPDATE boat SET name = $2, class_name = $3, notes = $4, revision = revision + 1
        WHERE code = $1 AND revision = $5 RETURNING *`,
      [code, name, className, notes, row.revision],
    );
    if (next === null) throw refuse('stale_revision');
    await audit(tx, ctx.now, {
      actorEmail: caller.email,
      action: 'boat.update',
      target: code,
      before: row.name,
      after: name,
    });
    return next;
  });
  const view = await boatView(reader, updated, ctx.now, false);
  return reply(200, view, { etag: `"${updated.revision}"` });
}

export interface RecordedMeasurement {
  readonly boat: BoatRow;
  readonly dimension: string;
  readonly remeasureDue: string | null;
}

export async function recordMeasurement(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const code = ctx.params['code'] as string;
  const boat = await boatByCode(reader, code);
  if (boat === null) throw notFound();
  const body = jsonBody(ctx);
  const check = new Check(body);
  const dimension = check.choice('dimension', DIMENSION_ORDER, FIELD_COPY.dimension);
  const valueMm = check.lengthMm('value_mm');
  const measuredOn = check.date('measured_on');

  const ruleset = await currentRuleSet(reader, ctx.now);
  const closures = await loftClosures(reader);
  const states = await dimensionsOfBoat(reader, code, closures);
  const current = states.get(dimension)?.value_mm ?? null;
  if (!check.anyErrors() && readsAsInches(valueMm, current, ruleset.tolerance_mm)) {
    check.fail('value_mm', FIELD_COPY.looksLikeInches);
  }
  check.done();

  await transact(async (tx) => {
    await tx.query(
      `INSERT INTO measurement (id, boat_code, dimension, value_mm, measured_on, source, tolerance_mm)
       VALUES ($1,$2,$3,$4,$5,'sailmaker',$6)`,
      [opaqueId('ME-'), code, dimension, valueMm, measuredOn, ruleset.tolerance_mm],
    );
    await audit(tx, ctx.now, {
      actorEmail: caller.email,
      action: 'measurement.record',
      target: `${code} ${dimension}`,
      before: current === null ? null : String(current),
      after: String(valueMm),
    });
    await settleDependentDrawings(tx, code, dimension, ctx.now);
  });
  return reply(201, await boatView(reader, boat, ctx.now, false), { etag: `"${boat.revision}"` });
}

interface MeasurementPhotoRow {
  readonly id: string;
  readonly boat_code: string;
  readonly dimension: string;
  readonly photo_key: string | null;
  readonly photo_size: number | null;
  readonly photo_sha256: string | null;
  readonly photo_content_type: string | null;
}

async function visibleMeasurement(ctx: Ctx, id: string): Promise<MeasurementPhotoRow> {
  const caller = signedIn(ctx);
  const row = await queryOne<MeasurementPhotoRow>('SELECT * FROM measurement WHERE id = $1', [id]);
  if (row === null) throw notFound();
  const boat = await boatByCode(reader, row.boat_code);
  requireVisible(boat, boat !== null && (await boatVisible(reader, caller, boat)));
  return row;
}

export async function putPhoto(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const row = await visibleMeasurement(ctx, ctx.params['id'] as string);
  const contentType = (ctx.headers['content-type'] as string).split(';')[0]?.trim().toLowerCase() as string;
  const digest = sha256OfBytes(ctx.rawBody);

  if (row.photo_sha256 !== null) {
    // The same bytes again write nothing; different bytes are refused.
    if (row.photo_sha256 === digest) return reply(200, await dimensionReply(row));
    throw refuse('photo_exists');
  }

  const key = tapePhotoKey(row.boat_code, row.id, digest, contentType);
  let confirmed: boolean;
  try {
    confirmed = await writeAndConfirm(key, ctx.rawBody, contentType, { sha256: digest });
  } catch (cause) {
    if (cause instanceof StoreUnreachable) throw storeUnavailable('photo');
    throw cause;
  }
  if (!confirmed) throw storeUnavailable('photo');

  await transact(async (tx) => {
    await tx.query(
      `UPDATE measurement SET photo_key = $2, photo_size = $3, photo_sha256 = $4, photo_content_type = $5
        WHERE id = $1`,
      [row.id, key, ctx.rawBody.length, digest, contentType],
    );
    await audit(tx, ctx.now, {
      actorEmail: caller.email,
      action: 'photo.attach',
      target: row.id,
      after: digest,
    });
  });
  return reply(200, await dimensionReply(row));
}

async function dimensionReply(row: MeasurementPhotoRow): Promise<Record<string, unknown>> {
  const closures = await loftClosures(reader);
  const states = await dimensionsOfBoat(reader, row.boat_code, closures);
  const boat = (await boatByCode(reader, row.boat_code)) as BoatRow;
  const view = (await boatView(reader, boat, new Date(), false))['dimensions'] as readonly Record<string, unknown>[];
  const found = view.find((entry) => entry['key'] === row.dimension);
  return found ?? { key: row.dimension, value_mm: states.get(row.dimension)?.value_mm ?? null };
}

export async function getPhoto(ctx: Ctx): Promise<Reply> {
  const row = await visibleMeasurement(ctx, ctx.params['id'] as string);
  if (row.photo_key === null) throw notFound();
  let stored;
  try {
    stored = await getObject(row.photo_key);
  } catch (cause) {
    if (cause instanceof StoreUnreachable) throw storeUnavailable('photo');
    throw cause;
  }
  if (stored === null) throw storeUnavailable('photo');
  const extension = row.photo_content_type === 'image/png' ? 'png' : 'jpg';
  return {
    status: 200,
    body: stored.bytes,
    contentType: row.photo_content_type as string,
    headers: {
      etag: `"${row.photo_sha256 as string}"`,
      'x-content-type-options': 'nosniff',
      'content-disposition': `inline; filename="${row.id}.${extension}"`,
    },
  };
}

export async function createSubmission(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['yacht-owner']);
  const code = ctx.params['code'] as string;
  const boat = await boatByCode(reader, code);
  requireVisible(boat, boat !== null && boat.owner_email === caller.email);
  const { submitOwnerMeasurement } = await import('./submissions');
  return submitOwnerMeasurement(ctx, boat as BoatRow);
}

export function invalidDimension(): never {
  throw invalid({ dimension: FIELD_COPY.dimension });
}
