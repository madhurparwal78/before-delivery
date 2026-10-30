import { formatAmount } from '../domain/amounts.js';
import { formatTimestamp } from '../domain/time.js';
import { query } from './pool.js';

const RESERVED_SQL = `(SELECT COALESCE(SUM(i.raw_amount), 0)::text FROM intents i
  WHERE i.wallet_id = w.id AND i.status = 'pending_approval')`;

const WALLET_SELECT = `SELECT w.*, ${RESERVED_SQL} AS reserved_raw FROM wallets w`;

export function runner(client) {
  return client || { query: (text, params) => query(text, params) };
}

export function walletShape(row) {
  const balanceRaw = BigInt(row.balance_raw);
  const reservedRaw = BigInt(row.reserved_raw ?? '0');
  const availableRaw = balanceRaw - reservedRaw;
  return {
    id: row.id,
    name: row.name,
    chain: row.chain,
    asset: row.asset,
    address: row.address,
    balance: formatAmount(balanceRaw, row.asset),
    balance_raw: balanceRaw.toString(),
    reserved: formatAmount(reservedRaw, row.asset),
    reserved_raw: reservedRaw.toString(),
    available: formatAmount(availableRaw, row.asset),
    available_raw: availableRaw.toString(),
    policy_id: row.policy_id ?? null,
    quorum_id: row.quorum_id ?? null,
    approval_floor: formatAmount(row.approval_floor_raw, row.asset),
    approval_floor_raw: BigInt(row.approval_floor_raw).toString(),
    status: row.status,
    created_at: formatTimestamp(row.created_at)
  };
}

export async function getWallet(client, organizationId, walletId) {
  const result = await runner(client).query(`${WALLET_SELECT} WHERE w.id = $1 AND w.organization_id = $2`, [walletId, organizationId]);
  return result.rows[0] || null;
}

export async function lockWallet(client, organizationId, walletId) {
  const locked = await client.query('SELECT id FROM wallets WHERE id = $1 AND organization_id = $2 FOR UPDATE', [walletId, organizationId]);
  if (!locked.rows.length) return null;
  return getWallet(client, organizationId, walletId);
}

export async function listWallets(client, organizationId) {
  const result = await runner(client).query(`${WALLET_SELECT} WHERE w.organization_id = $1`, [organizationId]);
  return result.rows.sort((a, b) => {
    const left = a.name.normalize('NFC');
    const right = b.name.normalize('NFC');
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

export async function getWalletByAddress(client, organizationId, address) {
  const result = await runner(client).query(
    `${WALLET_SELECT} WHERE w.organization_id = $1 AND w.address = $2`,
    [organizationId, address]
  );
  return result.rows[0] || null;
}

export function policyShape(row) {
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    chain_type: row.chain_type,
    rules: row.rules,
    revision: row.revision,
    created_at: formatTimestamp(row.created_at),
    updated_at: formatTimestamp(row.updated_at)
  };
}

export async function getPolicy(client, organizationId, policyId) {
  const result = await runner(client).query('SELECT * FROM policies WHERE id = $1 AND organization_id = $2', [policyId, organizationId]);
  return result.rows[0] || null;
}

export async function listPolicies(client, organizationId) {
  const result = await runner(client).query('SELECT * FROM policies WHERE organization_id = $1 ORDER BY name', [organizationId]);
  return result.rows;
}

export function quorumShape(row) {
  return {
    id: row.id,
    name: row.name,
    member_ids: row.member_ids,
    authorization_threshold: row.authorization_threshold,
    expiry_seconds: row.expiry_seconds,
    created_at: formatTimestamp(row.created_at)
  };
}

export async function getQuorum(client, organizationId, quorumId) {
  const result = await runner(client).query('SELECT * FROM key_quorums WHERE id = $1 AND organization_id = $2', [quorumId, organizationId]);
  return result.rows[0] || null;
}

export async function listQuorums(client, organizationId) {
  const result = await runner(client).query('SELECT * FROM key_quorums WHERE organization_id = $1 ORDER BY created_at, id', [organizationId]);
  return result.rows;
}

export function aggregationShape(row) {
  return {
    id: row.id,
    name: row.name,
    metric: row.metric,
    window_seconds: row.window_seconds,
    asset: row.asset,
    group_by: row.group_by,
    created_at: formatTimestamp(row.created_at)
  };
}

export async function listAggregations(client, organizationId) {
  const result = await runner(client).query('SELECT * FROM aggregations WHERE organization_id = $1 ORDER BY created_at, id', [organizationId]);
  return result.rows;
}

export function memberShape(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    created_at: formatTimestamp(row.created_at)
  };
}

export async function listMembers(client, organizationId) {
  const result = await runner(client).query('SELECT * FROM members WHERE organization_id = $1 ORDER BY email', [organizationId]);
  return result.rows;
}

export async function getMember(client, organizationId, memberId) {
  const result = await runner(client).query('SELECT * FROM members WHERE id = $1 AND organization_id = $2', [memberId, organizationId]);
  return result.rows[0] || null;
}

export function apiKeyShape(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    prefix: row.prefix,
    created_by: row.created_by,
    created_at: formatTimestamp(row.created_at),
    revoked_at: formatTimestamp(row.revoked_at)
  };
}

