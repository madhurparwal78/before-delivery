import { lockOrganization, query, withTransaction } from '../db/pool.js';
import { getIntent, intentShapeOf, intentShapes, lockIntent, lockWallet } from '../db/repo.js';
import { appendEvent } from '../domain/audit.js';
import { formatAmount } from '../domain/amounts.js';
import { formatTimestamp } from '../domain/time.js';
import { applyExpiryToIntent, executeIntent, expireDueIntents } from '../domain/treasury.js';
import { ApiError } from '../http/errors.js';
import { decodeCursor, encodeCursor } from '../http/cursor.js';
import { ensureKnownFields, requireText, validationError } from '../http/validate.js';

export const INTENT_STATUSES = ['pending_approval', 'executed', 'rejected', 'cancelled', 'expired'];

const LIST_SELECT = `SELECT i.*, w.asset AS wallet_asset, w.name AS wallet_name, w.status AS wallet_status
  FROM intents i JOIN wallets w ON w.id = i.wallet_id`;

function readFilters(ctx) {
  const status = ctx.query.get('status');
  if (status !== null && !INTENT_STATUSES.includes(status)) throw validationError('status');
  const walletId = ctx.query.get('wallet_id');
  return { status, walletId };
}

function readLimit(ctx) {
  const raw = ctx.query.get('limit');
  if (raw === null) return 20;
  if (!/^[0-9]+$/.test(raw)) throw validationError('limit');
  const limit = Number.parseInt(raw, 10);
  if (limit < 1 || limit > 100) throw validationError('limit');
  return limit;
}

async function selectIntents(ctx, { status, walletId, limit, cursor }) {
  const conditions = ['i.organization_id = $1'];
  const params = [ctx.organization.id];
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
  let sql = `${LIST_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY i.created_at DESC, i.id DESC`;
  if (limit !== null) {
    params.push(limit + 1);
    sql += ` LIMIT $${params.length}`;
  }
  const result = await query(sql, params);
  return result.rows;
}

export async function listIntents(ctx) {
  await expireDueIntents(ctx.organization.id);
  const { status, walletId } = readFilters(ctx);
  const limit = readLimit(ctx);
  const rawCursor = ctx.query.get('cursor');
  const cursor = rawCursor
    ? decodeCursor(rawCursor, { organizationId: ctx.organization.id, status, walletId }, ctx.organization.webhook_secret)
    : null;

  const rows = await selectIntents(ctx, { status, walletId, limit, cursor });
  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit && page.length
    ? encodeCursor(
      {
        organizationId: ctx.organization.id,
        status,
        walletId,
        createdAt: page[page.length - 1].created_at,
        id: page[page.length - 1].id
      },
      ctx.organization.webhook_secret
    )
    : null;
  return { status: 200, data: { items: await intentShapes(null, page), next_cursor: nextCursor } };
}

const CSV_COLUMNS = [
  'id', 'wallet_id', 'wallet_name', 'kind', 'destination_address', 'amount', 'asset', 'status',
  'created_by', 'created_at', 'executed_at', 'tx_hash', 'memo'
];

