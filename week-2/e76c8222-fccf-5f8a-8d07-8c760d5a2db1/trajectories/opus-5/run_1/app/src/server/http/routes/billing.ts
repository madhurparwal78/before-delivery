import { Router } from 'express';
import { formatCents, parseMoney } from '../../../shared/money';
import { InvoicesPayload } from '../../../shared/types';
import { pool, queryOne } from '../../db/pool';
import { readIdempotencyKey, runIdempotent } from '../../domain/idempotency';
import { ratesMap, ratesResponse, saveRates } from '../../domain/rates';
import { loadRequestRow } from '../../domain/requests';
import {
  approveTimesheet,
  listSubmittedTimesheets,
  loadTimesheet,
} from '../../domain/timesheets';
import { ensureAccount, listInvoices } from '../../services/killbill';
import { getObject } from '../../services/storage';
import { jsonObject, pathParam, requireAuth, requireRoles } from '../context';
import { notFound } from '../errors';
import { readRatesInput } from '../validation';
import { kickOutbox } from '../../jobs/background';

export const billingRouter = Router();

billingRouter.get('/timesheets', async (req, res) => {
  requireRoles(req, ['billing']);
  res.json({ timesheets: await listSubmittedTimesheets(pool) });
});

billingRouter.post('/timesheets/:id/approve', async (req, res) => {
  const user = requireRoles(req, ['billing']);
  const id = pathParam(req, 'id');
  const key = readIdempotencyKey(req.headers['idempotency-key']);
  const body = jsonObject(req);
  const timesheet = await loadTimesheet(pool, id);
  if (!timesheet) throw notFound();
  const request = await loadRequestRow(pool, timesheet.request_id);
  if (!request) throw notFound();

  const outcome = await runIdempotent(
    { userId: user.id, action: 'timesheet.approve', targetId: id, key, body },
    async () => {
      const result = await approveTimesheet({
        timesheet,
        request,
        billingUserId: user.id,
        billingUserName: user.name,
        now: new Date(),
      });
      return { status: 200, body: result };
    },
  );
  kickOutbox();
  if (outcome.replayed) res.setHeader('Idempotent-Replayed', 'true');
  res.status(outcome.status).json(outcome.body);
});

billingRouter.get('/timesheets/:id/pdf', async (req, res) => {
  const user = requireAuth(req);
  const timesheet = await loadTimesheet(pool, pathParam(req, 'id'));
  if (!timesheet || !timesheet.pdf_key) throw notFound();
  const request = await loadRequestRow(pool, timesheet.request_id);
  if (!request) throw notFound();
  const allowed =
    user.role === 'billing' ||
    (user.role === 'requester' && user.org_id === request.org_id) ||
    (user.role === 'interpreter' && user.id === timesheet.interpreter_id);
  if (!allowed) throw notFound();
  const object = await getObject(timesheet.pdf_key);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${request.ref}-timesheet.pdf"`);
  res.send(object.body);
});

billingRouter.get('/rates', async (req, res) => {
  requireRoles(req, ['billing', 'coordinator']);
  res.json({ rates: ratesResponse(await ratesMap(pool)) });
});

billingRouter.put('/rates', async (req, res) => {
  const user = requireRoles(req, ['billing']);
  const patch = readRatesInput(jsonObject(req));
  res.json({ rates: ratesResponse(await saveRates(user.id, patch)) });
});

billingRouter.get('/orgs/:orgId/invoices', async (req, res) => {
  const user = requireRoles(req, ['requester', 'billing']);
  const orgId = pathParam(req, 'orgId');
  if (user.role === 'requester' && user.org_id !== orgId) throw notFound();
  const org = await queryOne<{ id: string; name: string }>(
    pool,
    'select id, name from orgs where id = $1',
    [orgId],
  );
  if (!org) throw notFound();
  const accountId = await ensureAccount(pool, org.id, org.name);
  const invoices = await listInvoices(accountId);
  const totalCents = invoices.reduce(
    (sum, invoice) => sum + (parseMoney(invoice.amount) ?? 0),
    0,
  );
  const payload: InvoicesPayload = {
    org_id: org.id,
    killbill_account_id: accountId,
    invoices,
    total: formatCents(totalCents),
  };
  res.json(payload);
});
