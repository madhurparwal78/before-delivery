import { lockOrganization, query, serverNow, withTransaction } from '../db/pool.js';
import { aggregationShape, getPolicy, getWallet, listAggregations, listPolicies, policyShape, runner } from '../db/repo.js';
import { AGGREGATION_GROUPS, AGGREGATION_METRICS } from '../domain/aggregations.js';
import { ASSETS } from '../domain/amounts.js';
import { appendEvent } from '../domain/audit.js';
import { decide } from '../domain/decide.js';
import { newId } from '../domain/ids.js';
import { POLICY_BODY_SCHEMA, PolicyError, validateRules } from '../domain/policy.js';
import { formatTimestamp } from '../domain/time.js';
import { ApiError } from '../http/errors.js';
import { ensureKnownFields, requireAddress, requireAmount, requireEnum, requireIdString, requireInteger, requireText } from '../http/validate.js';

function policyError(path) {
  return new ApiError('INVALID_POLICY', { details: { path } });
}

async function aggregationIdsOf(client, organizationId) {
  const rows = await listAggregations(client, organizationId);
  return new Set(rows.map((row) => row.id));
}

function readRules(rules, aggregationIds) {
  try {
    return validateRules(rules, { aggregationIds });
  } catch (error) {
    if (error instanceof PolicyError) throw policyError(error.path);
    throw error;
  }
}

export async function listPoliciesRoute(ctx) {
  const rows = await listPolicies(null, ctx.organization.id);
  return { status: 200, data: { policies: rows.map(policyShape) } };
}

export async function getPolicyRoute(ctx) {
  const row = await getPolicy(null, ctx.organization.id, ctx.params.id);
  if (!row) throw new ApiError('POLICY_NOT_FOUND');
  return { status: 200, data: policyShape(row) };
}

export async function listPolicyRevisions(ctx) {
  const policy = await getPolicy(null, ctx.organization.id, ctx.params.id);
  if (!policy) throw new ApiError('POLICY_NOT_FOUND');
  const result = await query(
    'SELECT revision, name, rules, created_at FROM policy_revisions WHERE policy_id = $1 ORDER BY revision',
    [policy.id]
  );
  return {
    status: 200,
    data: {
      revisions: result.rows.map((row) => ({
        revision: row.revision,
        name: row.name,
        rules: row.rules,
        created_at: formatTimestamp(row.created_at)
      }))
    }
  };
}

export async function createPolicy(ctx) {
  ensureKnownFields(ctx.body, POLICY_BODY_SCHEMA);
  if (ctx.body.version !== '1.0') throw policyError('version');
  const name = requireText(ctx.body.name, 'policyName', 'name', { trim: true });
  if (ctx.body.chain_type !== 'ethereum') throw policyError('chain_type');

  const policy = await withTransaction(async (client) => {
    const organization = await lockOrganization(client, ctx.organization.id);
    const rules = readRules(ctx.body.rules, await aggregationIdsOf(client, organization.id));
    const id = newId('pol_');
    await client.query(
      `INSERT INTO policies (id, organization_id, version, name, chain_type, rules, revision, created_at, updated_at)
       VALUES ($1, $2, '1.0', $3, 'ethereum', $4, 1, $5, $5)`,
      [id, organization.id, name, JSON.stringify(rules), organization.now]
    );
    await client.query(
      'INSERT INTO policy_revisions (policy_id, revision, name, rules, created_at) VALUES ($1, 1, $2, $3, $4)',
      [id, name, JSON.stringify(rules), organization.now]
    );
    await appendEvent(client, {
      organizationId: organization.id,
      webhookSecret: organization.webhook_secret,
      type: 'policy.created',
      actor: ctx.principal.actor,
      subjectId: id,
      at: organization.now,
      data: { policy_id: id, name, revision: 1 }
    });
    return getPolicy(client, organization.id, id);
  });
  return { status: 201, data: policyShape(policy) };
}

export async function patchPolicy(ctx) {
  const policy = await withTransaction(async (client) => {
    const organization = await lockOrganization(client, ctx.organization.id);
    const current = await getPolicy(client, organization.id, ctx.params.id);
    if (!current) throw new ApiError('POLICY_NOT_FOUND');
    ensureKnownFields(ctx.body, { name: POLICY_BODY_SCHEMA.name, rules: POLICY_BODY_SCHEMA.rules });

    const name = ctx.body.name === undefined
      ? current.name
      : requireText(ctx.body.name, 'policyName', 'name', { trim: true });
    const rules = ctx.body.rules === undefined
      ? current.rules
      : readRules(ctx.body.rules, await aggregationIdsOf(client, organization.id));

    const revision = current.revision + 1;
    await client.query(
      'UPDATE policies SET name = $2, rules = $3, revision = $4, updated_at = $5 WHERE id = $1',
      [current.id, name, JSON.stringify(rules), revision, organization.now]
    );
    await client.query(
      'INSERT INTO policy_revisions (policy_id, revision, name, rules, created_at) VALUES ($1, $2, $3, $4, $5)',
      [current.id, revision, name, JSON.stringify(rules), organization.now]
    );
    await appendEvent(client, {
      organizationId: organization.id,
      webhookSecret: organization.webhook_secret,
      type: 'policy.updated',
      actor: ctx.principal.actor,
      subjectId: current.id,
      at: organization.now,
      data: { policy_id: current.id, name, revision }
    });
    return getPolicy(client, organization.id, current.id);
  });
  return { status: 200, data: policyShape(policy) };
}

