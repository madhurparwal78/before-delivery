import { withTransaction } from '../../db';
import { loadPerformances, withPublicTiers } from '../../domain/performances';
import { loadCart } from '../../domain/cart';
import { loadSeats } from '../../domain/seats';
import { loadEntries } from '../../domain/waitlist';
import { isSchemaReady } from '../../ready';
import type { RequestContext } from '../context';
import { type ApiResponse, error, json } from '../respond';

export async function health(): Promise<ApiResponse> {
  return isSchemaReady() ? json(200, { status: 'ok' }) : json(503, { status: 'starting' });
}

export async function listPerformances(): Promise<ApiResponse> {
  const performances = await withTransaction((db) => loadPerformances(db, null));
  return json(200, { performances: performances.map(withPublicTiers) });
}

export async function showPerformance(context: RequestContext): Promise<ApiResponse> {
  const performanceId = context.params.performanceId ?? '';
  const performances = await withTransaction((db) => loadPerformances(db, performanceId));
  const performance = performances[0];
  if (!performance) return error(404, 'not_found');
  return json(200, withPublicTiers(performance));
}

export async function listSeats(context: RequestContext): Promise<ApiResponse> {
  const performanceId = context.params.performanceId ?? '';
  return withTransaction(async (db) => {
    const performances = await loadPerformances(db, performanceId);
    if (performances.length === 0) return error(404, 'not_found');
    return json(200, { seats: await loadSeats(db, performanceId, context.buyerId) });
  });
}

export async function showCart(context: RequestContext): Promise<ApiResponse> {
  const performanceId = context.params.performanceId ?? '';
  return withTransaction(async (db) => {
    const performances = await loadPerformances(db, performanceId);
    if (performances.length === 0) return error(404, 'not_found');
    return json(200, await loadCart(db, performanceId, context.buyerId));
  });
}

export async function listWaitlist(context: RequestContext): Promise<ApiResponse> {
  const entries = await withTransaction((db) => loadEntries(db, context.buyerId));
  return json(200, { entries });
}
