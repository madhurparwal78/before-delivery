import { lockOrganization, withTransaction } from '../db/pool.js';
import { getPolicy, getQuorum, getWallet, listWallets, lockWallet, walletShape } from '../db/repo.js';
import { walletAddress } from '../domain/address.js';
import { ASSETS, formatAmount } from '../domain/amounts.js';
import { appendEvent } from '../domain/audit.js';
import { newId } from '../domain/ids.js';
import { CHAINS } from '../domain/policy.js';
import { foldCase } from '../domain/text.js';
import { formatTimestamp } from '../domain/time.js';
import { recordExternalCredit } from '../domain/treasury.js';
import { ApiError } from '../http/errors.js';
import { ensureKnownFields, requireAmount, requireEnum, requireText } from '../http/validate.js';

const WALLET_CREATE_SCHEMA = { name: true, chain: true, asset: true, policy_id: true, quorum_id: true, approval_floor: true };
const WALLET_PATCH_SCHEMA = { name: true, policy_id: true, quorum_id: true, approval_floor: true };

async function assertNameFree(client, organizationId, name, excludeWalletId = null) {
  const folded = foldCase(name);
  const result = await client.query('SELECT id, name FROM wallets WHERE organization_id = $1', [organizationId]);
  for (const row of result.rows) {
    if (row.id === excludeWalletId) continue;
    if (foldCase(row.name) === folded) throw new ApiError('WALLET_NAME_TAKEN');
  }
}

async function resolveReference(client, organizationId, id, kind) {
  const row = kind === 'policy'
    ? await getPolicy(client, organizationId, id)
    : await getQuorum(client, organizationId, id);
  if (!row) throw new ApiError(kind === 'policy' ? 'POLICY_NOT_FOUND' : 'QUORUM_NOT_FOUND');
  return row.id;
}

export async function listWalletsRoute(ctx) {
  const rows = await listWallets(null, ctx.organization.id);
  return { status: 200, data: { wallets: rows.map(walletShape) } };
}

export async function getWalletRoute(ctx) {
  const row = await getWallet(null, ctx.organization.id, ctx.params.id);
  if (!row) throw new ApiError('WALLET_NOT_FOUND');
  return { status: 200, data: walletShape(row) };
}

export async function createWallet(ctx) {
  ensureKnownFields(ctx.body, WALLET_CREATE_SCHEMA);
  const name = requireText(ctx.body.name, 'walletName', 'name', { trim: true });
  const chain = requireEnum(ctx.body.chain, CHAINS, 'chain');
  const asset = requireEnum(ctx.body.asset, ASSETS, 'asset');
  const approvalFloor = ctx.body.approval_floor === undefined || ctx.body.approval_floor === null
    ? 0n
    : requireAmount(ctx.body.approval_floor, asset, 'approval_floor', { allowZero: true });

  const wallet = await withTransaction(async (client) => {
    const organization = await lockOrganization(client, ctx.organization.id);
    const policyId = ctx.body.policy_id === undefined || ctx.body.policy_id === null
      ? null
      : await resolveReference(client, organization.id, ctx.body.policy_id, 'policy');
    const quorumId = ctx.body.quorum_id === undefined || ctx.body.quorum_id === null
      ? null
      : await resolveReference(client, organization.id, ctx.body.quorum_id, 'quorum');
    await assertNameFree(client, organization.id, name);

    const id = newId('wal_');
    await client.query(
      `INSERT INTO wallets (id, organization_id, name, chain, asset, address, balance_raw, policy_id, quorum_id, approval_floor_raw, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, 'active', $10)`,
      [id, organization.id, name, chain, asset, walletAddress(id), policyId, quorumId, approvalFloor.toString(), organization.now]
    );
    await appendEvent(client, {
      organizationId: organization.id,
      webhookSecret: organization.webhook_secret,
      type: 'wallet.created',
      actor: ctx.principal.actor,
      subjectId: id,
      at: organization.now,
      data: {
        wallet_id: id,
        name,
        chain,
        asset,
        address: walletAddress(id),
        policy_id: policyId,
        quorum_id: quorumId,
        approval_floor_raw: approvalFloor.toString()
      }
    });
    return getWallet(client, organization.id, id);
  });
  return { status: 201, data: walletShape(wallet) };
}

