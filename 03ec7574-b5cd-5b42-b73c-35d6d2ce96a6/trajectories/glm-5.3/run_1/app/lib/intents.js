import { errors, ApiError, NOT_FOUND_CODES } from './http.js';
import {
  newId, parseAmount, numToBigInt, txHash, formatTs,
} from './core.js';
import { normalizeAddress, AddressError } from './address.js';
import { AmountError } from './core.js';
import { textField } from './text.js';
import { auditAppend } from './audit.js';
import { evaluatePolicy, noPolicyDecision, aggregationValuesForPolicy, aggValuesByField } from './policy.js';
import { isPlainObject } from './validate.js';

export const INTENT_STATUSES = ['pending_approval', 'executed', 'rejected', 'cancelled', 'expired'];

export async function lockWallet(client, walletId) {
  const { rows } = await client.query(
    'SELECT * FROM wallets WHERE id = $1 FOR UPDATE', [walletId]);
  return rows[0] || null;
}

export async function getWallet(client, orgId, walletId) {
  const { rows } = await client.query(
    'SELECT * FROM wallets WHERE id = $1 AND organization_id = $2', [walletId, orgId]);
  return rows[0] || null;
}

export async function reservedRaw(client, walletId) {
  const { rows } = await client.query(
    `SELECT coalesce(sum(raw_amount),0)::text AS s FROM intents
     WHERE wallet_id = $1 AND status = 'pending_approval'`, [walletId]);
  return numToBigInt(rows[0].s);
}

// Applies expiry to every due pending intent of one organization (or all).
// Exactly one intent.expired event per intent, whoever gets there first.
export async function applyExpiry(client, at, orgId = null) {
  const params = [at];
  let sql = `SELECT id, organization_id, wallet_id, kind, raw_amount::text AS raw, expires_at
             FROM intents WHERE status = 'pending_approval' AND expires_at <= $1`;
  if (orgId) {
    sql += ' AND organization_id = $2';
    params.push(orgId);
  }
  sql += ' LIMIT 200';
  const { rows } = await client.query(sql, params);
  for (const intent of rows) {
    const upd = await client.query(
      `UPDATE intents SET status = 'expired', decided_at = expires_at
       WHERE id = $1 AND status = 'pending_approval' RETURNING id`,
      [intent.id]
    );
    if (upd.rowCount === 1) {
      const data = {
        intent_id: intent.id, wallet_id: intent.wallet_id, kind: intent.kind,
        raw_amount: intent.raw, status: 'expired',
      };
      await auditAppend(client, intent.organization_id, 'intent.expired', 'system',
        intent.id, new Date(intent.expires_at), data, { signed: true });
    }
  }
  return rows.length;
}

export function actorOf(ctx) {
  if (ctx.kind === 'api_key') return `api_key:${ctx.apiKey.prefix}`;
  return ctx.member.email;
}

// ---- body checks ----------------------------------------------------------

export const AMOUNT_MESSAGES = {
  INVALID_AMOUNT: 'Enter an amount like 1250 or 0.5',
  AMOUNT_PRECISION: 'The asset allows fewer decimal places',
  AMOUNT_NOT_POSITIVE: 'Enter an amount greater than zero',
  AMOUNT_TOO_LARGE: 'The amount is too large',
};

export const ADDRESS_MESSAGES = {
  INVALID_ADDRESS: 'Enter a destination address like 0x followed by 40 hex characters',
  INVALID_ADDRESS_CHECKSUM: 'This address has a wrong checksum',
};

export function checkAmount(value, asset, field, opts) {
  try {
    return parseAmount(value, asset, field, opts);
  } catch (e) {
    if (e instanceof AmountError) {
      throw new ApiError(422, e.code, AMOUNT_MESSAGES[e.code], { field });
    }
    throw e;
  }
}

export function checkAddress(value, field) {
  try {
    return normalizeAddress(value, field);
  } catch (e) {
    if (e instanceof AddressError) {
      throw new ApiError(422, e.code, ADDRESS_MESSAGES[e.code], { field });
    }
    throw e;
  }
}

export function checkMemo(value, field = 'memo') {
  if (value === undefined) return '';
  return textField(value, { field, min: 0, max: 140, trim: false });
}

