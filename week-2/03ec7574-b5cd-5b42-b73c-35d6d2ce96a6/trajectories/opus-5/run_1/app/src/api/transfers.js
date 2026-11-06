import { lockOrganization, withTransaction } from '../db/pool.js';
import { getPolicy, getQuorum, getWalletByAddress, intentShapeOf, lockWallet } from '../db/repo.js';
import { appendEvent } from '../domain/audit.js';
import { decide } from '../domain/decide.js';
import { createIntent } from '../domain/treasury.js';
import { ApiError } from '../http/errors.js';
import { ensureKnownFields, requireAddress, requireAmount, requireText, validationError } from '../http/validate.js';

const TRANSFER_SCHEMA = { destination_address: true, amount: true, memo: true };
const BATCH_SCHEMA = { items: [{ destination_address: true, amount: true, memo: true }] };

/** The transfer body's pinned field order, shared by transfers and every batch line. */
async function readLine(client, organization, wallet, line, details = {}) {
  try {
    return await readLineFields(client, organization, wallet, line, details);
  } catch (error) {
    if (error instanceof ApiError && details.index !== undefined) {
      error.details = { index: details.index, ...error.details };
    }
    throw error;
  }
}

async function readLineFields(client, organization, wallet, line, details) {
  const rawAmount = requireAmount(line.amount, wallet.asset, fieldPath(details, 'amount'));
  const address = requireAddress(line.destination_address, fieldPath(details, 'destination_address'), details);
  if (address === wallet.address) {
    throw new ApiError('SELF_TRANSFER', { details: { ...details, field: fieldPath(details, 'destination_address') } });
  }
  const sibling = await getWalletByAddress(client, organization.id, address);
  if (sibling && (sibling.chain !== wallet.chain || sibling.asset !== wallet.asset)) {
    throw new ApiError('ASSET_MISMATCH', { details: { ...details, field: fieldPath(details, 'destination_address') } });
  }
  const memo = line.memo === undefined || line.memo === null
    ? ''
    : requireText(line.memo, 'memo', fieldPath(details, 'memo'));
  return { rawAmount, address, memo };
}

function fieldPath(details, field) {
  return details.index === undefined ? field : `items.${details.index}.${field}`;
}

async function loadPolicy(client, organizationId, wallet) {
  if (!wallet.policy_id) return null;
  const row = await getPolicy(client, organizationId, wallet.policy_id);
  return row ? { id: row.id, revision: row.revision, rules: row.rules } : null;
}

async function recordDenial(client, organization, wallet, actor, rawAmount, decision, index) {
  await appendEvent(client, {
    organizationId: organization.id,
    webhookSecret: organization.webhook_secret,
    type: 'transfer.denied',
    actor,
    subjectId: wallet.id,
    at: organization.now,
    data: {
      wallet_id: wallet.id,
      raw_amount: rawAmount.toString(),
      rule: decision.rule,
      reason: decision.reason,
      policy_revision: decision.policy_revision,
      ...(index === undefined ? {} : { index })
    }
  });
}

function denialError(decision, index) {
  return new ApiError('POLICY_DENIED', {
    details: {
      ...(index === undefined ? {} : { index }),
      rule: decision.rule,
      reason: decision.reason,
      policy_revision: decision.policy_revision
    }
  });
}

