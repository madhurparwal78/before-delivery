import { query } from '../db/pool.js';
import {
  aggregationShape, apiKeyShape, getPolicy, getWallet, intentShapes, listAggregations, listApiKeys,
  listMembers, listPolicies, listQuorums, listWallets, memberShape, policyShape, quorumShape, walletShape
} from '../db/repo.js';
import { verifyChain } from '../domain/audit.js';
import { formatAmount } from '../domain/amounts.js';
import { formatTimestamp } from '../domain/time.js';
import { expireDueIntents } from '../domain/treasury.js';

const INTENT_SELECT = `SELECT i.*, w.asset AS wallet_asset, w.name AS wallet_name, w.status AS wallet_status
  FROM intents i JOIN wallets w ON w.id = i.wallet_id`;

export async function memberNames(organizationId) {
  const rows = await listMembers(null, organizationId);
  const names = new Map();
  for (const row of rows) names.set(row.id, row.name);
  return names;
}

export async function awaitingCount(organizationId, memberId) {
  const result = await query(
    `SELECT COUNT(*)::int AS count FROM intents i
      WHERE i.organization_id = $1 AND i.status = 'pending_approval'
        AND i.quorum_member_ids @> to_jsonb($2::text) AND i.created_by <> $2
        AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.intent_id = i.id AND a.member_id = $2)`,
    [organizationId, memberId]
  );
  return result.rows[0].count;
}

