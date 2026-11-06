/** Public endpoints: health, clock, session calendar, board, computations, citations. */
import { transact } from '../db';
import { ApiResponse, RequestContext } from '../http';
import { fail } from '../errors';
import { formatDateString, parseDateString, toIso } from '../../shared/nytime';
import { sessionDayFor } from '../../domain/calendar';
import { isRehearsalClock, marketClockNow } from '../marketClock';
import { buildBoard } from '../board';
import { computationById } from '../computations';
import { resolveCitation } from '../citations';
import { processDueSessionCloses } from '../sessionClose';

export function getHealth(): ApiResponse {
  return { status: 200, json: { status: 'ok' } };
}

export async function getClock(): Promise<ApiResponse> {
  const nowMs = await marketClockNow();
  return { status: 200, json: { now: toIso(nowMs), rehearsal: await isRehearsalClock() } };
}

export async function getSessionCalendar(context: RequestContext): Promise<ApiResponse> {
  const raw = context.searchParams.get('date') ?? '';
  const date = parseDateString(raw);
  if (date === null || date.year !== 2026) {
    throw fail('validation_failed', { fields: { date: 'Enter a date in 2026 as YYYY-MM-DD.' } });
  }
  const day = sessionDayFor(date);
  return {
    status: 200,
    json: {
      date: formatDateString(date),
      trading_day: day.tradingDay,
      holiday: day.holiday,
      opens_at: day.opensAt === null ? null : toIso(day.opensAt),
      closes_at: day.closesAt === null ? null : toIso(day.closesAt),
      early_close: day.earlyClose,
    },
  };
}

export async function getBoard(): Promise<ApiResponse> {
  await processDueSessionCloses();
  return { status: 200, json: await buildBoard() };
}

export async function getComputation(context: RequestContext): Promise<ApiResponse> {
  const computation = await transact((tx) => computationById(tx, context.params.id ?? ''));
  if (computation === null) throw fail('not_found');
  return { status: 200, json: { computation } };
}

export async function getCitation(context: RequestContext): Promise<ApiResponse> {
  await processDueSessionCloses();
  const result = await resolveCitation(context.params.figure ?? '', context.params.date ?? '');
  if (result === null) throw fail('not_found');
  return {
    status: 200,
    json: {
      citation: { figure: result.figure, date: result.date, provisional: result.provisional },
      computation: result.computation,
    },
  };
}
