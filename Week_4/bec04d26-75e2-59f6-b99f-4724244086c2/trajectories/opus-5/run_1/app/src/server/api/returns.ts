import { ReturnRecord, ReturnStatus, STATUS_ORDER } from '../../shared/types';
import {
  accessibleReturnRow,
  amend,
  approve,
  Caller,
  file,
  grantExtension,
  prepare,
  saveAmounts,
  sendBack,
} from '../actions/returns';
import { query } from '../db';
import { MESSAGES } from '../domain/messages';
import {
  callerForRecord,
  Ctx,
  requireBookkeeper,
  requireSession,
  sendJson,
} from '../http/context';
import * as errors from '../http/errors';
import { getPractice, practiceNow } from '../repo/practice';
import {
  countReturns,
  loadReminders,
  loadReturnRows,
  presentReturns,
  ReturnFilter,
} from '../repo/returns';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR_RE = /^\d{4}$/;

function statusFilter(value: string | null): ReturnStatus | 'overdue' | null {
  if (!value) return null;
  if (value === 'overdue') return 'overdue';
  return (STATUS_ORDER as string[]).includes(value) ? (value as ReturnStatus) : null;
}

function applyStatusFilter(
  records: readonly ReturnRecord[],
  status: ReturnStatus | 'overdue' | null,
): ReturnRecord[] {
  if (!status) return [...records];
  if (status === 'overdue') return records.filter((record) => record.overdue);
  return records.filter((record) => record.status === status);
}

interface ListQuery {
  filter: ReturnFilter;
  status: ReturnStatus | 'overdue' | null;
  clientFilter: string | null;
}

function readListQuery(ctx: Ctx): ListQuery {
  const month = ctx.url.searchParams.get('month');
  const year = ctx.url.searchParams.get('year');
  const fieldErrors: Record<string, string> = {};
  if (month !== null && !MONTH_RE.test(month)) fieldErrors.month = MESSAGES.month;
  if (year !== null && !YEAR_RE.test(year)) fieldErrors.year = MESSAGES.year;
  if (Object.keys(fieldErrors).length > 0) throw errors.validation(fieldErrors);
  const filter: ReturnFilter = {};
  if (month !== null) filter.month = month;
  else if (year !== null) filter.year = year;
  const state = ctx.url.searchParams.get('state');
  if (state) filter.stateCode = state;
  return {
    filter,
    status: statusFilter(ctx.url.searchParams.get('status')),
    clientFilter: ctx.url.searchParams.get('client'),
  };
}

export async function listReturns(ctx: Ctx): Promise<void> {
  const user = requireSession(ctx);
  const practice = await getPractice(user.practice_id);
  if (!practice) throw errors.notFound();
  const nowMs = practiceNow(practice);
  const listQuery = readListQuery(ctx);
  const filter: ReturnFilter = { ...listQuery.filter };
  if (user.role === 'owner') filter.clientId = user.client_id;
  else if (listQuery.clientFilter) filter.clientId = listQuery.clientFilter;
  const rows = await loadReturnRows(user.practice_id, filter);
  const records = applyStatusFilter(await presentReturns(rows, nowMs), listQuery.status);
  sendJson(ctx.res, 200, { returns: records, counts: countReturns(records) });
}

async function readReturn(ctx: Ctx): Promise<{ caller: Caller; record: ReturnRecord }> {
  const caller = callerForRecord(ctx);
  const row = await accessibleReturnRow(caller, ctx.params.id);
  const practice = await getPractice(caller.practiceId);
  if (!practice) throw errors.notFound();
  const [record] = await presentReturns([row], practiceNow(practice));
  return { caller, record };
}

export async function getReturn(ctx: Ctx): Promise<void> {
  const { record } = await readReturn(ctx);
  sendJson(ctx.res, 200, record);
}

/** The published order: anything the caller cannot open before any role check. */
async function writeCaller(ctx: Ctx, role: 'bookkeeper' | 'owner'): Promise<Caller> {
  const caller = callerForRecord(ctx);
  await accessibleReturnRow(caller, ctx.params.id);
  if (caller.role !== role) throw errors.forbidden();
  return caller;
}

export async function patchReturn(ctx: Ctx): Promise<void> {
  const caller = await writeCaller(ctx, 'bookkeeper');
  sendJson(ctx.res, 200, await saveAmounts(caller, ctx.params.id, bodyOf(ctx)));
}

export async function prepareReturn(ctx: Ctx): Promise<void> {
  const caller = await writeCaller(ctx, 'bookkeeper');
  sendJson(ctx.res, 200, await prepare(caller, ctx.params.id, bodyOf(ctx)));
}

