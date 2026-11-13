import {
  addContractRate,
  closeWeek,
  validateWeekStart,
  weekStatement,
} from '../../actions/billing.js';
import { allContracts, contractById, orgName, toContractResponse } from '../../store/contracts.js';
import { apiError } from '../errors.js';
import { requireRole } from '../roles.js';
import { actor, route, type RequestContext } from '../router.js';

route('GET', '/api/contracts', async (ctx) => {
  requireRole(actor(ctx), 'coordinator', 'billing_manager');
  const contracts = await allContracts();
  return { status: 200, body: { contracts: contracts.map(toContractResponse) } };
});

route(
  'POST',
  '/api/contracts/:id/rates',
  async (ctx) => {
    const contractId = ctx.params['id'] ?? '';
    if ((await contractById(contractId)) === null) throw apiError('not_found');
    requireRole(actor(ctx), 'billing_manager');
    const contract = await addContractRate(contractId, ctx.body, ctx.now);
    return { status: 201, body: contract };
  },
  { idempotent: true },
);

async function readableOrg(ctx: RequestContext): Promise<{ orgId: string; name: string }> {
  const user = actor(ctx);
  const orgId = ctx.params['org_id'] ?? '';
  const name = await orgName(orgId);
  if (name === null) throw apiError('not_found');
  if (user.role === 'requester' && user.org_id !== orgId) throw apiError('not_found');
  requireRole(user, 'requester', 'billing_manager');
  return { orgId, name };
}

route('GET', '/api/billing/weeks/:org_id/:week_start', async (ctx) => {
  const { orgId, name } = await readableOrg(ctx);
  const weekStart = validateWeekStart(ctx.params['week_start'] ?? '', ctx.now);
  return { status: 200, body: await weekStatement(orgId, name, weekStart) };
});

route(
  'POST',
  '/api/billing/weeks/:org_id/:week_start/close',
  async (ctx) => {
    const orgId = ctx.params['org_id'] ?? '';
    const name = await orgName(orgId);
    if (name === null) throw apiError('not_found');
    requireRole(actor(ctx), 'billing_manager');
    const weekStart = validateWeekStart(ctx.params['week_start'] ?? '', ctx.now);
    return { status: 200, body: await closeWeek(orgId, name, weekStart) };
  },
  { idempotent: true },
);
