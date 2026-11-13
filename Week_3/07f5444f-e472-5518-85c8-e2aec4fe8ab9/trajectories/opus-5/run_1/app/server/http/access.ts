import type { ProgrammeStatus, Role } from '../../shared/api.js';
import type { ProgrammeAggregate } from '../data/programmes.js';
import { loadProgrammeAggregate, loadRoster } from '../data/programmes.js';
import type { Queryable } from '../db/pool.js';
import { PROGRAMME_STATUS_LABELS } from '../domain/transitions.js';
import type { ViewContext } from '../view/programme-view.js';
import type { Person, RequestContext } from './context.js';
import type { ApiError } from './errors.js';
import { conflict, forbidden, notFound, validation } from './errors.js';

export function requireRole(person: Person, roles: readonly Role[]): void {
  if (!roles.includes(person.role)) throw forbidden();
}

/** Programmes, works, parts, cuts, scans and rental sets are unknown to players. */
export function requireDeskVisibility(person: Person): void {
  if (person.role === 'player') throw notFound();
}

export async function visibleProgramme(
  db: Queryable,
  person: Person,
  programmeId: string,
): Promise<ProgrammeAggregate> {
  requireDeskVisibility(person);
  const aggregate = await loadProgrammeAggregate(db, programmeId);
  if (!aggregate) throw notFound();
  return aggregate;
}

export async function viewContext(db: Queryable, context: RequestContext): Promise<ViewContext> {
  return { nowMs: context.nowMs, roster: await loadRoster(db) };
}

/** While a programme is closed its counts, cuts, holdings and marks cannot change. */
export function requireNotClosed(aggregate: ProgrammeAggregate): void {
  if (aggregate.row.status === 'closed') {
    throw conflict('programme_closed', "This programme is closed. Its counts and cuts can't change.");
  }
}

export function programmeNumber(aggregate: ProgrammeAggregate): string {
  return String(aggregate.row.number).padStart(2, '0');
}

export function illegalProgrammeTransition(
  number: string,
  from: ProgrammeStatus,
  to: ProgrammeStatus,
): ApiError {
  return conflict(
    'illegal_transition',
    `Programme ${number} can't move from ${PROGRAMME_STATUS_LABELS[from]} to ${PROGRAMME_STATUS_LABELS[to]}.`,
  );
}

const VISIBLE_ASCII = /^[\x20-\x7e]{1,80}$/;

export function requireIdempotencyKey(context: RequestContext): string {
  const header = context.request.headers['idempotency-key'];
  const key = Array.isArray(header) ? header[0] : header;
  if (typeof key !== 'string' || !VISIBLE_ASCII.test(key)) {
    throw validation({ idempotency_key: 'Send an Idempotency-Key of 1 to 80 visible ASCII characters.' });
  }
  return key;
}

export function optionalIdempotencyKey(context: RequestContext): string | null {
  const header = context.request.headers['idempotency-key'];
  const key = Array.isArray(header) ? header[0] : header;
  if (key === undefined) return null;
  if (typeof key !== 'string' || !VISIBLE_ASCII.test(key)) {
    throw validation({ idempotency_key: 'Send an Idempotency-Key of 1 to 80 visible ASCII characters.' });
  }
  return key;
}