export async function statCounts(organizationId, memberId) {
  const counts = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM wallets WHERE organization_id = $1) AS wallets,
       (SELECT COUNT(*)::int FROM intents WHERE organization_id = $1 AND status = 'pending_approval') AS pending,
       (SELECT COUNT(*)::int FROM intents WHERE organization_id = $1 AND status = 'executed'
          AND executed_at > date_trunc('second', now()) - make_interval(secs => 86400)) AS executed_recently`,
    [organizationId]
  );
  return {
    wallets: counts.rows[0].wallets,
    pending: counts.rows[0].pending,
    awaiting: await awaitingCount(organizationId, memberId),
    executedRecently: counts.rows[0].executed_recently
  };
}

export async function overviewData(session) {
  await expireDueIntents(session.organization.id);
  const wallets = (await listWallets(null, session.organization.id)).map(walletShape);
  const policies = await listPolicies(null, session.organization.id);
  const quorums = await listQuorums(null, session.organization.id);
  return {
    wallets,
    policyNames: new Map(policies.map((row) => [row.id, row.name])),
    quorumNames: new Map(quorums.map((row) => [row.id, row.name])),
    stats: await statCounts(session.organization.id, session.member.id)
  };
}

export async function walletPageData(session, walletId) {
  await expireDueIntents(session.organization.id);
  const row = await getWallet(null, session.organization.id, walletId);
  if (!row) return null;
  const wallet = walletShape(row);
  const policy = wallet.policy_id ? await getPolicy(null, session.organization.id, wallet.policy_id) : null;
  const quorums = await listQuorums(null, session.organization.id);
  const quorum = quorums.find((entry) => entry.id === wallet.quorum_id) || null;
  const intents = await query(`${INTENT_SELECT} WHERE i.wallet_id = $1 ORDER BY i.created_at DESC, i.id DESC LIMIT 50`, [walletId]);
  const deposits = await query('SELECT * FROM deposits WHERE wallet_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50', [walletId]);
  const activity = [
    ...(await intentShapes(null, intents.rows)).map((intent) => ({
      kind: intent.kind,
      at: intent.created_at,
      amount: `${intent.amount} ${wallet.asset.toUpperCase()}`,
      status: intent.status,
      reference: intent.destination_address || `${intent.items.length} lines`,
      memo: intent.memo || '',
      id: intent.id
    })),
    ...deposits.rows.map((deposit) => ({
      kind: 'deposit',
      at: formatTimestamp(deposit.created_at),
      amount: `${formatAmount(deposit.raw_amount, row.asset)} ${wallet.asset.toUpperCase()}`,
      status: 'executed',
      reference: deposit.reference,
      memo: '',
      id: deposit.id
    }))
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { wallet, policy: policy ? policyShape(policy) : null, quorum: quorum ? quorumShape(quorum) : null, activity };
}

export async function inboxData(session) {
  await expireDueIntents(session.organization.id);
  const result = await query(
    `${INTENT_SELECT}
      WHERE i.organization_id = $1 AND i.status = 'pending_approval'
        AND i.quorum_member_ids @> to_jsonb($2::text) AND i.created_by <> $2
        AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.intent_id = i.id AND a.member_id = $2)
      ORDER BY i.created_at DESC, i.id DESC`,
    [session.organization.id, session.member.id]
  );
  const items = await intentShapes(null, result.rows);
  const walletNames = new Map(result.rows.map((row) => [row.id, row.wallet_name]));
  const assets = new Map(result.rows.map((row) => [row.id, row.wallet_asset]));
  return { items, walletNames, assets, names: await memberNames(session.organization.id) };
}

export async function policiesData(session) {
  const rows = await listPolicies(null, session.organization.id);
  const wallets = await listWallets(null, session.organization.id);
  return {
    policies: rows.map(policyShape),
    usedBy: new Map(rows.map((row) => [row.id, wallets.filter((wallet) => wallet.policy_id === row.id).map((wallet) => wallet.name)]))
  };
}

export async function policyPageData(session, policyId) {
  const row = await getPolicy(null, session.organization.id, policyId);
  if (!row) return null;
  const revisions = await query(
    'SELECT revision, name, created_at FROM policy_revisions WHERE policy_id = $1 ORDER BY revision',
    [policyId]
  );
  return {
    policy: policyShape(row),
    revisions: revisions.rows.map((entry) => ({ revision: entry.revision, name: entry.name, created_at: formatTimestamp(entry.created_at) })),
    wallets: (await listWallets(null, session.organization.id)).map(walletShape),
    aggregations: (await listAggregations(null, session.organization.id)).map(aggregationShape)
  };
}

export async function quorumsData(session) {
  const quorums = (await listQuorums(null, session.organization.id)).map(quorumShape);
  const aggregations = (await listAggregations(null, session.organization.id)).map(aggregationShape);
  const wallets = await listWallets(null, session.organization.id);
  const policies = await listPolicies(null, session.organization.id);
  const members = await listMembers(null, session.organization.id);
  return {
    quorums,
    aggregations,
    members: members.map(memberShape),
    names: new Map(members.map((row) => [row.id, row.name])),
    walletsByQuorum: new Map(quorums.map((quorum) => [quorum.id, wallets.filter((wallet) => wallet.quorum_id === quorum.id).map((wallet) => wallet.name)])),
    policiesByAggregation: new Map(aggregations.map((aggregation) => [
      aggregation.id,
      policies.filter((policy) => JSON.stringify(policy.rules).includes(`aggregation.${aggregation.id}`)).map((policy) => policy.name)
    ]))
  };
}

export async function auditData(session) {
  const events = await query(
    'SELECT seq, type, actor, subject_id, at, data, prev_hash, hash FROM audit_events WHERE organization_id = $1 ORDER BY seq',
    [session.organization.id]
  );
  const signed = await query(
    'SELECT id, seq, type, created_at, timestamp, body, signature FROM webhook_events WHERE organization_id = $1 ORDER BY seq DESC LIMIT 100',
    [session.organization.id]
  );
  return {
    events: events.rows.slice(-100).reverse().map((row) => ({
      seq: Number(row.seq),
      type: row.type,
      actor: row.actor,
      subject_id: row.subject_id,
      at: formatTimestamp(row.at),
      hash: row.hash
    })),
    signed: signed.rows.map((row) => ({
      seq: Number(row.seq),
      type: row.type,
      created_at: formatTimestamp(row.created_at),
      signature: row.signature
    })),
    chain: verifyChain(events.rows)
  };
}

export async function settingsData(session) {
  const members = (await listMembers(null, session.organization.id)).map(memberShape);
  const keys = (await listApiKeys(null, session.organization.id)).map(apiKeyShape);
  return {
    members,
    apiKeys: keys,
    names: new Map(members.map((member) => [member.id, member.name]))
  };
}

export async function intentsPageData(session, { status, walletId, cursor, limit = 20 }) {
  await expireDueIntents(session.organization.id);
  const conditions = ['i.organization_id = $1'];
  const params = [session.organization.id];
  if (status) {
    params.push(status);
    conditions.push(`i.status = $${params.length}`);
  }
  if (walletId) {
    params.push(walletId);
    conditions.push(`i.wallet_id = $${params.length}`);
  }
  if (cursor) {
    params.push(cursor.createdAt, cursor.id);
    conditions.push(`(i.created_at, i.id) < ($${params.length - 1}::timestamptz, $${params.length})`);
  }
  params.push(limit + 1);
  const result = await query(
    `${INTENT_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY i.created_at DESC, i.id DESC LIMIT $${params.length}`,
    params
  );
  const page = result.rows.slice(0, limit);
  return {
    rows: page,
    items: await intentShapes(null, page),
    assets: new Map(page.map((row) => [row.id, row.wallet_asset])),
    walletNames: new Map(page.map((row) => [row.id, row.wallet_name])),
    hasMore: result.rows.length > limit,
    names: await memberNames(session.organization.id)
  };
}
