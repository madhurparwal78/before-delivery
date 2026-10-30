import { numToBigInt, rawToDisplay, formatTs, walletAddress } from './core.js';
import { reservedRaw } from './intents.js';

// Every response shape is built here, from row to wire, in one place.

export async function walletResponse(client, wallet, reservedCache) {
  const reserved = reservedCache !== undefined ? reservedCache : await reservedRaw(client, wallet.id);
  const balance = numToBigInt(wallet.balance_raw);
  const available = balance - reserved;
  return {
    id: wallet.id, name: wallet.name, chain: wallet.chain, asset: wallet.asset,
    address: wallet.address,
    balance: rawToDisplay(balance, wallet.asset), balance_raw: balance.toString(),
    reserved: rawToDisplay(reserved, wallet.asset), reserved_raw: reserved.toString(),
    available: rawToDisplay(available, wallet.asset), available_raw: available.toString(),
    policy_id: wallet.policy_id, quorum_id: wallet.quorum_id,
    approval_floor: wallet.approval_floor_raw == null ? '0' : rawToDisplay(numToBigInt(wallet.approval_floor_raw), wallet.asset),
    approval_floor_raw: numToBigInt(wallet.approval_floor_raw ?? 0).toString(),
    status: wallet.status, created_at: formatTs(wallet.created_at),
  };
}

export async function walletsResponse(client, wallets) {
  const { rows } = await client.query(
    `SELECT wallet_id, coalesce(sum(raw_amount),0)::text AS s FROM intents
     WHERE status = 'pending_approval' GROUP BY wallet_id`
  );
  const byWallet = new Map(rows.map((r) => [r.wallet_id, numToBigInt(r.s)]));
  const out = [];
  for (const w of wallets) {
    out.push(await walletResponse(client, w, byWallet.get(w.id) || 0n));
  }
  return out;
}

export async function intentResponse(client, intent) {
  const { rows: approvals } = await client.query(
    'SELECT * FROM approvals WHERE intent_id = $1 ORDER BY created_at, member_id', [intent.id]);
  const items = intent.kind === 'batch'
    ? (await client.query('SELECT * FROM intent_items WHERE intent_id = $1 ORDER BY position', [intent.id])).rows
    : [];
  const { rows: [wallet] } = await client.query('SELECT asset FROM wallets WHERE id = $1', [intent.wallet_id]);
  const asset = wallet ? wallet.asset : null;
  const dec = intent.raw_amount == null ? null : numToBigInt(intent.raw_amount);
  return {
    id: intent.id,
    wallet_id: intent.wallet_id,
    kind: intent.kind,
    destination_address: intent.destination_address,
    amount: dec == null ? null : rawToDisplay(dec, asset),
    raw_amount: dec == null ? null : dec.toString(),
    memo: intent.memo,
    status: intent.status,
    created_by: intent.created_by,
    required_approvals: intent.required_approvals,
    quorum_member_ids: intent.quorum_member_ids || [],
    approvals: approvals.map((a) => ({
      member_id: a.member_id, decision: a.decision, reason: a.reason, created_at: formatTs(a.created_at),
    })),
    policy_decision: intent.policy_decision,
    created_at: formatTs(intent.created_at),
    expires_at: intent.expires_at ? formatTs(intent.expires_at) : null,
    decided_at: intent.decided_at ? formatTs(intent.decided_at) : null,
    executed_at: intent.executed_at ? formatTs(intent.executed_at) : null,
    tx_hash: intent.tx_hash,
    rejection_reason: intent.rejection_reason,
    items: items.map((it) => ({
      position: it.position,
      destination_address: it.destination_address,
      amount: rawToDisplay(numToBigInt(it.raw_amount), asset),
      raw_amount: numToBigInt(it.raw_amount).toString(),
      memo: it.memo,
    })),
  };
}

export function memberResponse(m) {
  return { id: m.id, name: m.name, email: m.email, role: m.role, created_at: formatTs(m.created_at) };
}

export function apiKeyResponse(k) {
  return {
    id: k.id, name: k.name, role: k.role, prefix: k.prefix, created_by: k.created_by,
    created_at: formatTs(k.created_at), revoked_at: k.revoked_at ? formatTs(k.revoked_at) : null,
  };
}

export function policyResponse(p) {
  return {
    id: p.id, version: p.version, name: p.name, chain_type: p.chain_type, rules: p.rules,
    revision: p.revision, created_at: formatTs(p.created_at), updated_at: formatTs(p.updated_at),
  };
}

export function quorumResponse(q) {
  return {
    id: q.id, name: q.name, member_ids: q.member_ids,
    authorization_threshold: q.authorization_threshold, expiry_seconds: q.expiry_seconds,
    created_at: formatTs(q.created_at),
  };
}

export function aggregationResponse(a) {
  return {
    id: a.id, name: a.name, metric: a.metric, window_seconds: a.window_seconds,
    asset: a.asset, group_by: a.group_by, created_at: formatTs(a.created_at),
  };
}

export function depositResponse(d, asset) {
  return {
    id: d.id, wallet_id: d.wallet_id, amount: rawToDisplay(numToBigInt(d.raw_amount), asset),
    raw_amount: numToBigInt(d.raw_amount).toString(), reference: d.reference,
    created_by: d.created_by, created_at: formatTs(d.created_at),
  };
}
