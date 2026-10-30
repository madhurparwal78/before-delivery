import { FIELD_COPY } from '../../shared/errors.js';
import { isLocalDate, type LocalDate } from '../../domain/calendar.js';
import type { AppContext } from '../core/context.js';
import { isStaff } from '../core/present.js';
import { findHold, findLoan, type HoldRecord, type LoanRecord } from '../core/records.js';
import { fail, failValidation } from '../http/apiError.js';
import type { SessionResolveContext } from '../http/context.js';

/** Members may see only their own records; an invisible id answers not found. */
export async function resolveHold(
  app: AppContext,
  context: SessionResolveContext,
): Promise<HoldRecord> {
  const hold = await findHold(app.pool, context.params['holdId'] ?? '');
  if (hold === null) throw fail('not_found');
  if (!isStaff(context.caller) && hold.memberId !== context.caller.id) throw fail('not_found');
  return hold;
}

export async function resolveLoan(
  app: AppContext,
  context: SessionResolveContext,
): Promise<LoanRecord> {
  const loan = await findLoan(app.pool, context.params['loanId'] ?? '');
  if (loan === null) throw fail('not_found');
  if (!isStaff(context.caller) && loan.memberId !== context.caller.id) throw fail('not_found');
  return loan;
}

export function readString(json: Record<string, unknown>, field: string): string | null {
  const value = json[field];
  return typeof value === 'string' ? value : null;
}

export function readInteger(json: Record<string, unknown>, field: string): number | null {
  const value = json[field];
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export function readDate(json: Record<string, unknown>, field: string): LocalDate | null {
  const value = json[field];
  return typeof value === 'string' && isLocalDate(value) ? value : null;
}

export function readInstant(json: Record<string, unknown>, field: string): Date | null {
  const value = json[field];
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

export interface PageParameters {
  readonly limit: number;
  readonly cursor: string | null;
}

export function readPageParameters(query: URLSearchParams): PageParameters {
  const rawLimit = query.get('limit');
  let limit = 20;
  if (rawLimit !== null) {
    if (!/^\d{1,3}$/.test(rawLimit)) throw failValidation({ limit: FIELD_COPY.limit });
    limit = Number(rawLimit);
    if (limit < 1 || limit > 50) throw failValidation({ limit: FIELD_COPY.limit });
  }
  return { limit, cursor: query.get('cursor') };
}
