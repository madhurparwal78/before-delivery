import { ReceiptRow, findMember, findReceipt } from '../data';
import { query } from '../db';
import { invalid, notFound } from '../http/errors';
import { Route, defineRoute, person } from '../http/kernel';
import { copy } from '../shared/copy';
import { HistoryResult, resultsHistoryCsv } from '../domain/resultsHistory';
import { enforceRateLimit, recordRateEvent } from './rateLimits';
import { requireMember } from './members';
import { resultsForMember } from './results';
import { receiptListItem, receiptView } from './views';

const PAGE_SIZE = 25;

async function memberNameOf(memberId: string): Promise<string | null> {
  const member = await findMember(memberId);
  if (!member || member.account_state === 'erased') return null;
  return member.name;
}

export const recordRoutes: Route[] = [
  defineRoute({
    method: 'GET',
    path: '/api/me/results-history',
    access: ['member'],
    rateLimit: (ctx) => enforceRateLimit(ctx, 'file'),
    handler: async (ctx) => {
      const member = await requireMember(person(ctx).id);
      const markers = await resultsForMember(member, true);
      const results: HistoryResult[] = markers
        .flatMap((marker, markerIndex) =>
          marker.draws.map((entry) => ({
            markerIndex,
            collectedAt: entry.collectedAt,
            result: {
              marker: marker.marker,
              collectedAt: entry.collectedAt,
              value: entry.value,
              flag: entry.flag,
              range: entry.range,
              note: entry.note,
            },
          })),
        )
        .sort(
          (left, right) =>
            left.collectedAt.localeCompare(right.collectedAt) ||
            left.markerIndex - right.markerIndex,
        )
        .map((entry) => entry.result);
      await recordRateEvent(member, 'file');
      return {
        status: 200,
        bytes: Buffer.from(resultsHistoryCsv(results, member.time_zone), 'utf8'),
        contentType: 'text/csv; charset=utf-8',
        headers: {
          'Content-Disposition': 'attachment; filename="ocotillo-results-history.csv"',
        },
      };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/receipts',
    access: ['owner', 'billingLead'],
    handler: async (ctx) => {
      const month = ctx.query.get('month') ?? '';
      const cursor = ctx.query.get('cursor');
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw invalid({ month: copy.fieldMonthForm });
      if (cursor !== null && !/^\d+$/.test(cursor)) {
        throw invalid({ cursor: copy.cursorInvalid });
      }
      const after = cursor === null ? 0 : Number(cursor);
      const rows = await query<ReceiptRow>(
        `select * from receipts
         where to_char(paid_date, 'YYYY-MM') = $1 and number_seq > $2
         order by number_seq limit ${PAGE_SIZE + 1}`,
        [month, after],
      );
      const page = rows.slice(0, PAGE_SIZE);
      const receipts = [];
      for (const receipt of page) {
        receipts.push(receiptListItem(receipt, await memberNameOf(receipt.member_id)));
      }
      const last = page[page.length - 1];
      return {
        status: 200,
        json: {
          receipts,
          nextCursor: rows.length > PAGE_SIZE && last ? String(last.number_seq) : null,
        },
      };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/receipts/:receiptId',
    access: ['owner', 'billingLead', 'member'],
    resolve: async (ctx) => {
      const receipt = await findReceipt(ctx.params.receiptId as string);
      if (!receipt) throw notFound();
      const who = person(ctx);
      if (who.role === 'member' && receipt.member_id !== who.id) throw notFound();
      return receipt;
    },
    handler: async (_ctx, receipt) => ({
      status: 200,
      json: { receipt: receiptView(receipt, await memberNameOf(receipt.member_id)) },
    }),
  }),
  defineRoute({
    method: 'GET',
    path: '/api/me/receipts',
    access: ['member'],
    handler: async (ctx) => {
      const rows = await query<ReceiptRow>(
        'select * from receipts where member_id = $1 order by number_seq desc',
        [person(ctx).id],
      );
      const receipts = [];
      for (const receipt of rows) {
        receipts.push(receiptListItem(receipt, await memberNameOf(receipt.member_id)));
      }
      return { status: 200, json: { receipts } };
    },
  }),
];
