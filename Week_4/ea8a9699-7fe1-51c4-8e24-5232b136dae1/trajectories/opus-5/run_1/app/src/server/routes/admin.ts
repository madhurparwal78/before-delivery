import { createHash, randomUUID } from 'node:crypto';
import { requireMembership, requireOpsLead } from '../auth.js';
import { one, query } from '../db.js';
import { errors } from '../errors.js';
import { currentPlan, recordPlan } from '../domain/plan.js';
import { assignSeat, freeSeat } from '../domain/seats.js';
import { reviewLinkState, type ReviewLinkRow } from '../domain/reviewLinks.js';
import { jsonResponse, type HttpResponse, type RequestContext } from '../http/context.js';
import type { Router } from '../http/router.js';
import { inviteMessage, receiptMessage, sendMail } from '../services/mail.js';
import { readSubscriptionPlan, upgradeSubscriptionPlan } from '../services/killbill.js';
import { FieldErrors, asString, checkDisplayName, checkEmail, checkIdempotencyKey } from '../validate.js';
import { config } from '../config.js';
import { fieldMessages } from '../../shared/fields.js';
import { planById, upgradesFrom } from '../../shared/plans.js';
import type {
  InviteCreated,
  OffboardResponse,
  PlanId,
  SeatMember,
  SeatMutationResponse,
  UpgradeResponse,
} from '../../shared/types.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function seatsUsed(workspaceId: string): Promise<number> {
  const row = await one<{ used: number }>('select count(*)::int as used from seats where workspace_id = $1', [
    workspaceId,
  ]);
  return row?.used ?? 0;
}

async function readWorkspace(context: RequestContext): Promise<HttpResponse> {
  const { workspace } = await requireMembership(context, context.params.ws);
  const { plan, seatCap } = await currentPlan(workspace);
  const definition = planById(plan);
  return jsonResponse(200, {
    slug: workspace.slug,
    name: workspace.name,
    timeZone: workspace.time_zone,
    plan,
    planName: definition?.planName ?? plan,
    seatCap,
    seatsUsed: await seatsUsed(workspace.id),
  });
}

async function readSeats(context: RequestContext): Promise<HttpResponse> {
  const { workspace } = await requireOpsLead(context, context.params.ws);
  const { plan, seatCap } = await currentPlan(workspace);
  const members = await query<{
    id: string;
    display_name: string;
    email: string;
    handle: string;
    has_seat: boolean;
  }>(
    `select a.id, a.display_name, a.email, a.handle,
            exists (select 1 from seats s where s.workspace_id = $1 and s.account_id = a.id) as has_seat
       from accounts a
      where a.workspace_id = $1 and a.role = 'designer'
      order by lower(a.display_name)`,
    [workspace.id],
  );
  const roster: SeatMember[] = members.map((member) => ({
    id: member.id,
    displayName: member.display_name,
    email: member.email,
    handle: member.handle,
    hasSeat: member.has_seat,
  }));
  return jsonResponse(200, {
    plan,
    seatCap,
    seatsUsed: roster.filter((member) => member.hasSeat).length,
    members: roster,
  });
}

async function designerOfWorkspace(workspaceId: string, memberId: string): Promise<boolean> {
  const row = await one(
    "select 1 as present from accounts where id = $1 and workspace_id = $2 and role = 'designer'",
    [memberId, workspaceId],
  );
  return row !== null;
}

async function createSeat(context: RequestContext): Promise<HttpResponse> {
  const { workspace } = await requireOpsLead(context, context.params.ws);
  const memberId = asString((context.body as Record<string, unknown>).memberId) ?? '';
  if (!uuidPattern.test(memberId)) {
    throw errors.validation({ memberId: fieldMessages.memberId });
  }
  if (!(await designerOfWorkspace(workspace.id, memberId))) {
    throw errors.notFound();
  }
  const outcome = await assignSeat(workspace, memberId);
  const body: SeatMutationResponse = { memberId, seatsUsed: outcome.seatsUsed, seatCap: outcome.seatCap };
  return jsonResponse(outcome.created ? 201 : 200, body);
}

