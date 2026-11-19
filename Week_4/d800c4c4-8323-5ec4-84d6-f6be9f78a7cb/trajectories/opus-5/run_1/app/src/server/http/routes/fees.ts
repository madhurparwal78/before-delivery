import * as copy from '../../../shared/copy';
import type { Fee } from '../../../shared/types';
import {
  feeWriteConflict,
  waiverDecisionConflict,
  waiverRequestConflict,
} from '../../domain/transitions';
import { pool, withTransaction } from '../../repo/db';
import { readCalendar } from '../../repo/calendar';
import {
  feeView,
  listFeeRows,
  lockFeeRow,
  readFeeRow,
  recordWaiverDecision,
  recordWaiverRequest,
  setFeeStatus,
} from '../../repo/fees';
import { readLoanPhotos, photoView } from '../../repo/loans';
import {
  BillingUnreachable,
  creditFeeInvoice,
  settleFeeInvoice,
} from '../../services/killbill';
import { billingProbe } from '../../services/status';
import * as fail from '../errors';
import { jsonReply, type Reply, type Route } from '../pipeline';
import { readString } from '../validate';

function billingDown(message: string): never {
  billingProbe.markDown();
  throw fail.providerDown(message);
}

async function accountIdFor(memberId: number): Promise<string> {
  const rows = await pool.query<{ killbill_account_id: string | null }>(
    'select killbill_account_id from memberships where user_id = $1',
    [memberId],
  );
  const accountId = rows.rows[0]?.killbill_account_id;
  if (!accountId) billingDown(copy.BILLING_DOWN_GENERAL);
  return accountId;
}

export const listFeesRoute: Route = {
  method: 'GET',
  pattern: '/api/fees',
  body: 'json',
  auth: 'signed-in',
  run: async (ctx): Promise<Reply> => {
    const user = ctx.requireUser();
    const calendar = await readCalendar(pool);
    const status = ctx.query.get('status');
    const rows = await listFeeRows(pool, {
      memberId: user.role === 'member' ? user.id : undefined,
      status: status !== null ? (status as Fee['status']) : undefined,
    });
    const fees: Fee[] = [];
    for (const row of rows) fees.push(await feeView(pool, row, calendar.timeZone));
    return jsonReply(200, { fees });
  },
};

async function visibleFee(
  ctx: { role: string | null; userId: number },
  id: number,
): Promise<{ id: number; memberId: number; loanId: number }> {
  const row = await readFeeRow(pool, id);
  if (!row) throw fail.notFound();
  if (ctx.role === 'member' && row.member_id !== ctx.userId) throw fail.notFound();
  return { id, memberId: row.member_id, loanId: row.loan_id };
}

export const readFeeRoute: Route<{ id: number; loanId: number }> = {
  method: 'GET',
  pattern: '/api/fees/:id',
  body: 'json',
  auth: 'signed-in',
  resolve: async (ctx) => {
    const user = ctx.requireUser();
    const found = await visibleFee({ role: user.role, userId: user.id }, ctx.pathId('id'));
    return { id: found.id, loanId: found.loanId };
  },
  run: async (_ctx, resolved): Promise<Reply> => {
    const calendar = await readCalendar(pool);
    const row = await readFeeRow(pool, resolved.id);
    if (!row) throw fail.notFound();
    const photos = await readLoanPhotos(pool, resolved.loanId);
    return jsonReply(200, {
      fee: await feeView(pool, row, calendar.timeZone),
      photos: photos.map((photo) => photoView(photo, calendar.timeZone)),
    });
  },
};

export const payFeeRoute: Route<{ id: number; memberId: number }> = {
  method: 'POST',
  pattern: '/api/fees/:id/pay',
  body: 'json',
  auth: 'signed-in',
  resolve: async (ctx) => {
    const user = ctx.requireUser();
    const found = await visibleFee({ role: user.role, userId: user.id }, ctx.pathId('id'));
    return { id: found.id, memberId: found.memberId };
  },
  role: (ctx) => {
    if (ctx.role !== 'member') throw fail.membersOnly();
  },
  run: async (_ctx, resolved): Promise<Reply> => {
    const accountId = await accountIdFor(resolved.memberId);
    const calendar = await readCalendar(pool);
    return withTransaction(async (client) => {
      const row = await lockFeeRow(client, resolved.id);
      if (!row) throw fail.notFound();
      const conflict = feeWriteConflict(row.status);
      if (conflict) throw fail.conflict(conflict);
      if (!row.killbill_invoice_id) billingDown(copy.BILLING_DOWN_GENERAL);
      let settled: boolean;
      try {
        settled = await settleFeeInvoice(accountId, row.killbill_invoice_id, row.id);
        billingProbe.markUp();
      } catch (error) {
        if (error instanceof BillingUnreachable) billingDown(copy.BILLING_DOWN_GENERAL);
        throw error;
      }
      if (!settled) billingDown(copy.BILLING_DOWN_GENERAL);
      await setFeeStatus(client, row.id, 'settled');
      const updated = await readFeeRow(client, row.id);
      if (!updated) throw fail.notFound();
      return jsonReply(200, { fee: await feeView(client, updated, calendar.timeZone) });
    });
  },
};