export async function listApiKeys(client, organizationId) {
  const result = await runner(client).query('SELECT * FROM api_keys WHERE organization_id = $1 ORDER BY created_at, id', [organizationId]);
  return result.rows;
}

const INTENT_SELECT = `SELECT i.*, w.asset AS wallet_asset, w.name AS wallet_name, w.status AS wallet_status
  FROM intents i JOIN wallets w ON w.id = i.wallet_id`;

export async function getIntent(client, organizationId, intentId) {
  const result = await runner(client).query(`${INTENT_SELECT} WHERE i.id = $1 AND i.organization_id = $2`, [intentId, organizationId]);
  return result.rows[0] || null;
}

export async function lockIntent(client, organizationId, intentId) {
  const locked = await client.query('SELECT id FROM intents WHERE id = $1 AND organization_id = $2 FOR UPDATE', [intentId, organizationId]);
  if (!locked.rows.length) return null;
  return getIntent(client, organizationId, intentId);
}

export async function loadIntentDetails(client, intentIds) {
  if (!intentIds.length) return { approvals: new Map(), items: new Map() };
  const run = runner(client);
  const approvalRows = await run.query(
    'SELECT * FROM approvals WHERE intent_id = ANY($1) ORDER BY created_at, member_id',
    [intentIds]
  );
  const itemRows = await run.query(
    'SELECT * FROM intent_items WHERE intent_id = ANY($1) ORDER BY position',
    [intentIds]
  );
  const approvals = new Map();
  for (const row of approvalRows.rows) {
    if (!approvals.has(row.intent_id)) approvals.set(row.intent_id, []);
    approvals.get(row.intent_id).push(row);
  }
  const items = new Map();
  for (const row of itemRows.rows) {
    if (!items.has(row.intent_id)) items.set(row.intent_id, []);
    items.get(row.intent_id).push(row);
  }
  return { approvals, items };
}

export function intentShape(row, approvalRows = [], itemRows = []) {
  const asset = row.wallet_asset;
  return {
    id: row.id,
    wallet_id: row.wallet_id,
    kind: row.kind,
    destination_address: row.destination_address ?? null,
    amount: formatAmount(row.raw_amount, asset),
    raw_amount: BigInt(row.raw_amount).toString(),
    memo: row.memo ?? null,
    status: row.status,
    created_by: row.created_by,
    required_approvals: row.required_approvals,
    quorum_member_ids: row.quorum_member_ids,
    approvals: approvalRows.map((approval) => ({
      member_id: approval.member_id,
      decision: approval.decision,
      reason: approval.reason ?? null,
      created_at: formatTimestamp(approval.created_at)
    })),
    policy_decision: row.policy_decision ?? null,
    created_at: formatTimestamp(row.created_at),
    expires_at: formatTimestamp(row.expires_at),
    decided_at: formatTimestamp(row.decided_at),
    executed_at: formatTimestamp(row.executed_at),
    tx_hash: row.tx_hash ?? null,
    rejection_reason: row.rejection_reason ?? null,
    items: itemRows.map((item) => ({
      position: item.position,
      destination_address: item.destination_address,
      amount: formatAmount(item.raw_amount, asset),
      raw_amount: BigInt(item.raw_amount).toString(),
      memo: item.memo ?? null
    }))
  };
}

export async function intentShapes(client, rows) {
  const { approvals, items } = await loadIntentDetails(client, rows.map((row) => row.id));
  return rows.map((row) => intentShape(row, approvals.get(row.id) || [], items.get(row.id) || []));
}

export async function intentShapeOf(client, row) {
  const shapes = await intentShapes(client, [row]);
  return shapes[0];
}