// ---- execution ------------------------------------------------------------

export async function executeIntent(client, ctx, intent, wallet, at) {
  const raw = numToBigInt(intent.raw_amount);
  const items = intent.kind === 'batch'
    ? (await client.query('SELECT * FROM intent_items WHERE intent_id = $1 ORDER BY position', [intent.id])).rows
    : [{ position: 0, destination_address: intent.destination_address, raw_amount: intent.raw_amount, memo: intent.memo }];
  const orgId = intent.organization_id;
  for (const item of items) {
    const dest = item.destination_address;
    const { rows: destWallets } = await client.query(
      'SELECT id FROM wallets WHERE organization_id = $1 AND address = $2', [orgId, dest]);
    const destWalletId = destWallets[0] ? destWallets[0].id : null;
    const itemRaw = numToBigInt(item.raw_amount);
    if (destWalletId) {
      await client.query('SELECT id FROM wallets WHERE id = $1 FOR UPDATE', [destWalletId]);
      await client.query('UPDATE wallets SET balance_raw = balance_raw + $1 WHERE id = $2',
        [itemRaw.toString(), destWalletId]);
    }
    const movement = newId('evt');
    const kind = intent.kind === 'batch' ? 'batch_line' : 'transfer';
    await ledgerPairRow(client, orgId, movement, kind, wallet.id, destWalletId || 'external',
      wallet.asset, itemRaw, intent.id, null, at);
  }
  await client.query('UPDATE wallets SET balance_raw = balance_raw - $1 WHERE id = $2',
    [raw.toString(), wallet.id]);
  const hash = txHash(intent.id);
  await client.query(
    `UPDATE intents SET status = 'executed', decided_at = $1, executed_at = $1, tx_hash = $2
     WHERE id = $3`, [at, hash, intent.id]);
  const data = { intent_id: intent.id, wallet_id: intent.wallet_id, kind: intent.kind, raw_amount: raw.toString(), status: 'executed' };
  await auditAppend(client, orgId, 'intent.executed', actorOf(ctx), intent.id, at, data, { signed: true });
  return hash;
}

async function ledgerPairRow(client, orgId, movementId, kind, minusAccount, plusAccount, asset, rawAmount, intentId, depositId, at) {
  await client.query(
    `INSERT INTO ledger_entries (id, organization_id, movement_id, kind, account, asset, raw_amount, intent_id, deposit_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [newId('evt'), orgId, movementId, kind, minusAccount, asset, (-rawAmount).toString(), intentId, depositId, at]
  );
  await client.query(
    `INSERT INTO ledger_entries (id, organization_id, movement_id, kind, account, asset, raw_amount, intent_id, deposit_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [newId('evt'), orgId, movementId, kind, plusAccount, asset, rawAmount.toString(), intentId, depositId, at]
  );
}

export async function recordDepositPair(client, orgId, wallet, rawAmount, depositId, at) {
  const movement = newId('evt');
  await ledgerPairRow(client, orgId, movement, 'deposit', 'external', wallet.id, wallet.asset, rawAmount, null, depositId, at);
}

// ---- policy ---------------------------------------------------------------

export async function policyDecisionForRequest(client, orgId, wallet, method, destination, lineAmount, at, requestLines) {
  if (!wallet.policy_id) return { decision: noPolicyDecision(), values: {} };
  const { rows: [policy] } = await client.query(
    'SELECT * FROM policies WHERE id = $1 AND organization_id = $2', [wallet.policy_id, orgId]);
  if (!policy) return { decision: noPolicyDecision(), values: {} };
  const aggValues = await aggregationValuesForPolicy(client, orgId, policy.rules, wallet, destination, at, requestLines, 1);
  const request = {
    method,
    source: { asset: wallet.asset, chain: wallet.chain, amount: lineAmount },
    destination: { address: destination },
    now: BigInt(Math.floor(at.getTime() / 1000)),
  };
  const result = evaluatePolicy(policy.rules, request, aggValuesByField(aggValues));
  return {
    decision: {
      action: result.action, rule: result.rule, reason: result.reason,
      policy_id: policy.id, policy_revision: policy.revision,
    },
    values: aggValues,
    trace: result.trace,
  };
}
