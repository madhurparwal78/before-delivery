import * as copy from '../../../shared/copy';
import type { FeeRules, Loan, LoanStatus } from '../../../shared/types';
import { parseTimestamp, today } from '../../../shared/time';
import {
  cancelLoanConflict,
  checkoutConflict,
  hangConflict,
  reserveItemConflict,
  takeDownConflict,
} from '../../domain/transitions';
import { pool, withTransaction } from '../../repo/db';
import { readCalendar, readSettings } from '../../repo/calendar';
import {
  lockItems,
  readBoard,
  readCounts,
  readItem,
  setItemPartsState,
  setPartState,
} from '../../repo/inventory';
import {
  deleteLoan,
  insertReservedLoan,
  listLoanRows,
  loanView,
  lockLoanRow,
  readLoanItems,
  readLoanParts,
  readLoanRow,
  readPhotoRow,
  recordCheckout,
  setLoanStatus,
} from '../../repo/loans';
import { findUserById, isMemberActive } from '../../repo/users';
import { storageProbe } from '../../services/status';
import { getPhotoObject, StorageUnreachable } from '../../services/storage';
import { promoteHoldForItem } from '../../actions/hold-promotion';
import * as fail from '../errors';
import { FieldProblems } from '../errors';
import { jsonReply, type Reply, type Route } from '../pipeline';
import { readArray, readInteger } from '../validate';
import { storePhoto, validatePhotoUpload } from './photos';

function staffOnly(role: string | null): void {
  if (role === 'member' || role === null) throw fail.staffOnly();
}

function storageDown(message: string): never {
  storageProbe.markDown();
  throw fail.providerDown(message);
}

async function loanIsVisible(ctx: { role: string | null; userId: number }, loanId: number): Promise<boolean> {
  const row = await readLoanRow(pool, loanId);
  if (!row) return false;
  return ctx.role !== 'member' || row.member_id === ctx.userId;
}

export const boardRoute: Route = {
  method: 'GET',
  pattern: '/api/board',
  body: 'json',
  auth: 'anyone',
  run: async (): Promise<Reply> => jsonReply(200, await readBoard(pool)),
};

export const listLoansRoute: Route = {
  method: 'GET',
  pattern: '/api/loans',
  body: 'json',
  auth: 'signed-in',
  resolve: async (ctx) => {
    const user = ctx.requireUser();
    const requested = ctx.query.get('member_id');
    if (user.role === 'member' && requested !== null && Number(requested) !== user.id) {
      throw fail.notFound();
    }
    return undefined;
  },
  run: async (ctx): Promise<Reply> => {
    const user = ctx.requireUser();
    const calendar = await readCalendar(pool);
    const requestedMember = ctx.query.get('member_id');
    const status = ctx.query.get('status');
    const rows = await listLoanRows(pool, {
      memberId:
        user.role === 'member'
          ? user.id
          : requestedMember !== null
            ? Number(requestedMember)
            : undefined,
      status: status !== null ? (status as LoanStatus) : undefined,
    });
    const loans: Loan[] = [];
    for (const row of rows) loans.push(await loanView(pool, row, calendar, ctx.now));
    return jsonReply(200, { loans });
  },
};

export const readLoanRoute: Route<{ id: number }> = {
  method: 'GET',
  pattern: '/api/loans/:id',
  body: 'json',
  auth: 'signed-in',
  resolve: async (ctx) => {
    const user = ctx.requireUser();
    const id = ctx.pathId('id');
    if (!(await loanIsVisible({ role: user.role, userId: user.id }, id))) throw fail.notFound();
    return { id };
  },
  run: async (ctx, resolved): Promise<Reply> => {
    const calendar = await readCalendar(pool);
    const row = await readLoanRow(pool, resolved.id);
    if (!row) throw fail.notFound();
    return jsonReply(200, { loan: await loanView(pool, row, calendar, ctx.now) });
  },
};