export async function patchWallet(ctx) {
  const wallet = await withTransaction(async (client) => {
    const organization = await lockOrganization(client, ctx.organization.id);
    const current = await lockWallet(client, organization.id, ctx.params.id);
    if (!current) throw new ApiError('WALLET_NOT_FOUND');
    ensureKnownFields(ctx.body, WALLET_PATCH_SCHEMA);

    const changes = {};
    if (ctx.body.name !== undefined) {
      const name = requireText(ctx.body.name, 'walletName', 'name', { trim: true });
      await assertNameFree(client, organization.id, name, current.id);
      changes.name = name;
    }
    if (ctx.body.policy_id !== undefined) {
      changes.policy_id = ctx.body.policy_id === null
        ? null
        : await resolveReference(client, organization.id, ctx.body.policy_id, 'policy');
    }
    if (ctx.body.quorum_id !== undefined) {
      changes.quorum_id = ctx.body.quorum_id === null
        ? null
        : await resolveReference(client, organization.id, ctx.body.quorum_id, 'quorum');
    }
    if (ctx.body.approval_floor !== undefined) {
      changes.approval_floor_raw = ctx.body.approval_floor === null
        ? '0'
        : requireAmount(ctx.body.approval_floor, current.asset, 'approval_floor', { allowZero: true }).toString();
    }

    await client.query(
      `UPDATE wallets SET name = COALESCE($2, name),
         policy_id = CASE WHEN $3 THEN $4 ELSE policy_id END,
         quorum_id = CASE WHEN $5 THEN $6 ELSE quorum_id END,
         approval_floor_raw = COALESCE($7, approval_floor_raw)
       WHERE id = $1`,
      [
        current.id,
        changes.name ?? null,
        'policy_id' in changes,
        changes.policy_id ?? null,
        'quorum_id' in changes,
        changes.quorum_id ?? null,
        changes.approval_floor_raw ?? null
      ]
    );
    await appendEvent(client, {
      organizationId: organization.id,
      webhookSecret: organization.webhook_secret,
      type: 'wallet.updated',
      actor: ctx.principal.actor,
      subjectId: current.id,
      at: organization.now,
      data: { wallet_id: current.id, ...changes }
    });
    return getWallet(client, organization.id, current.id);
  });
  return { status: 200, data: walletShape(wallet) };
}

async function setWalletStatus(ctx, status) {
  const wallet = await withTransaction(async (client) => {
    const organization = await lockOrganization(client, ctx.organization.id);
    const current = await lockWallet(client, organization.id, ctx.params.id);
    if (!current) throw new ApiError('WALLET_NOT_FOUND');
    if (status === 'frozen' && current.status === 'frozen') throw new ApiError('WALLET_FROZEN');
    if (status === 'active' && current.status === 'active') throw new ApiError('WALLET_NOT_FROZEN');
    await client.query('UPDATE wallets SET status = $2 WHERE id = $1', [current.id, status]);
    await appendEvent(client, {
      organizationId: organization.id,
      webhookSecret: organization.webhook_secret,
      type: status === 'frozen' ? 'wallet.frozen' : 'wallet.unfrozen',
      actor: ctx.principal.actor,
      subjectId: current.id,
      at: organization.now,
      data: { wallet_id: current.id, status }
    });
    return getWallet(client, organization.id, current.id);
  });
  return { status: 200, data: walletShape(wallet) };
}

export function freezeWallet(ctx) {
  return setWalletStatus(ctx, 'frozen');
}

export function unfreezeWallet(ctx) {
  return setWalletStatus(ctx, 'active');
}

export async function createDeposit(ctx) {
  const deposit = await withTransaction(async (client) => {
    const organization = await lockOrganization(client, ctx.organization.id);
    const wallet = await lockWallet(client, organization.id, ctx.params.id);
    if (!wallet) throw new ApiError('WALLET_NOT_FOUND');
    ensureKnownFields(ctx.body, { amount: true, reference: true });

    const rawAmount = requireAmount(ctx.body.amount, wallet.asset, 'amount');
    const reference = requireText(ctx.body.reference, 'depositReference', 'reference', { trim: true });

    const existing = await client.query('SELECT id FROM deposits WHERE wallet_id = $1 AND reference = $2', [wallet.id, reference]);
    if (existing.rows.length) throw new ApiError('DUPLICATE_DEPOSIT');

    const id = newId('dep_');
    await client.query(
      'INSERT INTO deposits (id, wallet_id, raw_amount, reference, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, wallet.id, rawAmount.toString(), reference, ctx.createdBy, organization.now]
    );
    await client.query('UPDATE wallets SET balance_raw = balance_raw + $2 WHERE id = $1', [wallet.id, rawAmount.toString()]);
    await recordExternalCredit(client, {
      organizationId: organization.id,
      kind: 'deposit',
      asset: wallet.asset,
      account: wallet.id,
      rawAmount,
      depositId: id,
      now: organization.now
    });
    await appendEvent(client, {
      organizationId: organization.id,
      webhookSecret: organization.webhook_secret,
      type: 'deposit.received',
      actor: ctx.principal.actor,
      subjectId: id,
      at: organization.now,
      data: { deposit_id: id, wallet_id: wallet.id, raw_amount: rawAmount.toString() }
    });
    return {
      id,
      wallet_id: wallet.id,
      amount: formatAmount(rawAmount, wallet.asset),
      raw_amount: rawAmount.toString(),
      reference,
      created_by: ctx.createdBy,
      created_at: formatTimestamp(organization.now)
    };
  });
  return { status: 201, data: deposit };
}