export async function createTransfer(ctx) {
  const outcome = await withTransaction(async (client) => {
    const organization = await lockOrganization(client, ctx.organization.id);
    const wallet = await lockWallet(client, organization.id, ctx.params.id);
    if (!wallet) throw new ApiError('WALLET_NOT_FOUND');

    ensureKnownFields(ctx.body, TRANSFER_SCHEMA);
    const line = await readLine(client, organization, wallet, ctx.body);
    if (wallet.status === 'frozen') throw new ApiError('WALLET_FROZEN');

    const policy = await loadPolicy(client, organization.id, wallet);
    const { decision } = await decide(client, {
      organization,
      wallet,
      policy,
      method: 'transfer',
      destinationAddress: line.address,
      rawAmount: line.rawAmount,
      now: organization.now
    });
    if (decision.action === 'DENY') {
      await recordDenial(client, organization, wallet, ctx.principal.actor, line.rawAmount, decision);
      return { denial: denialError(decision) };
    }

    const available = BigInt(wallet.balance_raw) - BigInt(wallet.reserved_raw);
    if (line.rawAmount > available) throw new ApiError('INSUFFICIENT_FUNDS');

    const quorum = wallet.quorum_id ? await getQuorum(client, organization.id, wallet.quorum_id) : null;
    const intent = await createIntent(client, {
      organization,
      wallet,
      quorum,
      kind: 'transfer',
      destinationAddress: line.address,
      rawAmount: line.rawAmount,
      memo: line.memo,
      policyDecision: {
        action: decision.action,
        rule: decision.rule,
        reason: decision.reason,
        policy_id: decision.policy_id,
        policy_revision: decision.policy_revision
      },
      createdBy: ctx.createdBy,
      actor: ctx.principal.actor,
      now: organization.now
    });
    return { intent: await intentShapeOf(client, intent) };
  });
  if (outcome.denial) throw outcome.denial;
  return { status: 201, data: outcome.intent };
}

export async function createBatch(ctx) {
  const outcome = await withTransaction(async (client) => {
    const organization = await lockOrganization(client, ctx.organization.id);
    const wallet = await lockWallet(client, organization.id, ctx.params.id);
    if (!wallet) throw new ApiError('WALLET_NOT_FOUND');

    ensureKnownFields(ctx.body, BATCH_SCHEMA);
    if (!Array.isArray(ctx.body.items) || ctx.body.items.length < 1 || ctx.body.items.length > 100) {
      throw validationError('items');
    }

    const lines = [];
    for (const [index, item] of ctx.body.items.entries()) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new ApiError('VALIDATION_ERROR', { details: { index, field: `items.${index}` } });
      }
      lines.push(await readLine(client, organization, wallet, item, { index }));
    }

    if (wallet.status === 'frozen') throw new ApiError('WALLET_FROZEN');

    const policy = await loadPolicy(client, organization.id, wallet);
    let walletContribution = 0n;
    for (const [index, line] of lines.entries()) {
      walletContribution += line.rawAmount;
      const destinationContribution = lines
        .slice(0, index + 1)
        .filter((entry) => entry.address === line.address)
        .reduce((sum, entry) => sum + entry.rawAmount, 0n);
      const { decision } = await decide(client, {
        organization,
        wallet,
        policy,
        method: 'batch_payout',
        destinationAddress: line.address,
        rawAmount: line.rawAmount,
        contributions: { wallet: walletContribution, destination: destinationContribution },
        now: organization.now
      });
      if (decision.action === 'DENY') {
        await recordDenial(client, organization, wallet, ctx.principal.actor, line.rawAmount, decision, index);
        return { denial: denialError(decision, index) };
      }
      line.decision = decision;
    }

    const total = lines.reduce((sum, line) => sum + line.rawAmount, 0n);
    const available = BigInt(wallet.balance_raw) - BigInt(wallet.reserved_raw);
    if (total > available) throw new ApiError('INSUFFICIENT_FUNDS');

    const quorum = wallet.quorum_id ? await getQuorum(client, organization.id, wallet.quorum_id) : null;
    const last = lines[lines.length - 1].decision;
    const intent = await createIntent(client, {
      organization,
      wallet,
      quorum,
      kind: 'batch',
      destinationAddress: null,
      rawAmount: total,
      memo: '',
      items: lines.map((line, position) => ({
        position,
        destination_address: line.address,
        raw_amount: line.rawAmount,
        memo: line.memo
      })),
      policyDecision: {
        action: last.action,
        rule: last.rule,
        reason: last.reason,
        policy_id: last.policy_id,
        policy_revision: last.policy_revision
      },
      createdBy: ctx.createdBy,
      actor: ctx.principal.actor,
      now: organization.now
    });
    return { intent: await intentShapeOf(client, intent) };
  });
  if (outcome.denial) throw outcome.denial;
  return { status: 201, data: outcome.intent };
}