export const reserveLoanRoute: Route<{ memberId: number; itemIds: number[] }> = {
  method: 'POST',
  pattern: '/api/loans',
  body: 'json',
  auth: 'signed-in',
  resolve: async (ctx) => {
    const memberId = ctx.peekId('member_id');
    if (memberId !== null) {
      const user = await findUserById(pool, memberId);
      if (!user || user.role !== 'member') throw fail.notFound();
    }
    const rawItems = ctx.peekJson()?.item_ids;
    const itemIds: number[] = [];
    if (Array.isArray(rawItems)) {
      for (const value of rawItems) {
        if (typeof value === 'number' && Number.isInteger(value)) {
          if (!(await readItem(pool, value))) throw fail.notFound();
          itemIds.push(value);
        }
      }
    }
    return { memberId: memberId ?? 0, itemIds };
  },
  role: (ctx) => {
    staffOnly(ctx.role);
    if (ctx.role !== 'coordinator' && ctx.peekJson()?.checked_out_at !== undefined) {
      throw fail.coordinatorOnly();
    }
  },
  run: async (ctx): Promise<Reply> => {
    const body = ctx.json();
    const memberId = readInteger(body, 'member_id');
    const itemIds = readArray(body, 'item_ids');
    const problems = new FieldProblems();
    if (memberId === null) problems.add('member_id', 'Choose a member.');
    const wholeIds =
      itemIds !== null &&
      itemIds.every((value) => typeof value === 'number' && Number.isInteger(value));
    if (itemIds === null || itemIds.length === 0) {
      problems.add('item_ids', 'Add at least one tool.');
    } else if (!wholeIds) {
      problems.add('item_ids', 'Add tools by their ids.');
    } else if (itemIds.length > 10) {
      problems.add('item_ids', 'A loan takes at most ten tools.');
    } else if (new Set(itemIds).size !== itemIds.length) {
      problems.add('item_ids', 'Each tool can be added once.');
    }
    let checkedOutAt: Date | null = null;
    if (body.checked_out_at !== undefined) {
      const raw = typeof body.checked_out_at === 'string' ? body.checked_out_at : '';
      const parsed = parseTimestamp(raw);
      if (parsed === null) {
        problems.add('checked_out_at', 'Give an ISO 8601 time with an offset.');
      } else if (parsed.getTime() > ctx.now.getTime()) {
        problems.add('checked_out_at', 'That time is in the future.');
      } else if (parsed.getTime() < ctx.now.getTime() - 120 * 86400000) {
        problems.add('checked_out_at', 'That time is more than 120 days ago.');
      } else {
        checkedOutAt = parsed;
      }
    }
    problems.throwIfAny();

    const requestedItems = itemIds as number[];
    return withTransaction(async (client) => {
      const calendar = await readCalendar(client);
      await lockItems(client, requestedItems);
      if (!(await isMemberActive(client, memberId as number, today(calendar.timeZone, ctx.now)))) {
        throw fail.conflict(copy.MEMBER_NOT_ACTIVE_RESERVE);
      }
      for (const itemId of requestedItems) {
        const item = await readItem(client, itemId);
        if (!item) throw fail.notFound();
        const readyHold = await client.query<{ member_id: number }>(
          "select member_id from holds where item_id = $1 and status = 'ready'",
          [itemId],
        );
        const heldForThisMember = readyHold.rows[0]?.member_id === memberId;
        const conflict = reserveItemConflict(item.tag, item.status, heldForThisMember);
        if (conflict) throw fail.conflict(conflict);
      }
      const row = await insertReservedLoan(client, memberId as number, requestedItems);
      if (checkedOutAt) {
        await client.query('update loans set checked_out_at = $2 where id = $1', [
          row.id,
          checkedOutAt.toISOString(),
        ]);
      }
      const stored = await readLoanRow(client, row.id);
      if (!stored) throw fail.notFound();
      return jsonReply(201, { loan: await loanView(client, stored, calendar, ctx.now) });
    });
  },
};