function csvCell(value) {
  let cell = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  if (/[",\r\n]/.test(cell)) cell = `"${cell.replace(/"/g, '""')}"`;
  return cell;
}

export async function exportIntents(ctx) {
  await expireDueIntents(ctx.organization.id);
  const { status, walletId } = readFilters(ctx);
  const rows = await selectIntents(ctx, { status, walletId, limit: null, cursor: null });
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push([
      row.id,
      row.wallet_id,
      row.wallet_name,
      row.kind,
      row.destination_address,
      formatAmount(row.raw_amount, row.wallet_asset),
      row.wallet_asset,
      row.status,
      row.created_by,
      formatTimestamp(row.created_at),
      formatTimestamp(row.executed_at),
      row.tx_hash,
      row.memo
    ].map(csvCell).join(','));
  }
  return { status: 200, csv: `${lines.join('\r\n')}\r\n` };
}

export async function getIntentRoute(ctx) {
  await expireDueIntents(ctx.organization.id);
  const row = await getIntent(null, ctx.organization.id, ctx.params.id);
  if (!row) throw new ApiError('INTENT_NOT_FOUND');
  return { status: 200, data: await intentShapeOf(null, row) };
}

export async function approvalsInbox(ctx) {
  await expireDueIntents(ctx.organization.id);
  const result = await query(
    `${LIST_SELECT}
      WHERE i.organization_id = $1
        AND i.status = 'pending_approval'
        AND i.quorum_member_ids @> to_jsonb($2::text)
        AND i.created_by <> $2
        AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.intent_id = i.id AND a.member_id = $2)
      ORDER BY i.created_at DESC, i.id DESC`,
    [ctx.organization.id, ctx.principal.member.id]
  );
  return { status: 200, data: { items: await intentShapes(null, result.rows) } };
}

async function decideIntent(ctx, { decision, body }) {
  const outcome = await withTransaction(async (client) => {
    const organization = await lockOrganization(client, ctx.organization.id);
    let intent = await lockIntent(client, organization.id, ctx.params.id);
    if (!intent) throw new ApiError('INTENT_NOT_FOUND');

    if (ctx.principal.type !== 'member') throw new ApiError('FORBIDDEN_ROLE');

    let reason = null;
    if (decision === 'reject') {
      ensureKnownFields(body, { reason: true });
      reason = requireText(body.reason, 'rejectReason', 'reason');
      if (reason.trim().length === 0) throw validationError('reason');
    } else {
      ensureKnownFields(body, {});
    }

    intent = await applyExpiryToIntent(client, { organization, intent, now: organization.now });
    if (intent.status !== 'pending_approval') throw new ApiError('INTENT_NOT_PENDING');

    const member = ctx.principal.member;
    if (!intent.quorum_member_ids.includes(member.id)) throw new ApiError('NOT_IN_QUORUM');
    if (intent.created_by === member.id) throw new ApiError('SELF_APPROVAL');
    const decided = await client.query('SELECT 1 FROM approvals WHERE intent_id = $1 AND member_id = $2', [intent.id, member.id]);
    if (decided.rows.length) throw new ApiError('ALREADY_DECIDED');

    const wallet = await lockWallet(client, organization.id, intent.wallet_id);
    if (decision === 'approve' && wallet.status === 'frozen') throw new ApiError('WALLET_FROZEN');

    await client.query(
      'INSERT INTO approvals (intent_id, member_id, decision, reason, created_at) VALUES ($1, $2, $3, $4, $5)',
      [intent.id, member.id, decision === 'approve' ? 'approve' : 'reject', reason, organization.now]
    );

    if (decision === 'reject') {
      await client.query(
        'UPDATE intents SET status = $2, decided_at = $3, rejection_reason = $4 WHERE id = $1',
        [intent.id, 'rejected', organization.now, reason]
      );
      await appendEvent(client, {
        organizationId: organization.id,
        webhookSecret: organization.webhook_secret,
        type: 'intent.rejected',
        actor: ctx.principal.actor,
        subjectId: intent.id,
        at: organization.now,
        data: {
          intent_id: intent.id,
          wallet_id: intent.wallet_id,
          kind: intent.kind,
          raw_amount: BigInt(intent.raw_amount).toString(),
          status: 'rejected'
        }
      });
      return { intent: await intentShapeOf(client, await getIntent(client, organization.id, intent.id)) };
    }

    await appendEvent(client, {
      organizationId: organization.id,
      webhookSecret: organization.webhook_secret,
      type: 'intent.approved',
      actor: ctx.principal.actor,
      subjectId: intent.id,
      at: organization.now,
      data: {
        intent_id: intent.id,
        wallet_id: intent.wallet_id,
        kind: intent.kind,
        raw_amount: BigInt(intent.raw_amount).toString(),
        status: 'pending_approval'
      }
    });

    const approvals = await client.query(
      'SELECT COUNT(*)::int AS count FROM approvals WHERE intent_id = $1 AND decision = $2',
      [intent.id, 'approve']
    );
    let final = await getIntent(client, organization.id, intent.id);
    if (approvals.rows[0].count >= intent.required_approvals) {
      final = await executeIntent(client, { organization, wallet, intent: final, now: organization.now, actor: ctx.principal.actor });
    }
    return { intent: await intentShapeOf(client, final) };
  });
  return { status: 200, data: outcome.intent };
}

export function approveIntent(ctx) {
  return decideIntent(ctx, { decision: 'approve', body: ctx.body });
}

export function rejectIntent(ctx) {
  return decideIntent(ctx, { decision: 'reject', body: ctx.body });
}

export async function cancelIntent(ctx) {
  const shape = await withTransaction(async (client) => {
    const organization = await lockOrganization(client, ctx.organization.id);
    let intent = await lockIntent(client, organization.id, ctx.params.id);
    if (!intent) throw new ApiError('INTENT_NOT_FOUND');

    const isOwner = ctx.principal.type === 'member' && ctx.principal.role === 'owner';
    if (!isOwner && intent.created_by !== ctx.createdBy) throw new ApiError('FORBIDDEN_ROLE');

    intent = await applyExpiryToIntent(client, { organization, intent, now: organization.now });
    if (intent.status !== 'pending_approval') throw new ApiError('INTENT_NOT_PENDING');

    await client.query('UPDATE intents SET status = $2, decided_at = $3 WHERE id = $1', [intent.id, 'cancelled', organization.now]);
    await appendEvent(client, {
      organizationId: organization.id,
      webhookSecret: organization.webhook_secret,
      type: 'intent.cancelled',
      actor: ctx.principal.actor,
      subjectId: intent.id,
      at: organization.now,
      data: {
        intent_id: intent.id,
        wallet_id: intent.wallet_id,
        kind: intent.kind,
        raw_amount: BigInt(intent.raw_amount).toString(),
        status: 'cancelled'
      }
    });
    return intentShapeOf(client, await getIntent(client, organization.id, intent.id));
  });
  return { status: 200, data: shape };
}
