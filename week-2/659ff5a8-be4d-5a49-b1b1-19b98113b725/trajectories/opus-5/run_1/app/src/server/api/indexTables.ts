import { randomUUID } from 'node:crypto';
import type { IndexTableDto } from '../../shared/api';
import { query } from '../db/pool';
import { isoUtc } from '../domain/clubTime';
import { formatFactor, parseFactor } from '../domain/decimal';
import { apiError } from '../http/errors';
import { json, memberRoute, type Route } from '../http/router';
import { FieldErrors, readDate } from '../http/validate';
import { clubOf, eventClasses, requireRole, type EventRecord } from './support';

const CLASS_PATTERN = /^[A-Z0-9]{1,6}$/;

interface TableRow {
  id: string;
  effective_date: string;
  factors: Record<string, string>;
  created_at: Date;
  created_by: string | null;
  created_by_name: string | null;
}

function tableDto(row: TableRow): IndexTableDto {
  return {
    id: row.id,
    effectiveDate: row.effective_date,
    factors: row.factors,
    createdAt: isoUtc(row.created_at),
    createdBy:
      row.created_by && row.created_by_name
        ? { id: row.created_by, name: row.created_by_name }
        : null,
  };
}

function readFactors(body: Record<string, unknown>, errors: FieldErrors): Record<string, string> {
  const raw = body.factors;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    errors.add('factors', 'Give at least one class and factor.');
    return {};
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) {
    errors.add('factors', 'Give at least one class and factor.');
    return {};
  }
  const factors: Record<string, string> = {};
  for (const [classCode, value] of entries) {
    if (!CLASS_PATTERN.test(classCode)) {
      errors.add('factors', `Class ${classCode} must be 1 to 6 uppercase letters or digits.`);
      continue;
    }
    const text = typeof value === 'string' ? value : '';
    const parsed = parseFactor(text);
    if (parsed === null) {
      errors.add('factors', `Factor for ${classCode} must be 0.4000 to 1.2000 with four decimals.`);
      continue;
    }
    factors[classCode] = formatFactor(parsed) as string;
  }
  return factors;
}

export const indexTableRoutes: Route[] = [
  memberRoute('GET', '/api/index-tables', async (ctx) => {
    const club = clubOf(ctx.actor);
    const rows = await query<TableRow>(
      `SELECT t.id, t.effective_date, t.factors, t.created_at, t.created_by, u.name AS created_by_name
         FROM index_tables t LEFT JOIN users u ON u.id = t.created_by
        WHERE t.club_id = $1 ORDER BY t.effective_date`,
      [club.id],
    );
    return json(200, { tables: rows.map(tableDto) });
  }),

  memberRoute('POST', '/api/index-tables', async (ctx) => {
    const club = clubOf(ctx.actor);
    requireRole(ctx.actor, 'chair');
    const errors = new FieldErrors();
    const effectiveDate = readDate(ctx.body, 'effectiveDate', 'Effective date', errors);
    const factors = readFactors(ctx.body, errors);
    errors.throwIfAny();

    const existing = await query<{ id: string }>(
      'SELECT id FROM index_tables WHERE club_id = $1 AND effective_date = $2',
      [club.id, effectiveDate],
    );
    if (existing.length > 0) {
      throw apiError.conflict(
        'effective_date_taken',
        `A table already starts on ${effectiveDate}.`,
      );
    }

    const laterEvents = await query<EventRecord & { timed_runs: string }>(
      `SELECT e.id, e.club_id, e.name, e.event_date, e.venue, e.registration_cutoff_local,
              e.registration_cutoff_utc, e.runs_per_driver, e.heats, e.stations, e.status,
              e.running_heat, e.provisional_at, e.protest_window_closes_at, e.version,
              e.published_at, e.results_checksum,
              (SELECT count(*) FROM runs n JOIN registrations r ON r.id = n.registration_id
                 WHERE r.event_id = e.id AND n.status IN ('committed','corrected')) AS timed_runs
         FROM events e
        WHERE e.club_id = $1 AND e.event_date >= $2
        ORDER BY e.event_date`,
      [club.id, effectiveDate],
    );

    if (laterEvents.some((event) => Number(event.timed_runs) > 0)) {
      throw apiError.conflict(
        'effective_date_conflict',
        `An event on or after ${effectiveDate} already has timed runs.`,
      );
    }

    const missing = new Set<string>();
    for (const event of laterEvents) {
      for (const classCode of eventClasses(event)) {
        if (factors[classCode] === undefined) missing.add(classCode);
      }
    }
    if (missing.size > 0) {
      throw apiError.conflict(
        'classes_in_use',
        `Missing classes used by later events: ${[...missing].sort().join(', ')}.`,
      );
    }

    const id = randomUUID();
    const inserted = await query<TableRow>(
      `INSERT INTO index_tables (id, club_id, effective_date, factors, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING id, effective_date, factors, created_at, created_by,
                 (SELECT name FROM users WHERE id = $5) AS created_by_name`,
      [id, club.id, effectiveDate, JSON.stringify(factors), ctx.actor.id],
    );
    const row = inserted[0];
    if (!row) throw new Error('Index table insert returned no row');
    return json(201, { table: tableDto(row) });
  }),
];
