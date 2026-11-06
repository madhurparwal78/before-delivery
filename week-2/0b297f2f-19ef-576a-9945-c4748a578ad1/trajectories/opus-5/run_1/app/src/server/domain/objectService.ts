import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { fieldMessages } from '../../shared/copy';
import type { LoanObject, Placement, Staff, Unit } from '../../shared/types';
import { lengthToMm, MAX_DIMENSION_MM, MIN_DIMENSION_MM } from '../../shared/units';
import { withClient, withTransaction } from '../db/pool';
import { errors } from '../http/errors';
import { writeEvent } from './events';
import { recomputeObjectPlacements } from './placementService';
import { objectSelect, rowToObject } from './repository';

interface ObjectFields {
  title: string;
  objectNumber: string;
  medium: string;
  lenderId: string | null;
  widthMm: number;
  heightMm: number;
  luxLimit: number;
  luxHourBudget: number;
  insuranceValueGbp: number;
  registrarNote: string;
}

type RawBody = Record<string, unknown>;

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

function wholeInRange(value: unknown, min: number, max: number): number | null {
  const parsed = asNumber(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function resolveUnit(body: RawBody, fields: Record<string, string>): Unit | null {
  const raw = body['unit'];
  if (raw === 'cm' || raw === 'in') return raw;
  fields['unit'] = fieldMessages.unit;
  return null;
}

function dimensionMm(
  raw: unknown,
  unit: Unit | null,
  field: 'width' | 'height',
  fields: Record<string, string>,
): number | null {
  if (unit === null) {
    fields[field] = fieldMessages[field];
    return null;
  }
  if (typeof raw !== 'number' && typeof raw !== 'string') {
    fields[field] = fieldMessages[field];
    return null;
  }
  const mm = lengthToMm(raw, unit);
  if (mm === null || mm < MIN_DIMENSION_MM || mm > MAX_DIMENSION_MM) {
    fields[field] = fieldMessages[field];
    return null;
  }
  return mm;
}

async function lenderExists(client: PoolClient, lenderId: string): Promise<boolean> {
  return (await client.query('select 1 from lenders where id = $1', [lenderId])).rows.length > 0;
}

async function numberTaken(
  client: PoolClient,
  objectNumber: string,
  exceptId: string | null,
): Promise<boolean> {
  const rows = (
    await client.query(
      'select 1 from loan_objects where object_number = $1 and ($2::text is null or id <> $2)',
      [objectNumber, exceptId],
    )
  ).rows;
  return rows.length > 0;
}

async function loadObject(client: PoolClient, id: string): Promise<LoanObject | null> {
  const row = (await client.query(`${objectSelect} where o.id = $1`, [id])).rows[0];
  return row ? rowToObject(row) : null;
}

export async function getObject(id: string): Promise<LoanObject | null> {
  return withClient((client) => loadObject(client, id));
}

interface ListFilters {
  q?: string;
  lender?: string;
  sort?: string;
  dir?: string;
}

const sortColumns: Record<string, string> = {
  number: 'o.object_number',
  title: 'lower(o.title)',
  lender: "lower(coalesce(l.name, 'Ashgrove collection'))",
  lux: 'o.lux_limit',
};

export async function listObjects(filters: ListFilters): Promise<LoanObject[]> {
  const fields: Record<string, string> = {};
  const q = filters.q ?? '';
  if (q.length > 100) fields['q'] = 'Keep the search to 100 characters or fewer.';
  const sort = filters.sort ?? 'number';
  if (!(sort in sortColumns)) fields['sort'] = 'Sort by number, title, lender or lux.';
  const dir = filters.dir ?? 'asc';
  if (dir !== 'asc' && dir !== 'desc') fields['dir'] = 'Order by asc or desc.';
  const lender = filters.lender;

  return withClient(async (client) => {
    if (lender !== undefined && lender !== 'collection' && !(await lenderExists(client, lender))) {
      fields['lender'] = 'Filter by a lender id or collection.';
    }
    if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (q !== '') {
      params.push(`%${q}%`);
      conditions.push(`(o.title ilike $${params.length} or o.object_number ilike $${params.length})`);
    }
    if (lender === 'collection') {
      conditions.push('o.lender_id is null');
    } else if (lender !== undefined) {
      params.push(lender);
      conditions.push(`o.lender_id = $${params.length}`);
    }
    const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';
    const column = sortColumns[sort] ?? 'o.object_number';
    const order = dir === 'desc' ? 'desc' : 'asc';
    const rows = (
      await client.query(
        `${objectSelect} ${where} order by ${column} ${order}, o.object_number asc`,
        params,
      )
    ).rows;
    return rows.map(rowToObject);
  });
}

export async function createObject(
  staff: Staff,
  body: RawBody,
): Promise<{ object: LoanObject; seq: number }> {
  return withTransaction(async (client) => {
    const fields: Record<string, string> = {};
    const title = typeof body['title'] === 'string' ? body['title'].trim() : '';
    if (title === '') fields['title'] = fieldMessages.title;
    const objectNumber =
      typeof body['objectNumber'] === 'string' ? body['objectNumber'].trim() : '';
    if (objectNumber === '') {
      fields['objectNumber'] = fieldMessages.objectNumberEmpty;
    } else if (await numberTaken(client, objectNumber, null)) {
      fields['objectNumber'] = fieldMessages.objectNumberDuplicate;
    }

    let lenderId: string | null = null;
    const rawLender = body['lenderId'];
    if (rawLender === null) {
      lenderId = null;
    } else if (typeof rawLender === 'string' && (await lenderExists(client, rawLender))) {
      lenderId = rawLender;
    } else {
      fields['lenderId'] = fieldMessages.lenderId;
    }

    const medium = typeof body['medium'] === 'string' ? body['medium'] : '';
    if (medium.length > 120) fields['medium'] = fieldMessages.medium;

    const unit = resolveUnit(body, fields);
    const widthMm = dimensionMm(body['width'], unit, 'width', fields);
    const heightMm = dimensionMm(body['height'], unit, 'height', fields);

    const luxLimit = wholeInRange(body['luxLimit'], 1, 1000);
    if (luxLimit === null) fields['luxLimit'] = fieldMessages.luxLimit;
    const luxHourBudget = wholeInRange(body['luxHourBudget'], 1, 10_000_000);
    if (luxHourBudget === null) fields['luxHourBudget'] = fieldMessages.luxHourBudget;
    const insuranceValueGbp = wholeInRange(body['insuranceValueGbp'], 0, 1_000_000_000);
    if (insuranceValueGbp === null) {
      fields['insuranceValueGbp'] = fieldMessages.insuranceValueGbp;
    }
    const registrarNote = typeof body['registrarNote'] === 'string' ? body['registrarNote'] : '';
    if (registrarNote.length > 2000) fields['registrarNote'] = fieldMessages.registrarNote;

    if (Object.keys(fields).length > 0) throw errors.validationFailed(orderFields(fields));

    const resolved: ObjectFields = {
      title,
      objectNumber,
      medium,
      lenderId,
      widthMm: widthMm as number,
      heightMm: heightMm as number,
      luxLimit: luxLimit as number,
      luxHourBudget: luxHourBudget as number,
      insuranceValueGbp: insuranceValueGbp as number,
      registrarNote,
    };
    const id = `obj-${randomUUID()}`;
    await client.query(
      `insert into loan_objects (id, object_number, title, medium, lender_id, width_mm, height_mm,
         lux_limit, lux_hour_budget, insurance_value_gbp, registrar_note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        resolved.objectNumber,
        resolved.title,
        resolved.medium,
        resolved.lenderId,
        resolved.widthMm,
        resolved.heightMm,
        resolved.luxLimit,
        resolved.luxHourBudget,
        resolved.insuranceValueGbp,
        resolved.registrarNote,
      ],
    );
    const object = await loadObject(client, id);
    if (!object) throw errors.notFound();
    const seq = await writeEvent(client, {
      kind: 'object.created',
      actorId: staff.id,
      objectId: object.id,
      title: object.title,
    });
    return { object, seq };
  });
}

const fieldOrder = [
  'title',
  'objectNumber',
  'lenderId',
  'medium',
  'unit',
  'width',
  'height',
  'luxLimit',
  'luxHourBudget',
  'insuranceValueGbp',
  'registrarNote',
];

function orderFields(fields: Record<string, string>): Record<string, string> {
  const ordered: Record<string, string> = {};
  for (const key of fieldOrder) {
    const message = fields[key];
    if (message !== undefined) ordered[key] = message;
  }
  for (const [key, message] of Object.entries(fields)) {
    if (!(key in ordered)) ordered[key] = message;
  }
  return ordered;
}

export async function updateObject(
  staff: Staff,
  id: string,
  body: RawBody,
): Promise<{ object: LoanObject; placements: Placement[]; seq: number }> {
  return withTransaction(async (client) => {
    const current = await loadObject(client, id);
    if (!current) throw errors.notFound();

    const fields: Record<string, string> = {};
    const updates: Record<string, unknown> = {};

    if ('title' in body) {
      const title = typeof body['title'] === 'string' ? body['title'].trim() : '';
      if (title === '') fields['title'] = fieldMessages.title;
      else updates['title'] = title;
    }
    if ('objectNumber' in body) {
      const objectNumber =
        typeof body['objectNumber'] === 'string' ? body['objectNumber'].trim() : '';
      if (objectNumber === '') fields['objectNumber'] = fieldMessages.objectNumberEmpty;
      else if (await numberTaken(client, objectNumber, id)) {
        fields['objectNumber'] = fieldMessages.objectNumberDuplicate;
      } else updates['object_number'] = objectNumber;
    }
    if ('lenderId' in body) {
      const rawLender = body['lenderId'];
      if (rawLender === null) updates['lender_id'] = null;
      else if (typeof rawLender === 'string' && (await lenderExists(client, rawLender))) {
        updates['lender_id'] = rawLender;
      } else fields['lenderId'] = fieldMessages.lenderId;
    }
    if ('medium' in body) {
      const medium = typeof body['medium'] === 'string' ? body['medium'] : '';
      if (medium.length > 120) fields['medium'] = fieldMessages.medium;
      else updates['medium'] = medium;
    }
    const wantsDimensions = 'width' in body || 'height' in body;
    if (wantsDimensions) {
      const unit = resolveUnit(body, fields);
      if ('width' in body) {
        const widthMm = dimensionMm(body['width'], unit, 'width', fields);
        if (widthMm !== null) updates['width_mm'] = widthMm;
      }
      if ('height' in body) {
        const heightMm = dimensionMm(body['height'], unit, 'height', fields);
        if (heightMm !== null) updates['height_mm'] = heightMm;
      }
    }
    if ('luxLimit' in body) {
      const luxLimit = wholeInRange(body['luxLimit'], 1, 1000);
      if (luxLimit === null) fields['luxLimit'] = fieldMessages.luxLimit;
      else updates['lux_limit'] = luxLimit;
    }
    if ('luxHourBudget' in body) {
      const budget = wholeInRange(body['luxHourBudget'], 1, 10_000_000);
      if (budget === null) fields['luxHourBudget'] = fieldMessages.luxHourBudget;
      else updates['lux_hour_budget'] = budget;
    }
    if ('insuranceValueGbp' in body) {
      const value = wholeInRange(body['insuranceValueGbp'], 0, 1_000_000_000);
      if (value === null) fields['insuranceValueGbp'] = fieldMessages.insuranceValueGbp;
      else updates['insurance_value_gbp'] = value;
    }
    if ('registrarNote' in body) {
      const note = typeof body['registrarNote'] === 'string' ? body['registrarNote'] : '';
      if (note.length > 2000) fields['registrarNote'] = fieldMessages.registrarNote;
      else updates['registrar_note'] = note;
    }

    const changesSize =
      (updates['width_mm'] !== undefined && updates['width_mm'] !== current.widthMm) ||
      (updates['height_mm'] !== undefined && updates['height_mm'] !== current.heightMm);
    if (changesSize && current.placementId !== null) {
      throw errors.conflict('object_placed', 'That work is on a wall; its size cannot change.');
    }
    if (Object.keys(fields).length > 0) throw errors.validationFailed(orderFields(fields));

    const entries = Object.entries(updates);
    if (entries.length > 0) {
      const assignments = entries.map(([column], index) => `${column} = $${index + 2}`);
      await client.query(`update loan_objects set ${assignments.join(', ')} where id = $1`, [
        id,
        ...entries.map(([, value]) => value),
      ]);
    }
    const placements = await recomputeObjectPlacements(client, id);
    const object = await loadObject(client, id);
    if (!object) throw errors.notFound();
    const seq = await writeEvent(client, {
      kind: 'object.updated',
      actorId: staff.id,
      objectId: object.id,
      title: object.title,
    });
    return { object, placements, seq };
  });
}