export const cancelLoanRoute: Route<{ id: number }> = {
  method: 'DELETE',
  pattern: '/api/loans/:id',
  body: 'json',
  auth: 'signed-in',
  resolve: async (ctx) => {
    const id = ctx.pathId('id');
    if (!(await readLoanRow(pool, id))) throw fail.notFound();
    return { id };
  },
  role: (ctx) => staffOnly(ctx.role),
  run: async (ctx, resolved): Promise<Reply> => {
    return withTransaction(async (client) => {
      const row = await lockLoanRow(client, resolved.id);
      if (!row) throw fail.notFound();
      const conflict = cancelLoanConflict(row.status);
      if (conflict) throw fail.conflict(conflict);
      const items = await readLoanItems(client, row.id);
      const calendar = await readCalendar(client);
      await deleteLoan(client, row.id);
      for (const item of items) {
        const readyHold = await client.query<{ id: number }>(
          "select id from holds where item_id = $1 and status = 'ready'",
          [item.id],
        );
        if (readyHold.rows.length === 0) {
          await promoteHoldForItem(client, item.id, calendar, ctx.now);
        }
      }
      return { kind: 'empty', status: 204 };
    });
  },
};

export const checkoutRoute: Route<{ id: number }> = {
  method: 'POST',
  pattern: '/api/loans/:id/checkout',
  body: 'multipart',
  auth: 'signed-in',
  resolve: async (ctx) => {
    const id = ctx.pathId('id');
    if (!(await readLoanRow(pool, id))) throw fail.notFound();
    return { id };
  },
  role: (ctx) => staffOnly(ctx.role),
  run: async (ctx, resolved): Promise<Reply> => {
    const form = ctx.multipart();
    const problems = new FieldProblems();
    const upload = validatePhotoUpload(
      problems,
      form.files.get('photo'),
      form.fields.get('captured_at'),
      ctx.now,
    );
    problems.throwIfAny();
    if (!upload) throw fail.invalid({ photo: 'Take or choose a photo.' });

    return withTransaction(async (client) => {
      const row = await lockLoanRow(client, resolved.id);
      if (!row) throw fail.notFound();
      const conflict = checkoutConflict(row.status);
      if (conflict) throw fail.conflict(conflict);
      const calendar = await readCalendar(client);
      const settings = await readSettings(client);
      const items = await readLoanItems(client, row.id);
      const checkedOutAt = row.checked_out_at ?? ctx.now;
      const replacementCosts: Record<string, number> = {};
      for (const item of items) {
        const stored = await readItem(client, item.id);
        if (stored) replacementCosts[String(item.id)] = stored.replacement_cost_cents;
      }
      const feeRules: FeeRules = {
        late_fee_cents: settings.late_fee_cents,
        damage_fee_cents: settings.damage_fee_cents,
        replacement_costs_cents: replacementCosts,
      };
      try {
        await storePhoto(client, row.id, row.ref, 'checkout', upload);
      } catch (error) {
        if (error instanceof StorageUnreachable) storageDown(copy.STORAGE_DOWN_CHECKOUT);
        throw error;
      }
      await recordCheckout(
        client,
        row.id,
        checkedOutAt,
        calendar.dueDateFor(checkedOutAt, settings.loan_period_days),
        feeRules,
      );
      await setItemPartsState(
        client,
        items.map((item) => item.id),
        'out',
      );
      for (const item of items) {
        await client.query(
          `update holds set status = 'collected' where item_id = $1 and member_id = $2
           and status = 'ready'`,
          [item.id, row.member_id],
        );
      }
      const stored = await readLoanRow(client, row.id);
      if (!stored) throw fail.notFound();
      return jsonReply(200, { loan: await loanView(client, stored, calendar, ctx.now) });
    });
  },
};

