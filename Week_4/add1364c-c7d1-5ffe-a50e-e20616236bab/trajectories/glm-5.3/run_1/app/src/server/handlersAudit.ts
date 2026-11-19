import type { Ctx } from './apiRoutes.js';
import { ApiError, conflict, invalid, notFound } from './errors.js';
import { jsonOk } from './http.js';
import { requireRole } from './handlersCore.js';
import { decodeCursor, encodeCursor } from './domain/audit.js';
import { officeDateString, parseOfficeDate } from './officeTime.js';

/**
 * The paged audit sheet. Pages by opaque keyset cursor: following the cursors
 * from a first page returns every entry of that day committed before the first
 * page was requested, exactly once, even while new entries are written.
 */
export async function getAudit(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager', 'managing_partner');
  const dayRaw = ctx.url.searchParams.get('day') ?? '';
  const orderRaw = ctx.url.searchParams.get('order') ?? 'oldest';
  const limitRaw = ctx.url.searchParams.get('limit') ?? '50';
  const afterRaw = ctx.url.searchParams.get('after');
  const now = ctx.store.clock.now();
  const today = officeDateString(now);
  const day = dayRaw === '' ? today : dayRaw;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || parseOfficeDate(day) === null) {
    // A missing or invalid value is replaced by office today.
    if (dayRaw !== '') {
      jsonOk(ctx.res, 200, { office_day: today, order: orderRaw === 'newest' ? 'newest' : 'oldest', entries: [], next_cursor: null });
      return;
    }
    throw invalid({ day: 'Give the office day as a real date.' });
  }
  if (orderRaw !== 'oldest' && orderRaw !== 'newest') {
    throw invalid({ order: 'Give the order as oldest or newest.' });
  }
  const limit = Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw invalid({ limit: 'Give a whole number from 1 to 100.' });
  }
  const order = orderRaw as 'oldest' | 'newest';
  let afterSeq: number | null = null;
  if (afterRaw !== null && afterRaw !== undefined) {
    const decoded = decodeCursor(afterRaw);
    if (decoded === null || decoded.day !== day || decoded.order !== order) {
      throw invalid({ after: 'This page link has expired. Start from the first page.' });
    }
    afterSeq = decoded.seq;
  }
  const params = afterSeq === null ? [day, limit] : [day, afterSeq, limit];
  const where = afterSeq === null ? '' : ' AND seq > $2';
  const rows = await ctx.store.pool.query(
    `SELECT * FROM audit_entries WHERE office_day = $1${where} ORDER BY seq ASC LIMIT $${params.length}`,
    params
  );
  const fetched = rows.rows;
  let entries = fetched.map(mapAuditRow);
  if (order === 'newest') {
    entries = [...entries].reverse();
  }
  const hasMore = fetched.length === limit;
  const nextCursor = hasMore && fetched.length > 0 ? encodeCursor(day, order, Number(fetched[fetched.length - 1].seq)) : null;
  jsonOk(ctx.res, 200, {
    office_day: day,
    order,
    entries,
    next_cursor: nextCursor
  });
}

function mapAuditRow(row: Record<string, unknown>): Record<string, unknown> {
  const actorPersonId = row.actor_person_id as string | null;
  const actorName = row.actor_name as string;
  return {
    id: String(row.id),
    seq: Number(row.seq),
    at: new Date(row.at as string).toISOString(),
    office_day: String(row.office_day),
    office_time: String(row.office_time),
    offset: String(row.offset),
    actor: actorPersonId ? { person_id: actorPersonId, name: actorName } : { system: 'Lockset' },
    action: String(row.action),
    subject: { kind: String(row.subject_kind), id: String(row.subject_id ?? ''), name: String(row.subject_name ?? '') },
    details: (row.details as Record<string, unknown>) ?? {}
  };
}

/** The back of the drawer: the newest ten entries of the office day. */
export async function getAuditFooter(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager', 'managing_partner');
  const day = officeDateString(ctx.store.clock.now());
  const rows = await ctx.store.pool.query(
    'SELECT * FROM audit_entries WHERE office_day = $1 ORDER BY seq DESC LIMIT 10',
    [day]
  );
  const entries = rows.rows.map(mapAuditRow).reverse();
  jsonOk(ctx.res, 200, {
    office_day: day,
    entries
  });
}