export async function deletePolicy(ctx) {
  await withTransaction(async (client) => {
    const organization = await lockOrganization(client, ctx.organization.id);
    const current = await getPolicy(client, organization.id, ctx.params.id);
    if (!current) throw new ApiError('POLICY_NOT_FOUND');
    const used = await client.query('SELECT id FROM wallets WHERE policy_id = $1', [current.id]);
    if (used.rows.length) throw new ApiError('POLICY_IN_USE');
    await client.query('DELETE FROM policies WHERE id = $1', [current.id]);
    await appendEvent(client, {
      organizationId: organization.id,
      webhookSecret: organization.webhook_secret,
      type: 'policy.deleted',
      actor: ctx.principal.actor,
      subjectId: current.id,
      at: organization.now,
      data: { policy_id: current.id, name: current.name }
    });
  });
  return { status: 200, data: { deleted: true } };
}

/** Reads the decision for a hypothetical request and writes nothing. */
export async function evaluatePolicyRoute(ctx) {
  const policyRow = await getPolicy(null, ctx.organization.id, ctx.params.id);
  if (!policyRow) throw new ApiError('POLICY_NOT_FOUND');
  ensureKnownFields(ctx.body, { method: true, wallet_id: true, destination_address: true, amount: true });

  const method = requireEnum(ctx.body.method, ['transfer', 'batch_payout'], 'method');
  const wallet = await getWallet(null, ctx.organization.id, requireIdString(ctx.body.wallet_id, 'wallet_id'));
  if (!wallet) throw new ApiError('WALLET_NOT_FOUND');
  const destination = requireAddress(ctx.body.destination_address, 'destination_address');
  const rawAmount = requireAmount(ctx.body.amount, wallet.asset, 'amount');

  const now = await serverNow(null);
  const { decision, aggregationValues } = await decide(runner(null), {
    organization: ctx.organization,
    wallet,
    policy: { id: policyRow.id, revision: policyRow.revision, rules: policyRow.rules },
    method,
    destinationAddress: destination,
    rawAmount,
    now
  });
  return {
    status: 200,
    data: {
      action: decision.action,
      rule: decision.rule,
      reason: decision.reason,
      policy_id: decision.policy_id,
      policy_revision: decision.policy_revision,
      aggregations: aggregationValues,
      trace: decision.trace
    }
  };
}

export async function listAggregationsRoute(ctx) {
  const rows = await listAggregations(null, ctx.organization.id);
  return { status: 200, data: { aggregations: rows.map(aggregationShape) } };
}

export async function createAggregation(ctx) {
  ensureKnownFields(ctx.body, { name: true, metric: true, window_seconds: true, asset: true, group_by: true });
  const name = requireText(ctx.body.name, 'aggregationName', 'name', { trim: true });
  const metric = requireEnum(ctx.body.metric, AGGREGATION_METRICS, 'metric');
  const windowSeconds = requireInteger(ctx.body.window_seconds, 'window_seconds', { min: 60, max: 2592000 });
  const asset = requireEnum(ctx.body.asset, ASSETS, 'asset');
  const groupBy = ctx.body.group_by === undefined || ctx.body.group_by === null
    ? 'wallet'
    : requireEnum(ctx.body.group_by, AGGREGATION_GROUPS, 'group_by');

  const aggregation = await withTransaction(async (client) => {
    const organization = await lockOrganization(client, ctx.organization.id);
    const id = newId('agg_');
    await client.query(
      `INSERT INTO aggregations (id, organization_id, name, metric, window_seconds, asset, group_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, organization.id, name, metric, windowSeconds, asset, groupBy, organization.now]
    );
    await appendEvent(client, {
      organizationId: organization.id,
      webhookSecret: organization.webhook_secret,
      type: 'aggregation.created',
      actor: ctx.principal.actor,
      subjectId: id,
      at: organization.now,
      data: { aggregation_id: id, name, metric, window_seconds: windowSeconds, asset, group_by: groupBy }
    });
    const rows = await listAggregations(client, organization.id);
    return rows.find((row) => row.id === id);
  });
  return { status: 201, data: aggregationShape(aggregation) };
}