export const requestWaiverRoute: Route<{ id: number }> = {
  method: 'POST',
  pattern: '/api/fees/:id/waiver-request',
  body: 'json',
  auth: 'signed-in',
  resolve: async (ctx) => {
    const user = ctx.requireUser();
    const found = await visibleFee({ role: user.role, userId: user.id }, ctx.pathId('id'));
    return { id: found.id };
  },
  role: (ctx) => {
    if (ctx.role !== 'member') throw fail.membersOnly();
  },
  run: async (ctx, resolved): Promise<Reply> => {
    const reason = readString(ctx.json(), 'reason') ?? '';
    if (reason.trim().length < 1 || reason.length > 500) {
      throw fail.invalid({ reason: 'Give a reason of 1 to 500 characters.' });
    }
    const calendar = await readCalendar(pool);
    return withTransaction(async (client) => {
      const row = await lockFeeRow(client, resolved.id);
      if (!row) throw fail.notFound();
      const conflict = waiverRequestConflict(row.status, row.waiver_status);
      if (conflict) throw fail.conflict(conflict);
      await recordWaiverRequest(client, row.id, reason);
      const updated = await readFeeRow(client, row.id);
      if (!updated) throw fail.notFound();
      return jsonReply(201, { fee: await feeView(client, updated, calendar.timeZone) });
    });
  },
};

export const decideWaiverRoute: Route<{ id: number; memberId: number }> = {
  method: 'POST',
  pattern: '/api/fees/:id/waiver-decision',
  body: 'json',
  auth: 'signed-in',
  resolve: async (ctx) => {
    const user = ctx.requireUser();
    const found = await visibleFee({ role: user.role, userId: user.id }, ctx.pathId('id'));
    return { id: found.id, memberId: found.memberId };
  },
  role: (ctx) => {
    if (ctx.role !== 'coordinator') throw fail.coordinatorOnly();
  },
  run: async (ctx, resolved): Promise<Reply> => {
    const decision = readString(ctx.json(), 'decision') ?? '';
    if (decision !== 'approve' && decision !== 'decline') {
      throw fail.invalid({ decision: 'Choose approve or decline.' });
    }
    const calendar = await readCalendar(pool);
    const accountId = decision === 'approve' ? await accountIdFor(resolved.memberId) : null;
    return withTransaction(async (client) => {
      const row = await lockFeeRow(client, resolved.id);
      if (!row) throw fail.notFound();
      const conflict = waiverDecisionConflict(row.status, row.waiver_status);
      if (conflict) throw fail.conflict(conflict);
      if (decision === 'decline') {
        await recordWaiverDecision(client, row.id, 'declined');
      } else {
        if (!row.killbill_invoice_id || accountId === null) {
          billingDown(copy.BILLING_DOWN_WAIVER);
        }
        let cleared: boolean;
        try {
          cleared = await creditFeeInvoice(
            accountId,
            row.killbill_invoice_id,
            row.id,
            row.total_cents,
          );
          billingProbe.markUp();
        } catch (error) {
          if (error instanceof BillingUnreachable) billingDown(copy.BILLING_DOWN_WAIVER);
          throw error;
        }
        if (!cleared) billingDown(copy.BILLING_DOWN_WAIVER);
        await recordWaiverDecision(client, row.id, 'approved');
        await setFeeStatus(client, row.id, 'waived-by-coordinator');
      }
      const updated = await readFeeRow(client, row.id);
      if (!updated) throw fail.notFound();
      return jsonReply(200, { fee: await feeView(client, updated, calendar.timeZone) });
    });
  },
};