export const hangRoute: Route<{ loanId: number; partId: number; pegPartId: number }> = {
  method: 'POST',
  pattern: '/api/loans/:id/hang',
  body: 'json',
  auth: 'signed-in',
  resolve: async (ctx) => {
    const loanId = ctx.pathId('id');
    if (!(await readLoanRow(pool, loanId))) throw fail.notFound();
    const partId = ctx.peekId('part_id');
    const pegPartId = ctx.peekId('peg_part_id');
    if (partId !== null) {
      const parts = await readLoanParts(pool, loanId);
      if (!parts.some((part) => part.id === partId)) throw fail.notFound();
    }
    if (pegPartId !== null) {
      const known = await pool.query('select id from parts where id = $1', [pegPartId]);
      if (known.rows.length === 0) throw fail.notFound();
    }
    return { loanId, partId: partId ?? 0, pegPartId: pegPartId ?? 0 };
  },
  role: (ctx) => staffOnly(ctx.role),
  run: async (ctx, resolved): Promise<Reply> => {
    const body = ctx.json();
    const problems = new FieldProblems();
    if (readInteger(body, 'part_id') === null) problems.add('part_id', 'Name the part to hang.');
    if (readInteger(body, 'peg_part_id') === null) {
      problems.add('peg_part_id', 'Name the outline to hang it on.');
    }
    problems.throwIfAny();
    if (resolved.partId !== resolved.pegPartId) throw fail.wrongPeg();

    return withTransaction(async (client) => {
      const row = await lockLoanRow(client, resolved.loanId);
      if (!row) throw fail.notFound();
      const parts = await readLoanParts(client, row.id);
      const part = parts.find((candidate) => candidate.id === resolved.partId);
      if (!part) throw fail.notFound();
      const conflict = hangConflict(row.status, part.state, part.name);
      if (conflict) throw fail.conflict(conflict);
      await setPartState(client, part.id, 'hung');
      const calendar = await readCalendar(client);
      if (row.status === 'returned-partial') {
        const after = await readLoanParts(client, row.id);
        if (!after.some((candidate) => candidate.state === 'missing')) {
          await setLoanStatus(client, row.id, 'returned-complete');
          for (const item of await readLoanItems(client, row.id)) {
            await promoteHoldForItem(client, item.id, calendar, ctx.now);
          }
        }
      }
      const stored = await readLoanRow(client, row.id);
      if (!stored) throw fail.notFound();
      return jsonReply(200, {
        loan: await loanView(client, stored, calendar, ctx.now),
        counts: await readCounts(client),
      });
    });
  },
};

export const takeDownRoute: Route<{ loanId: number; partId: number }> = {
  method: 'DELETE',
  pattern: '/api/loans/:id/hang/:partId',
  body: 'json',
  auth: 'signed-in',
  resolve: async (ctx) => {
    const loanId = ctx.pathId('id');
    if (!(await readLoanRow(pool, loanId))) throw fail.notFound();
    const partId = ctx.pathId('partId');
    const parts = await readLoanParts(pool, loanId);
    if (!parts.some((part) => part.id === partId)) throw fail.notFound();
    return { loanId, partId };
  },
  role: (ctx) => staffOnly(ctx.role),
  run: async (ctx, resolved): Promise<Reply> => {
    return withTransaction(async (client) => {
      const row = await lockLoanRow(client, resolved.loanId);
      if (!row) throw fail.notFound();
      const conflict = takeDownConflict(row.status);
      if (conflict) throw fail.conflict(conflict);
      await setPartState(client, resolved.partId, 'out');
      const calendar = await readCalendar(client);
      const stored = await readLoanRow(client, row.id);
      if (!stored) throw fail.notFound();
      return jsonReply(200, {
        loan: await loanView(client, stored, calendar, ctx.now),
        counts: await readCounts(client),
      });
    });
  },
};

export const photoRoute: Route<{ id: number }> = {
  method: 'GET',
  pattern: '/api/photos/:id',
  body: 'json',
  auth: 'signed-in',
  resolve: async (ctx) => {
    const user = ctx.requireUser();
    const id = ctx.pathId('id');
    const record = await readPhotoRow(pool, id);
    if (!record) throw fail.notFound();
    if (!(await loanIsVisible({ role: user.role, userId: user.id }, record.loan_id))) {
      throw fail.notFound();
    }
    return { id };
  },
  run: async (_ctx, resolved): Promise<Reply> => {
    const record = await readPhotoRow(pool, resolved.id);
    if (!record) throw fail.notFound();
    let body: Buffer;
    try {
      body = await getPhotoObject(record.storage_key);
      storageProbe.markUp();
    } catch (error) {
      if (error instanceof StorageUnreachable) storageDown(copy.STORAGE_DOWN_PHOTO_READ);
      throw error;
    }
    return {
      kind: 'bytes',
      status: 200,
      body,
      headers: {
        'content-type': record.content_type,
        'cache-control': 'private, no-store',
      },
    };
  },
};
