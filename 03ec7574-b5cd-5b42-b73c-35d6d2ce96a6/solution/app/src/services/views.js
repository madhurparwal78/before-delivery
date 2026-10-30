import { ApiError, formatAmount, iso } from '../lib/core.js';

// Read-model shapes shared by the API and the console.

// reserved is the sum of the wallet's pending_approval intents; callers apply expiry first.
const RESERVED_SQL = `COALESCE((SELECT sum(p.raw_amount) FROM intents p
  WHERE p.wallet_id = w.id AND p.status = 'pending_approval'), 0)::text AS reserved_raw`;

export function walletView(row) {
  const balance = BigInt(row.balance_raw);
  const reserved = BigInt(row.reserved_raw);
  const available = balance - reserved;
  return {
    id: row.id, name: row.name, chain: row.chain, asset: row.asset, address: row.address,
    balance: formatAmount(balance, row.asset), balance_raw: balance.toString(),
    reserved: formatAmount(reserved, row.asset), reserved_raw: reserved.toString(),
    available: formatAmount(available, row.asset), available_raw: available.toString(),
    policy_id: row.policy_id, quorum_id: row.quorum_id,
    approval_floor: formatAmount(row.approval_floor_raw, row.asset), approval_floor_raw: BigInt(row.approval_floor_raw).toString(),
    status: row.status, created_at: iso(row.created_at),
  };
}

// Wallets of one organization by name, by code point after NFC.
export async function walletRows(db, orgId) {
  const { rows } = await db.query(
    `SELECT w.*, ${RESERVED_SQL} FROM wallets w WHERE w.organization_id = $1 ORDER BY w.name COLLATE "C", w.id`, [orgId]);
  return rows;
}

export async function findWallet(db, orgId, walletId) {
  const { rows } = await db.query(
    `SELECT w.*, ${RESERVED_SQL} FROM wallets w WHERE w.organization_id = $1 AND w.id = $2`, [orgId, walletId]);
  if (!rows.length) throw new ApiError(404, 'WALLET_NOT_FOUND', 'No wallet with that id exists.');
  return rows[0];
}

export const INTENT_SELECT = 'SELECT i.*, w.asset, w.name AS wallet_name FROM intents i JOIN wallets w ON w.id = i.wallet_id';

export async function intentViews(db, rows) {
  if (!rows.length) return [];
  const ids = JSON.stringify(rows.map((r) => r.id));
  const inList = 'intent_id IN (SELECT jsonb_array_elements_text($1::jsonb))';
  const [approvals, items] = await Promise.all([
    db.query(`SELECT * FROM approvals WHERE ${inList} ORDER BY created_at, member_id`, [ids]),
    db.query(`SELECT * FROM intent_items WHERE ${inList} ORDER BY position`, [ids]),
  ]);
  const group = (list) => list.reduce((acc, r) => ((acc[r.intent_id] ||= []).push(r), acc), {});
  const a = group(approvals.rows);
  const it = group(items.rows);
  return rows.map((row) => ({
    id: row.id, wallet_id: row.wallet_id, kind: row.kind, destination_address: row.destination_address,
    amount: formatAmount(row.raw_amount, row.asset), raw_amount: BigInt(row.raw_amount).toString(),
    memo: row.memo, status: row.status, created_by: row.created_by,
    required_approvals: row.required_approvals, quorum_member_ids: row.quorum_member_ids,
    approvals: (a[row.id] || []).map((x) => ({ member_id: x.member_id, decision: x.decision, reason: x.reason,
      created_at: iso(x.created_at) })),
    policy_decision: row.policy_decision,
    created_at: iso(row.created_at), expires_at: iso(row.expires_at), decided_at: iso(row.decided_at),
    executed_at: iso(row.executed_at), tx_hash: row.tx_hash, rejection_reason: row.rejection_reason,
    items: (it[row.id] || []).map((x) => ({ position: x.position, destination_address: x.destination_address,
      amount: formatAmount(x.raw_amount, row.asset), raw_amount: BigInt(x.raw_amount).toString(), memo: x.memo })),
  }));
}

export function depositView(row, asset) {
  return { id: row.id, wallet_id: row.wallet_id, amount: formatAmount(row.raw_amount, asset),
    raw_amount: BigInt(row.raw_amount).toString(), reference: row.reference, created_by: row.created_by,
    created_at: iso(row.created_at) };
}

export function policyView(row) {
  return { id: row.id, version: row.version, name: row.name, chain_type: row.chain_type, rules: row.rules,
    revision: row.revision, created_at: iso(row.created_at), updated_at: iso(row.updated_at) };
}

export function aggregationView(row) {
  return { id: row.id, name: row.name, metric: row.metric, window_seconds: row.window_seconds, asset: row.asset,
    group_by: row.group_by, created_at: iso(row.created_at) };
}

export function quorumView(row) {
  return { id: row.id, name: row.name, member_ids: row.member_ids, authorization_threshold: row.authorization_threshold,
    expiry_seconds: row.expiry_seconds, created_at: iso(row.created_at) };
}

export function memberView(row) {
  return { id: row.id, name: row.name, email: row.email, role: row.role, created_at: iso(row.created_at) };
}

export function keyView(row) {
  return { id: row.id, name: row.name, role: row.role, prefix: row.prefix, created_by: row.created_by,
    created_at: iso(row.created_at), revoked_at: iso(row.revoked_at) };
}
