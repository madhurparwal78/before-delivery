import { getIntent, getWalletByAddress } from '../db/repo.js';
import { lockOrganization, query, withTransaction } from '../db/pool.js';
import { txHash } from './address.js';
import { appendEvent } from './audit.js';
import { newId } from './ids.js';

const EXTERNAL_ACCOUNT = 'external';

function intentEventData(intent, status) {
  return {
    intent_id: intent.id,
    wallet_id: intent.wallet_id,
    kind: intent.kind,
    raw_amount: BigInt(intent.raw_amount).toString(),
    status
  };
}

/** One balancing pair for a credit from outside: opening balances and deposits. */
export async function recordExternalCredit(client, { organizationId, kind, asset, account, rawAmount, intentId = null, depositId = null, now }) {
  const movementId = newId('mov_');
  const rows = [
    [EXTERNAL_ACCOUNT, (-rawAmount).toString()],
    [account, rawAmount.toString()]
  ];
  for (const [entryAccount, amount] of rows) {
    await client.query(
      `INSERT INTO ledger_entries (id, organization_id, movement_id, kind, account, asset, raw_amount, intent_id, deposit_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [newId('led_'), organizationId, movementId, kind, entryAccount, asset, amount, intentId, depositId, now]
    );
  }
}

async function recordTransferPair(client, { organizationId, kind, asset, sourceWalletId, destinationAccount, rawAmount, intentId, now }) {
  const movementId = newId('mov_');
  const rows = [
    [sourceWalletId, (-rawAmount).toString()],
    [destinationAccount, rawAmount.toString()]
  ];
  for (const [account, amount] of rows) {
    await client.query(
      `INSERT INTO ledger_entries (id, organization_id, movement_id, kind, account, asset, raw_amount, intent_id, deposit_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9)`,
      [newId('led_'), organizationId, movementId, kind, account, asset, amount, intentId, now]
    );
  }
}

async function intentLines(client, intent) {
  if (intent.kind === 'transfer') {
    return [{ destination_address: intent.destination_address, raw_amount: intent.raw_amount }];
  }
  const result = await client.query('SELECT * FROM intent_items WHERE intent_id = $1 ORDER BY position', [intent.id]);
  return result.rows;
}

/** Moves the money of a pending or immediate intent: balances, ledger pairs, status and tx hash. */
export async function executeIntent(client, { organization, wallet, intent, now, actor }) {
  const lines = await intentLines(client, intent);
  const total = lines.reduce((sum, line) => sum + BigInt(line.raw_amount), 0n);
  const credits = new Map();

  for (const line of lines) {
    const sibling = await getWalletByAddress(client, organization.id, line.destination_address);
    const destinationAccount = sibling ? sibling.id : EXTERNAL_ACCOUNT;
    if (sibling) credits.set(sibling.id, (credits.get(sibling.id) || 0n) + BigInt(line.raw_amount));
    await recordTransferPair(client, {
      organizationId: organization.id,
      kind: intent.kind === 'transfer' ? 'transfer' : 'batch_line',
      asset: wallet.asset,
      sourceWalletId: wallet.id,
      destinationAccount,
      rawAmount: BigInt(line.raw_amount),
      intentId: intent.id,
      now
    });
  }

  await client.query('UPDATE wallets SET balance_raw = balance_raw - $2 WHERE id = $1', [wallet.id, total.toString()]);
  for (const [walletId, amount] of credits) {
    await client.query('UPDATE wallets SET balance_raw = balance_raw + $2 WHERE id = $1', [walletId, amount.toString()]);
  }

  const hash = txHash(intent.id);
  await client.query(
    'UPDATE intents SET status = $2, decided_at = $3, executed_at = $3, tx_hash = $4 WHERE id = $1',
    [intent.id, 'executed', now, hash]
  );
  await appendEvent(client, {
    organizationId: organization.id,
    webhookSecret: organization.webhook_secret,
    type: 'intent.executed',
    actor,
    subjectId: intent.id,
    at: now,
    data: intentEventData(intent, 'executed')
  });
  return getIntent(client, organization.id, intent.id);
}

export async function createIntent(client, {
  organization,
  wallet,
  quorum,
  kind,
  destinationAddress,
  rawAmount,
  memo,
  items = [],
  policyDecision,
  createdBy,
  actor,
  now
}) {
  const needsApproval = Boolean(quorum) && rawAmount >= BigInt(wallet.approval_floor_raw);
  const id = newId('int_');
  const expiresAt = needsApproval ? new Date(new Date(now).getTime() + quorum.expiry_seconds * 1000) : null;
  await client.query(
    `INSERT INTO intents (id, organization_id, wallet_id, kind, destination_address, raw_amount, memo, status, created_by,
       required_approvals, quorum_member_ids, policy_decision, created_at, expires_at, decided_at, executed_at, tx_hash, rejection_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NULL, NULL, NULL, NULL)`,
    [
      id,
      organization.id,
      wallet.id,
      kind,
      destinationAddress,
      rawAmount.toString(),
      memo,
      needsApproval ? 'pending_approval' : 'executed',
      createdBy,
      needsApproval ? quorum.authorization_threshold : 0,
      JSON.stringify(needsApproval ? quorum.member_ids : []),
      JSON.stringify(policyDecision),
      now,
      expiresAt
    ]
  );
  for (const item of items) {
    await client.query(
      'INSERT INTO intent_items (intent_id, position, destination_address, raw_amount, memo) VALUES ($1, $2, $3, $4, $5)',
      [id, item.position, item.destination_address, item.raw_amount.toString(), item.memo]
    );
  }

  let intent = await getIntent(client, organization.id, id);
  await appendEvent(client, {
    organizationId: organization.id,
    webhookSecret: organization.webhook_secret,
    type: 'intent.created',
    actor,
    subjectId: id,
    at: now,
    data: intentEventData(intent, needsApproval ? 'pending_approval' : 'executed')
  });

  if (!needsApproval) {
    intent = await executeIntent(client, { organization, wallet, intent, now, actor });
  }
  return intent;
}

export async function expireIntent(client, { organization, intent }) {
  await client.query('UPDATE intents SET status = $2, decided_at = $3 WHERE id = $1', [intent.id, 'expired', intent.expires_at]);
  await appendEvent(client, {
    organizationId: organization.id,
    webhookSecret: organization.webhook_secret,
    type: 'intent.expired',
    actor: 'system',
    subjectId: intent.id,
    at: intent.expires_at,
    data: intentEventData(intent, 'expired')
  });
}

/**
 * Applies expiry to one locked intent row, so decisions in the second of `expires_at`
 * find it already expired.
 */
export async function applyExpiryToIntent(client, { organization, intent, now }) {
  if (intent.status !== 'pending_approval' || !intent.expires_at) return intent;
  if (new Date(now).getTime() < new Date(intent.expires_at).getTime()) return intent;
  await expireIntent(client, { organization, intent });
  return getIntent(client, organization.id, intent.id);
}

/** Expires every due intent of an organization in one transaction, used by reads and by the sweep. */
export async function expireDueIntents(organizationId) {
  const due = await query(
    `SELECT id FROM intents
      WHERE organization_id = $1 AND status = 'pending_approval' AND expires_at <= date_trunc('second', now())
      ORDER BY expires_at LIMIT 100`,
    [organizationId]
  );
  if (!due.rows.length) return;
  await withTransaction(async (client) => {
    const organization = await lockOrganization(client, organizationId);
    if (!organization) return;
    for (const { id } of due.rows) {
      const locked = await client.query(
        `SELECT * FROM intents WHERE id = $1 AND status = 'pending_approval' AND expires_at <= $2 FOR UPDATE`,
        [id, organization.now]
      );
      if (!locked.rows.length) continue;
      await expireIntent(client, { organization, intent: locked.rows[0] });
    }
  });
}

export async function expireDueIntentsEverywhere() {
  const organizations = await query(
    `SELECT DISTINCT organization_id FROM intents
      WHERE status = 'pending_approval' AND expires_at <= date_trunc('second', now())`
  );
  for (const row of organizations.rows) await expireDueIntents(row.organization_id);
}
