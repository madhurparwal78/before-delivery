import { randomUUID } from 'node:crypto';
import { apertureToMm, sortEyepieces, TRAINS } from '../shared/optics.js';
import { isTimeZone } from '../shared/clock.js';
import type { Barlow, Eyepiece, Kit, Site, Telescope } from '../shared/types.js';
import { query } from './db.js';
import { FieldErrors } from './errors.js';

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 60 ? trimmed : null;
}

function inRange(value: number | null, low: number, high: number): boolean {
  return value !== null && value >= low && value <= high;
}

export async function readKit(accountId: string): Promise<Kit> {
  const [telescopes, eyepieces, barlows] = await Promise.all([
    query<Telescope>(
      `SELECT id, name, aperture_mm, focal_length_mm FROM telescopes
       WHERE account_id = $1 ORDER BY seq`,
      [accountId],
    ),
    query<Eyepiece>(
      `SELECT id, name, focal_length_mm, apparent_field_deg FROM eyepieces
       WHERE account_id = $1 ORDER BY seq`,
      [accountId],
    ),
    query<Barlow>(`SELECT id, name, factor FROM barlows WHERE account_id = $1 ORDER BY seq`, [
      accountId,
    ]),
  ]);
  return {
    telescopes: telescopes.rows,
    eyepieces: sortEyepieces(eyepieces.rows),
    barlows: barlows.rows,
    trains: [...TRAINS],
  };
}

export async function addTelescope(
  accountId: string,
  body: Record<string, unknown>,
): Promise<Telescope> {
  const name = readName(body.name);
  const unit = body.aperture_unit;
  const aperture = readNumber(body.aperture);
  const focal = readNumber(body.focal_length_mm);
  const errors = new FieldErrors();
  if (name === null) errors.add('name');
  if (unit !== 'mm' && unit !== 'in') errors.add('aperture_unit');
  const apertureMm = aperture !== null && (unit === 'mm' || unit === 'in')
    ? apertureToMm(aperture, unit)
    : null;
  if (!inRange(apertureMm, 25, 1600)) errors.add('aperture');
  if (!inRange(focal, 100, 20_000)) errors.add('focal_length_mm', 'telescope_focal_length_mm');
  errors.throwIfAny();

  const id = randomUUID();
  const inserted = await query<Telescope>(
    `INSERT INTO telescopes (id, account_id, name, aperture_mm, focal_length_mm)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, name, aperture_mm, focal_length_mm`,
    [id, accountId, name, apertureMm, focal],
  );
  return inserted.rows[0] as Telescope;
}

export async function addEyepiece(
  accountId: string,
  body: Record<string, unknown>,
): Promise<Eyepiece> {
  const name = readName(body.name);
  const focal = readNumber(body.focal_length_mm);
  const field = readNumber(body.apparent_field_deg);
  const errors = new FieldErrors();
  if (name === null) errors.add('name');
  if (!inRange(focal, 2, 60)) errors.add('focal_length_mm', 'eyepiece_focal_length_mm');
  if (!inRange(field, 30, 120)) errors.add('apparent_field_deg');
  errors.throwIfAny();

  const inserted = await query<Eyepiece>(
    `INSERT INTO eyepieces (id, account_id, name, focal_length_mm, apparent_field_deg)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, name, focal_length_mm, apparent_field_deg`,
    [randomUUID(), accountId, name, focal, field],
  );
  return inserted.rows[0] as Eyepiece;
}

export async function addBarlow(accountId: string, body: Record<string, unknown>): Promise<Barlow> {
  const name = readName(body.name);
  const factor = readNumber(body.factor);
  const errors = new FieldErrors();
  if (name === null) errors.add('name');
  if (!inRange(factor, 1.1, 5.0)) errors.add('factor');
  errors.throwIfAny();

  const inserted = await query<Barlow>(
    `INSERT INTO barlows (id, account_id, name, factor) VALUES ($1,$2,$3,$4)
     RETURNING id, name, factor`,
    [randomUUID(), accountId, name, factor],
  );
  return inserted.rows[0] as Barlow;
}

export async function readSites(accountId: string): Promise<Site[]> {
  const found = await query<Site>(
    `SELECT id, name, latitude, longitude, time_zone FROM sites
     WHERE account_id = $1 ORDER BY seq`,
    [accountId],
  );
  return found.rows;
}

export async function addSite(accountId: string, body: Record<string, unknown>): Promise<Site> {
  const name = readName(body.name);
  const latitude = readNumber(body.latitude);
  const longitude = readNumber(body.longitude);
  const timeZone = body.time_zone;
  const errors = new FieldErrors();
  if (name === null) errors.add('name');
  if (!inRange(latitude, -90, 90)) errors.add('latitude');
  if (!inRange(longitude, -180, 180)) errors.add('longitude');
  if (!isTimeZone(timeZone)) errors.add('time_zone');
  errors.throwIfAny();

  const inserted = await query<Site>(
    `INSERT INTO sites (id, account_id, name, latitude, longitude, time_zone)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, latitude, longitude, time_zone`,
    [randomUUID(), accountId, name, latitude, longitude, timeZone as string],
  );
  return inserted.rows[0] as Site;
}