async function removeSeat(context: RequestContext): Promise<HttpResponse> {
  const { workspace } = await requireOpsLead(context, context.params.ws);
  const memberId = context.params.memberId;
  if (!uuidPattern.test(memberId) || !(await designerOfWorkspace(workspace.id, memberId))) {
    throw errors.notFound();
  }
  const outcome = await freeSeat(workspace, memberId);
  const body: SeatMutationResponse = { memberId, seatsUsed: outcome.seatsUsed, seatCap: outcome.seatCap };
  return jsonResponse(200, body);
}

async function readPlan(context: RequestContext): Promise<HttpResponse> {
  const { workspace } = await requireOpsLead(context, context.params.ws);
  const { plan, seatCap } = await currentPlan(workspace);
  const definition = planById(plan);
  return jsonResponse(200, {
    plan,
    planName: definition?.planName ?? plan,
    seatCap,
    seatsUsed: await seatsUsed(workspace.id),
    monthlyPrice: definition?.monthlyPrice ?? '0.00',
    currency: 'USD',
    upgrades: upgradesFrom(plan).map((option) => ({
      plan: option.plan,
      planName: option.planName,
      seatCap: option.seatCap,
      monthlyPrice: option.monthlyPrice,
    })),
  });
}

interface UpgradeClaim {
  request_hash: string;
  state: string;
  response: string | null;
}

async function claimUpgrade(workspaceId: string, key: string, requestHash: string): Promise<void> {
  const claimed = await query<{ claimed: number }>(
    `insert into upgrade_requests (workspace_id, idempotency_key, request_hash, state)
          values ($1, $2, $3, 'running')
     on conflict (workspace_id, idempotency_key) do nothing
       returning 1 as claimed`,
    [workspaceId, key, requestHash],
  );
  if (claimed.length > 0) {
    return;
  }
  const existing = await one<UpgradeClaim>(
    'select request_hash, state, response from upgrade_requests where workspace_id = $1 and idempotency_key = $2',
    [workspaceId, key],
  );
  if (existing === null) {
    return claimUpgrade(workspaceId, key, requestHash);
  }
  if (existing.request_hash !== requestHash) {
    throw errors.idempotencyConflict();
  }
  if (existing.state === 'done' && existing.response !== null) {
    throw new StoredUpgrade(existing.response);
  }
  throw errors.idempotencyInProgress();
}

/** Carries a stored upgrade answer back out of the idempotency check, byte for byte. */
class StoredUpgrade extends Error {
  readonly response: string;

  constructor(response: string) {
    super('stored upgrade');
    this.response = response;
  }
}

async function releaseUpgradeClaim(workspaceId: string, key: string): Promise<void> {
  await query("delete from upgrade_requests where workspace_id = $1 and idempotency_key = $2 and state = 'running'", [
    workspaceId,
    key,
  ]);
}

async function upgradePlan(context: RequestContext): Promise<HttpResponse> {
  const { workspace, viewer } = await requireOpsLead(context, context.params.ws);
  const header = context.headers['idempotency-key'];
  const key = checkIdempotencyKey(typeof header === 'string' ? header : undefined);
  const body = context.body as Record<string, unknown>;
  const requestedPlan = asString(body.plan);
  const requestHash = createHash('sha256').update(JSON.stringify({ plan: requestedPlan })).digest('hex');

  try {
    await claimUpgrade(workspace.id, key, requestHash);
  } catch (error) {
    if (error instanceof StoredUpgrade) {
      return { status: 200, body: error.response, contentType: 'application/json; charset=utf-8' };
    }
    throw error;
  }

  try {
    const fields = new FieldErrors();
    if (requestedPlan === null || requestedPlan === '') {
      fields.add('plan', fieldMessages.planMissing);
    }
    fields.throwIfAny();
    const target = planById(requestedPlan as string);
    if (target === undefined) {
      throw errors.validation({ plan: fieldMessages.planUnknown });
    }
    const previous = await currentPlan(workspace);
    const previousDefinition = planById(previous.plan);
    if (previousDefinition === undefined || target.seatCap <= previousDefinition.seatCap) {
      throw errors.validation({ plan: fieldMessages.planTooSmall });
    }

    await upgradeSubscriptionPlan(workspace.slug, target.plan);
    const readBack = await readBackPlan(workspace.slug, previousDefinition.plan);
    const receipt = receiptMessage({
      to: viewer.email,
      workspaceName: workspace.name,
      planName: readBack.planName,
      seatCap: readBack.seatCap,
      monthlyPrice: readBack.monthlyPrice,
    });
    try {
      await sendMail(receipt);
    } catch (error) {
      await upgradeSubscriptionPlan(workspace.slug, previousDefinition.plan);
      throw error;
    }
    await recordPlan(workspace.id, readBack.plan, readBack.seatCap);
    const response: UpgradeResponse = {
      plan: readBack.plan,
      planName: readBack.planName,
      seatCap: readBack.seatCap,
      seatsUsed: await seatsUsed(workspace.id),
      monthlyPrice: readBack.monthlyPrice,
      currency: 'USD',
      receiptSentTo: viewer.email,
    };
    const serialised = JSON.stringify(response);
    await query(
      `update upgrade_requests set state = 'done', response = $3
        where workspace_id = $1 and idempotency_key = $2`,
      [workspace.id, key, serialised],
    );
    return { status: 200, body: serialised, contentType: 'application/json; charset=utf-8' };
  } catch (error) {
    await releaseUpgradeClaim(workspace.id, key);
    throw error;
  }
}