export async function approveReturn(ctx: Ctx): Promise<void> {
  const caller = await writeCaller(ctx, 'owner');
  sendJson(ctx.res, 200, await approve(caller, ctx.params.id, bodyOf(ctx)));
}

export async function sendBackReturn(ctx: Ctx): Promise<void> {
  const caller = await writeCaller(ctx, 'owner');
  sendJson(ctx.res, 200, await sendBack(caller, ctx.params.id, bodyOf(ctx)));
}

export async function fileReturn(ctx: Ctx): Promise<void> {
  const caller = await writeCaller(ctx, 'bookkeeper');
  sendJson(ctx.res, 200, await file(caller, ctx.params.id, bodyOf(ctx)));
}

export async function extendReturn(ctx: Ctx): Promise<void> {
  const caller = await writeCaller(ctx, 'bookkeeper');
  sendJson(ctx.res, 200, await grantExtension(caller, ctx.params.id, bodyOf(ctx)));
}

export async function amendReturn(ctx: Ctx): Promise<void> {
  const caller = await writeCaller(ctx, 'bookkeeper');
  sendJson(ctx.res, 200, await amend(caller, ctx.params.id, bodyOf(ctx)));
}

export async function getReminders(ctx: Ctx): Promise<void> {
  await writeCaller(ctx, 'bookkeeper');
  sendJson(ctx.res, 200, await loadReminders(ctx.params.id));
}

export async function getPacket(ctx: Ctx): Promise<void> {
  const caller = callerForRecord(ctx);
  await accessibleReturnRow(caller, ctx.params.id);
  const asked = ctx.url.searchParams.get('revision');
  if (asked !== null) {
    if (!/^\d+$/.test(asked)) throw errors.notFound();
    const rows = await query<{ bytes: Buffer }>(
      'SELECT bytes FROM packet_revisions WHERE return_id = $1 AND revision = $2',
      [ctx.params.id, Number(asked)],
    );
    if (rows.length === 0) throw errors.notFound();
    sendPdf(ctx, rows[0].bytes, Number(asked));
    return;
  }
  const newest = await query<{ bytes: Buffer; revision: number }>(
    'SELECT bytes, revision FROM packet_revisions WHERE return_id = $1 ORDER BY revision DESC LIMIT 1',
    [ctx.params.id],
  );
  if (newest.length === 0) throw errors.packetPending();
  sendPdf(ctx, newest[0].bytes, newest[0].revision);
}

function sendPdf(ctx: Ctx, bytes: Buffer, revision: number): void {
  ctx.res.writeHead(200, {
    'content-type': 'application/pdf',
    'content-length': bytes.length,
    'content-disposition': `inline; filename="duefield-packet-${revision}.pdf"`,
    'cache-control': 'no-store',
  });
  ctx.res.end(bytes);
}

function bodyOf(ctx: Ctx): Record<string, unknown> {
  return ctx.body !== null && typeof ctx.body === 'object' && !Array.isArray(ctx.body)
    ? (ctx.body as Record<string, unknown>)
    : {};
}

const CSV_HEADER =
  'client,state,period,status,overdue,due_at,zone,gross_sales,tax_due,rate,edition_effective_date';

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function csvBody(records: readonly ReturnRecord[]): string {
  const lines = [CSV_HEADER];
  for (const record of records) {
    lines.push(
      [
        record.client.name,
        record.state,
        record.period,
        record.status,
        record.overdue ? 'true' : 'false',
        record.due_at,
        record.zone,
        record.gross_sales ?? '',
        record.tax_due ?? '',
        record.edition.rate,
        record.edition.effective_date,
      ]
        .map(csvField)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

export async function exportCsv(ctx: Ctx): Promise<void> {
  const user = requireBookkeeper(ctx);
  const practice = await getPractice(user.practice_id);
  if (!practice) throw errors.notFound();
  const year = ctx.params.year;
  if (!YEAR_RE.test(year)) throw errors.notFound();
  const filter: ReturnFilter = { year };
  const state = ctx.url.searchParams.get('state');
  if (state) filter.stateCode = state;
  const rows = await loadReturnRows(user.practice_id, filter);
  const records = applyStatusFilter(
    await presentReturns(rows, practiceNow(practice)),
    statusFilter(ctx.url.searchParams.get('status')),
  );
  const payload = Buffer.from(csvBody(records), 'utf8');
  ctx.res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-length': payload.length,
    'content-disposition': `attachment; filename="duefield-${year}.csv"`,
    'cache-control': 'no-store',
  });
  ctx.res.end(payload);
}