async function readBackPlan(
  slug: string,
  previousPlan: PlanId,
): Promise<{ plan: PlanId; planName: string; seatCap: number; monthlyPrice: string }> {
  let plan: PlanId | null;
  try {
    plan = await readSubscriptionPlan(slug);
  } catch (error) {
    await upgradeSubscriptionPlan(slug, previousPlan);
    throw error;
  }
  const definition = plan === null ? undefined : planById(plan);
  if (definition === undefined) {
    await upgradeSubscriptionPlan(slug, previousPlan);
    throw errors.billingUnavailable();
  }
  return definition;
}

async function sendInvite(context: RequestContext): Promise<HttpResponse> {
  const { workspace, viewer } = await requireOpsLead(context, context.params.ws);
  const body = context.body as Record<string, unknown>;
  const fields = new FieldErrors();
  const email = checkEmail(fields, body.email);
  const displayName = checkDisplayName(fields, body.displayName);
  if (fields.isEmpty) {
    const taken = await one('select 1 as present from accounts where lower(email) = lower($1)', [email]);
    if (taken !== null) {
      fields.add('email', fieldMessages.emailTaken);
    }
  }
  fields.throwIfAny();

  const id = randomUUID();
  const token = randomUUID().replace(/-/g, '');
  await sendMail(
    inviteMessage({
      to: email,
      workspaceName: workspace.name,
      leadName: viewer.display_name,
      url: `${config.publicUrl}/invite/${token}`,
    }),
  );
  await query(
    `insert into invites (id, workspace_id, email, display_name, token, invited_by)
          values ($1, $2, $3, $4, $5, $6)`,
    [id, workspace.id, email, displayName, token, viewer.id],
  );
  const created: InviteCreated = { id, email, displayName };
  return jsonResponse(201, created);
}

async function offboardCollaborator(context: RequestContext): Promise<HttpResponse> {
  const { workspace } = await requireOpsLead(context, context.params.ws);
  const fields = new FieldErrors();
  const email = checkEmail(fields, (context.body as Record<string, unknown>).email);
  fields.throwIfAny();

  const now = new Date();
  const links = await query<ReviewLinkRow>(
    `select l.* from review_links l
       join clusters c on c.id = l.cluster_id
      where c.workspace_id = $1 and lower(l.email) = lower($2)`,
    [workspace.id, email],
  );
  const live = links.filter((link) => reviewLinkState(link, now) === 'live');
  if (live.length > 0) {
    await query('update review_links set revoked_at = now() where id = any($1::uuid[])', [
      live.map((link) => link.id),
    ]);
  }
  const offboarded: OffboardResponse = { email, revoked: live.length };
  return jsonResponse(200, offboarded);
}

export function registerAdminRoutes(router: Router): void {
  router.get('/api/workspaces/:ws', readWorkspace);
  router.get('/api/workspaces/:ws/seats', readSeats);
  router.post('/api/workspaces/:ws/seats', 'json', createSeat);
  router.delete('/api/workspaces/:ws/seats/:memberId', removeSeat);
  router.get('/api/workspaces/:ws/plan', readPlan);
  router.post('/api/workspaces/:ws/plan', 'json', upgradePlan);
  router.post('/api/workspaces/:ws/invites', 'json', sendInvite);
  router.post('/api/workspaces/:ws/collaborators/offboard', 'json', offboardCollaborator);
}
