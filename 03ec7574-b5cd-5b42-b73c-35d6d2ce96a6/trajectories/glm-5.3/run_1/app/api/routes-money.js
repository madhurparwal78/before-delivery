import { errors, ApiError, NOT_FOUND_CODES } from '../lib/http.js';
import { newId, numToBigInt, walletAddress, formatTs, rawToDisplay } from '../lib/core.js';
import { textField, caseFold } from '../lib/text.js';
import { auditAppend } from '../lib/audit.js';
import { withTransaction, withClient } from '../lib/db.js';
import {
  checkAmount, checkAddress, checkMemo, actorOf, executeIntent, applyExpiry,
  lockWallet, getWallet, reservedRaw, policyDecisionForRequest, recordDepositPair,
  INTENT_STATUSES,
} from '../lib/intents.js';
import {
  walletResponse, walletsResponse, intentResponse, depositResponse,
} from '../lib/shapes.js';
import { runWithIdempotency } from './idempotency.js';
import { isPlainObject } from '../lib/validate.js';
import { createHmac } from 'node:crypto';

const notFound = (kind) => errors.notFound(...NOT_FOUND_CODES[kind]);
const nowSeconds = () => new Date(Math.floor(Date.now() / 1000) * 1000);

async function getWalletLocked(client, orgId, walletId) {
  const { rows } = await client.query(
    'SELECT * FROM wallets WHERE id = $1 AND organization_id = $2 FOR UPDATE', [walletId, orgId]);
  return rows[0] || null;
}

async function findSiblingByAddress(client, orgId, address) {
  const { rows } = await client.query(
    'SELECT * FROM wallets WHERE organization_id = $1 AND address = $2', [orgId, address]);
  return rows[0] || null;
}

function createdByOf(ctx) {
  return ctx.kind === 'api_key' ? ctx.apiKey.created_by : ctx.member.id;
}

async function insertIntent(client, orgId, ctx, { wallet, kind, destination, raw, memo, decision, now, pending }) {
  const id = newId('int');
  let quorum = null;
  if (pending) {
    const { rows } = await client.query(
      'SELECT * FROM key_quorums WHERE id = $1 AND organization_id = $2', [wallet.quorum_id, orgId]);
    quorum = rows[0];
  }
  await client.query(
    `INSERT INTO intents (id, organization_id, wallet_id, kind, destination_address, raw_amount, memo, status,
       created_by, required_approvals, quorum_member_ids, policy_decision, created_at, expires_at, decided_at, executed_at, tx_hash, rejection_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULL,NULL,NULL,NULL)`,
    [id, orgId, wallet.id, kind, destination, raw.toString(), memo,
      pending ? 'pending_approval' : 'executed', createdByOf(ctx),
      pending ? quorum.authorization_threshold : 0,
      JSON.stringify(pending ? quorum.member_ids : []),
      JSON.stringify(decision), now,
      pending ? new Date(now.getTime() + quorum.expiry_seconds * 1000) : null]
  );
  const data = { intent_id: id, wallet_id: wallet.id, kind, raw_amount: raw.toString(), status: pending ? 'pending_approval' : 'executed' };
  await auditAppend(client, orgId, 'intent.created', actorOf(ctx), id, now, data, { signed: true });
  const { rows: [row] } = await client.query('SELECT * FROM intents WHERE id = $1', [id]);
  return row;
}

export async function createTransferIntent(ctx, walletId, body) {
  const orgId = ctx.organization_id;
  const result = await withTransaction(async (client) => {
    const wallet = await getWalletLocked(client, orgId, walletId);
    if (!wallet) throw notFound('wallet');
    for (const k of Object.keys(body)) {
      if (!['destination_address', 'amount', 'memo'].includes(k)) throw errors.unknownField(k);
    }
    if (!Object.hasOwn(body, 'amount')) throw errors.validation('amount', 'Enter an amount like 1250 or 0.5');
    const amount = checkAmount(body.amount, wallet.asset, 'amount');
    if (!Object.hasOwn(body, 'destination_address')) {
      throw errors.validation('destination_address', 'Enter a destination address');
    }
    const dest = checkAddress(body.destination_address, 'destination_address');
    if (dest === wallet.address) {
      throw new ApiError(422, 'SELF_TRANSFER', 'You cannot send to this wallet itself', { field: 'destination_address' });
    }
    const sibling = await findSiblingByAddress(client, orgId, dest);
    if (sibling && (sibling.chain !== wallet.chain || sibling.asset !== wallet.asset)) {
      throw new ApiError(422, 'ASSET_MISMATCH', 'The destination wallet holds a different asset', { field: 'destination_address' });
    }
    const memo = checkMemo(body.memo);
    if (wallet.status === 'frozen') throw errors.conflict('WALLET_FROZEN', 'This wallet is frozen. New transfers and approvals are paused.');
    const now = nowSeconds();
    const { decision } = await policyDecisionForRequest(client, orgId, wallet, 'transfer', dest, amount, now,
      [{ destination: dest, amount }]);
    if (decision.action === 'DENY') {
      await auditAppend(client, orgId, 'transfer.denied', actorOf(ctx), wallet.id, now, {
        wallet_id: wallet.id, raw_amount: amount.toString(), rule: decision.rule,
        reason: decision.reason, policy_revision: decision.policy_revision,
      }, { signed: true });
      // The denial's events commit; the refusal is thrown outside the transaction.
      return { denied: new ApiError(403, 'POLICY_DENIED',
        decision.rule ? `Blocked by policy rule ${decision.rule}` : 'Blocked by policy: no rule allowed this transfer',
        { rule: decision.rule, reason: decision.reason, policy_revision: decision.policy_revision }) };
    }
    const reserved = await reservedRaw(client, wallet.id);
    if (amount > numToBigInt(wallet.balance_raw) - reserved) {
      throw errors.conflict('INSUFFICIENT_FUNDS', 'Not enough available balance');
    }
    const quorumId = wallet.quorum_id;
    const pending = Boolean(quorumId) && amount >= numToBigInt(wallet.approval_floor_raw);
    const intent = await insertIntent(client, orgId, ctx, {
      wallet, kind: 'transfer', destination: dest, raw: amount, memo, decision, now, pending,
    });
    if (!pending) {
      await executeIntent(client, ctx, intent, wallet, now);
    }
    const { rows: [fresh] } = await client.query('SELECT * FROM intents WHERE id = $1', [intent.id]);
    return { intent: await intentResponse(client, fresh) };
  });
  if (result.denied) throw result.denied;
  return result.intent;
}

export async function createBatchIntent(ctx, walletId, body) {
  const orgId = ctx.organization_id;
  const result = await withTransaction(async (client) => {
    const wallet = await getWalletLocked(client, orgId, walletId);
    if (!wallet) throw notFound('wallet');
    for (const k of Object.keys(body)) {
      if (k !== 'items') throw errors.unknownField(k);
    }
    const rawItems = body.items;
    if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 100) {
      throw errors.validation('items', 'A batch takes between 1 and 100 lines');
    }
    const lines = [];
    for (let i = 0; i < rawItems.length; i++) {
      const line = rawItems[i];
      const p = `items.${i}`;
      if (!isPlainObject(line)) throw errors.validation(p, 'Enter a valid batch line');
      for (const k of Object.keys(line)) {
        if (!['destination_address', 'amount', 'memo'].includes(k)) throw errors.unknownField(`${p}.${k}`);
      }
      // Line refusals other than unknown keys carry the line index and field.
      try {
        const amount = checkAmount(line.amount, wallet.asset, `${p}.amount`);
        const dest = checkAddress(line.destination_address, `${p}.destination_address`);
        if (dest === wallet.address) {
          throw new ApiError(422, 'SELF_TRANSFER', 'You cannot send to this wallet itself', { field: `${p}.destination_address` });
        }
        const sibling = await findSiblingByAddress(client, orgId, dest);
        if (sibling && (sibling.chain !== wallet.chain || sibling.asset !== wallet.asset)) {
          throw new ApiError(422, 'ASSET_MISMATCH', 'The destination wallet holds a different asset', { field: `${p}.destination_address` });
        }
        const memo = checkMemo(line.memo, `${p}.memo`);
        lines.push({ destination: dest, amount, memo });
      } catch (e) {
        if (e instanceof ApiError && e.status === 422 && e.code !== 'UNKNOWN_FIELD') {
          e.details = { ...e.details, index: i };
        }
        throw e;
      }
    }
    if (wallet.status === 'frozen') throw errors.conflict('WALLET_FROZEN', 'This wallet is frozen. New transfers and approvals are paused.');
    const now = nowSeconds();
    let decision = null;
    for (let i = 0; i < lines.length; i++) {
      const requestLines = lines.slice(0, i + 1).map((l) => ({ destination: l.destination, amount: l.amount }));
      const result = await policyDecisionForRequest(client, orgId, wallet, 'batch_payout',
        lines[i].destination, lines[i].amount, now, requestLines);
      if (result.decision.action === 'DENY') {
        await auditAppend(client, orgId, 'transfer.denied', actorOf(ctx), wallet.id, now, {
          wallet_id: wallet.id, raw_amount: lines[i].amount.toString(), rule: result.decision.rule,
          reason: result.decision.reason, policy_revision: result.decision.policy_revision, index: i,
        }, { signed: true });
        return { denied: new ApiError(403, 'POLICY_DENIED',
          result.decision.rule ? `Line ${i + 1} blocked by policy rule ${result.decision.rule}` : `Line ${i + 1} blocked by policy: no rule allowed it`,
          { index: i, rule: result.decision.rule, reason: result.decision.reason, policy_revision: result.decision.policy_revision }) };
      }
      decision = result.decision;
    }
    const total = lines.reduce((acc, l) => acc + l.amount, 0n);
    const reserved = await reservedRaw(client, wallet.id);
    if (total > numToBigInt(wallet.balance_raw) - reserved) {
      throw errors.conflict('INSUFFICIENT_FUNDS', 'Not enough available balance');
    }
    const pending = Boolean(wallet.quorum_id) && total >= numToBigInt(wallet.approval_floor_raw);
    const intent = await insertIntent(client, orgId, ctx, {
      wallet, kind: 'batch', destination: null, raw: total, memo: '', decision, now, pending,
    });
    for (let i = 0; i < lines.length; i++) {
      await client.query(
        `INSERT INTO intent_items (intent_id, position, destination_address, raw_amount, memo)
         VALUES ($1,$2,$3,$4,$5)`,
        [intent.id, i, lines[i].destination, lines[i].amount.toString(), lines[i].memo]
      );
    }
    if (!pending) {
      await executeIntent(client, ctx, intent, wallet, now);
    }
    const { rows: [fresh] } = await client.query('SELECT * FROM intents WHERE id = $1', [intent.id]);
    return { intent: await intentResponse(client, fresh) };
  });
  if (result.denied) throw result.denied;
  return result.intent;
}

export async function createDeposit(ctx, walletId, body) {
  const orgId = ctx.organization_id;
  return withTransaction(async (client) => {
    const wallet = await getWalletLocked(client, orgId, walletId);
    if (!wallet) throw notFound('wallet');
    for (const k of Object.keys(body)) {
      if (!['amount', 'reference'].includes(k)) throw errors.unknownField(k);
    }
    if (!Object.hasOwn(body, 'amount')) throw errors.validation('amount', 'Enter an amount like 1250 or 0.5');
    if (!Object.hasOwn(body, 'reference')) throw errors.validation('reference', 'Enter a reference');
    const amount = checkAmount(body.amount, wallet.asset, 'amount');
    const reference = textField(body.reference, { field: 'reference', min: 1, max: 64 });
    const now = nowSeconds();
    const id = newId('dep');
    const inserted = await client.query(
      `INSERT INTO deposits (id, wallet_id, raw_amount, reference, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (wallet_id, reference) DO NOTHING`,
      [id, wallet.id, amount.toString(), reference, createdByOf(ctx), now]
    );
    if (inserted.rowCount === 0) throw errors.conflict('DUPLICATE_DEPOSIT', 'This reference was already used for this wallet');
    await client.query('UPDATE wallets SET balance_raw = balance_raw + $1 WHERE id = $2', [amount.toString(), wallet.id]);
    await recordDepositPair(client, orgId, wallet, amount, id, now);
    await auditAppend(client, orgId, 'deposit.received', actorOf(ctx), wallet.id, now,
      { deposit_id: id, wallet_id: wallet.id, raw_amount: amount.toString() }, { signed: true });
    const { rows: [dep] } = await client.query('SELECT * FROM deposits WHERE id = $1', [id]);
    return depositResponse(dep, wallet.asset);
  });
}

// ---- approve, reject, cancel ------------------------------------------------

async function lockIntent(client, orgId, intentId) {
  const { rows } = await client.query(
    'SELECT * FROM intents WHERE id = $1 AND organization_id = $2 FOR UPDATE', [intentId, orgId]);
  return rows[0] || null;
}

async function expireIntent(client, intent) {
  const upd = await client.query(
    `UPDATE intents SET status = 'expired', decided_at = expires_at
     WHERE id = $1 AND status = 'pending_approval' RETURNING *`, [intent.id]);
  if (upd.rowCount === 1) {
    const fresh = upd.rows[0];
    await auditAppend(client, intent.organization_id, 'intent.expired', 'system', intent.id,
      new Date(fresh.expires_at),
      { intent_id: intent.id, wallet_id: intent.wallet_id, kind: intent.kind, raw_amount: String(intent.raw_amount), status: 'expired' },
      { signed: true });
  }
  return upd.rowCount === 1;
}

export async function decideIntent(ctx, intentId, action, body) {
  const orgId = ctx.organization_id;
  return withTransaction(async (client) => {
    const intent = await lockIntent(client, orgId, intentId);
    if (!intent) throw notFound('intent');
    if (ctx.kind === 'api_key') throw errors.forbiddenRole('API keys cannot decide payouts.');
    let reason = null;
    if (action === 'reject') {
      for (const k of Object.keys(body)) {
        if (k !== 'reason') throw errors.unknownField(k);
      }
      reason = textField(body.reason, { field: 'reason', min: 1, max: 280, trim: false });
      if (!/\S/.test(reason)) throw errors.validation('reason', 'Enter a reason to reject');
    } else {
      for (const k of Object.keys(body)) {
        throw errors.unknownField(k);
      }
    }
    const now = nowSeconds();
    if (intent.expires_at && now >= new Date(intent.expires_at)) {
      await expireIntent(client, intent);
      throw errors.conflict('INTENT_NOT_PENDING', 'This intent is no longer waiting for approval.');
    }
    if (intent.status !== 'pending_approval') {
      throw errors.conflict('INTENT_NOT_PENDING', 'This intent is no longer waiting for approval.');
    }
    const members = intent.quorum_member_ids || [];
    if (!members.includes(ctx.member.id)) {
      throw new ApiError(403, 'NOT_IN_QUORUM', 'You are not in this intent\'s approval quorum.');
    }
    if (intent.created_by === ctx.member.id) {
      throw new ApiError(403, 'SELF_APPROVAL', 'You cannot approve a request you started.');
    }
    const existing = await client.query(
      'SELECT member_id FROM approvals WHERE intent_id = $1 AND member_id = $2', [intent.id, ctx.member.id]);
    if (existing.rowCount > 0) throw errors.conflict('ALREADY_DECIDED', 'You already decided this intent.');
    const wallet = await lockWallet(client, intent.wallet_id);
    if (action === 'reject') {
      await client.query(
        `INSERT INTO approvals (intent_id, member_id, decision, reason, created_at)
         VALUES ($1,$2,'reject',$3,$4)`, [intent.id, ctx.member.id, reason, now]);
      await client.query(
        `UPDATE intents SET status = 'rejected', decided_at = $1, rejection_reason = $2 WHERE id = $3`,
        [now, reason, intent.id]);
      await auditAppend(client, orgId, 'intent.rejected', actorOf(ctx), intent.id, now,
        { intent_id: intent.id, wallet_id: intent.wallet_id, kind: intent.kind, raw_amount: String(intent.raw_amount), status: 'rejected' },
        { signed: true });
    } else {
      if (wallet.status === 'frozen') {
        throw errors.conflict('WALLET_FROZEN', 'This wallet is frozen. New transfers and approvals are paused.');
      }
      await client.query(
        `INSERT INTO approvals (intent_id, member_id, decision, reason, created_at)
         VALUES ($1,$2,'approve',NULL,$3)`, [intent.id, ctx.member.id, now]);
      await auditAppend(client, orgId, 'intent.approved', actorOf(ctx), intent.id, now,
        { intent_id: intent.id, wallet_id: intent.wallet_id, kind: intent.kind, raw_amount: String(intent.raw_amount), status: 'pending_approval' },
        { signed: true });
      const { rows: [{ n }] } = await client.query(
        'SELECT count(*)::int AS n FROM approvals WHERE intent_id = $1', [intent.id]);
      if (n >= intent.required_approvals) {
        await executeIntent(client, ctx, intent, wallet, now);
      }
    }
    const { rows: [fresh] } = await client.query('SELECT * FROM intents WHERE id = $1', [intent.id]);
    return intentResponse(client, fresh);
  });
}

export async function cancelIntent(ctx, intentId, body) {
  const orgId = ctx.organization_id;
  return withTransaction(async (client) => {
    const intent = await lockIntent(client, orgId, intentId);
    if (!intent) throw notFound('intent');
    for (const k of Object.keys(body)) throw errors.unknownField(k);
    const isOwner = ctx.kind === 'member' && ctx.member.role === 'owner';
    if (!isOwner && createdByOf(ctx) !== intent.created_by) {
      throw errors.forbiddenRole('Only the creator or an owner can cancel this request.');
    }
    const now = nowSeconds();
    if (intent.expires_at && now >= new Date(intent.expires_at)) {
      await expireIntent(client, intent);
    }
    if (intent.status !== 'pending_approval') {
      throw errors.conflict('INTENT_NOT_PENDING', 'This intent is no longer waiting for approval.');
    }
    await client.query(
      `UPDATE intents SET status = 'cancelled', decided_at = $1 WHERE id = $2`, [now, intent.id]);
    await auditAppend(client, orgId, 'intent.cancelled', actorOf(ctx), intent.id, now,
      { intent_id: intent.id, wallet_id: intent.wallet_id, kind: intent.kind, raw_amount: String(intent.raw_amount), status: 'cancelled' },
      { signed: true });
    const { rows: [fresh] } = await client.query('SELECT * FROM intents WHERE id = $1', [intent.id]);
    return intentResponse(client, fresh);
  });
}

// ---- listing, cursor, inbox, export -----------------------------------------

function signCursorPayload(secret, payload) {
  return createHmac('sha256', secret).update(JSON.stringify(payload)).digest('base64url');
}

function encodeCursor(payload, secret) {
  const json = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${json}.${signCursorPayload(secret, payload)}`;
}

function decodeCursor(cursor, secret, orgId, status, walletId) {
  const invalid = () => new ApiError(422, 'INVALID_CURSOR', 'This cursor is not valid', { field: 'cursor' });
  const dot = cursor.lastIndexOf('.');
  if (dot < 0) throw invalid();
  let payload;
  try {
    payload = JSON.parse(Buffer.from(cursor.slice(0, dot), 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (signCursorPayload(secret, payload) !== cursor.slice(dot + 1)
    || payload.o !== orgId
    || (payload.s || null) !== (status || null)
    || (payload.w || null) !== (walletId || null)) {
    throw invalid();
  }
  return payload;
}

function parseListParams(query) {
  const status = query.get('status') || null;
  if (status !== null && !INTENT_STATUSES.includes(status)) {
    throw errors.validation('status', 'Choose a valid status');
  }
  const walletId = query.get('wallet_id') || null;
  const limitRaw = query.get('limit');
  let limit = 20;
  if (limitRaw !== null && limitRaw !== undefined && limitRaw !== '') {
    if (!/^\d+$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > 100) {
      throw errors.validation('limit', 'Choose a limit between 1 and 100');
    }
    limit = Number(limitRaw);
  }
  return { status, walletId, limit };
}

async function listIntents(ctx, query, cursorParam) {
  const orgId = ctx.organization_id;
  const { status, walletId, limit } = parseListParams(query);
  return withTransaction(async (client) => {
    await applyExpiry(client, new Date(), orgId);
    const { rows: [org] } = await client.query('SELECT webhook_secret FROM organizations WHERE id = $1', [orgId]);
    let params = [orgId];
    let where = 'i.organization_id = $1';
    if (status) { params.push(status); where += ` AND i.status = $${params.length}`; }
    if (walletId) { params.push(walletId); where += ` AND i.wallet_id = $${params.length}`; }
    if (cursorParam) {
      const payload = decodeCursor(cursorParam, org.webhook_secret, orgId, status, walletId);
      params.push(new Date(payload.ca), payload.id);
      where += ` AND (i.created_at, i.id) < ($${params.length - 1}, $${params.length})`;
    }
    const { rows } = await client.query(
      `SELECT i.* FROM intents i WHERE ${where} ORDER BY i.created_at DESC, i.id DESC LIMIT ${limit + 1}`, params);
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    let nextCursor = null;
    if (hasMore && page.length) {
      const last = page[page.length - 1];
      nextCursor = encodeCursor({
        o: orgId, s: status, w: walletId, ca: new Date(last.created_at).toISOString(), id: last.id,
      }, org.webhook_secret);
    }
    const items = [];
    for (const row of page) items.push(await intentResponse(client, row));
    return { items, next_cursor: nextCursor };
  });
}

function csvCell(value) {
  let v = value === null || value === undefined ? '' : String(value);
  const first = v.charAt(0);
  if (['=', '+', '-', '@', '\t', '\r'].includes(first)) v = `'${v}`;
  if (/[",\r\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

async function exportIntents(ctx, query) {
  const orgId = ctx.organization_id;
  const status = query.get('status') || null;
  if (status !== null && !INTENT_STATUSES.includes(status)) {
    throw errors.validation('status', 'Choose a valid status');
  }
  const walletId = query.get('wallet_id') || null;
  return withTransaction(async (client) => {
    await applyExpiry(client, new Date(), orgId);
    const params = [orgId];
    let where = 'i.organization_id = $1';
    if (status) { params.push(status); where += ` AND i.status = $${params.length}`; }
    if (walletId) { params.push(walletId); where += ` AND i.wallet_id = $${params.length}`; }
    const { rows } = await client.query(
      `SELECT i.*, w.name AS wallet_name, w.asset AS wallet_asset
       FROM intents i JOIN wallets w ON w.id = i.wallet_id
       WHERE ${where} ORDER BY i.created_at DESC, i.id DESC`, params);
    const header = ['id', 'wallet_id', 'wallet_name', 'kind', 'destination_address', 'amount', 'asset',
      'status', 'created_by', 'created_at', 'executed_at', 'tx_hash', 'memo'];
    const lines = [header.join(',')];
    for (const r of rows) {
      const display = rawToDisplay(numToBigInt(r.raw_amount), r.wallet_asset);
      const cells = [r.id, r.wallet_id, r.wallet_name, r.kind, r.destination_address, display, r.wallet_asset,
        r.status, r.created_by, formatTs(r.created_at), r.executed_at ? formatTs(r.executed_at) : '',
        r.tx_hash, r.memo];
      lines.push(cells.map(csvCell).join(','));
    }
    return lines.join('\r\n') + '\r\n';
  });
}

async function approvalsInbox(ctx) {
  const orgId = ctx.organization_id;
  const memberId = ctx.member.id;
  return withTransaction(async (client) => {
    await applyExpiry(client, new Date(), orgId);
    const { rows } = await client.query(
      `SELECT i.* FROM intents i
       WHERE i.organization_id = $1 AND i.status = 'pending_approval'
         AND i.quorum_member_ids ? $2
         AND i.created_by <> $2
         AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.intent_id = i.id AND a.member_id = $2)
       ORDER BY i.created_at DESC, i.id DESC`,
      [orgId, memberId]);
    const items = [];
    for (const row of rows) items.push(await intentResponse(client, row));
    return { items };
  });
}

export const moneyRoutes = [
  { method: 'GET', pattern: /^\/api\/v1\/wallets$/, auth: 'readers',
    async handler(ctx, { send }) {
      const wallets = await withClient((client) => client.query(
        'SELECT * FROM wallets WHERE organization_id = $1 ORDER BY name COLLATE "C"', [ctx.organization_id]));
      send(200, { wallets: await withClient((client) => walletsResponse(client, wallets.rows)) });
    } },
  { method: 'GET', pattern: /^\/api\/v1\/wallets\/([a-z0-9_]+)$/, auth: 'readers',
    async handler(ctx, { params, send }) {
      const data = await withClient(async (client) => {
        const wallet = await getWallet(client, ctx.organization_id, params[0]);
        if (!wallet) throw notFound('wallet');
        return walletResponse(client, wallet);
      });
      send(200, data);
    } },
  { method: 'POST', pattern: /^\/api\/v1\/wallets$/, auth: ['owner'], bodyKeys: ['name', 'chain', 'asset', 'policy_id', 'quorum_id', 'approval_floor'],
    async handler(ctx, { body, send }) {
      const data = await withTransaction(async (client) => {
        const orgId = ctx.organization_id;
        for (const k of Object.keys(body)) {
          if (!['name', 'chain', 'asset', 'policy_id', 'quorum_id', 'approval_floor'].includes(k)) {
            throw errors.unknownField(k);
          }
        }
        const name = textField(body.name, { field: 'name', min: 1, max: 60 });
        if (body.chain !== 'ethereum' && body.chain !== 'base') {
          throw errors.validation('chain', 'Choose ethereum or base');
        }
        if (body.asset !== 'usdc' && body.asset !== 'eth') {
          throw errors.validation('asset', 'Choose usdc or eth');
        }
        let policyId = null;
        if (body.policy_id !== undefined && body.policy_id !== null) {
          if (typeof body.policy_id !== 'string') throw errors.validation('policy_id', 'Choose a policy');
          const { rows } = await client.query('SELECT id FROM policies WHERE id = $1 AND organization_id = $2', [body.policy_id, orgId]);
          if (!rows.length) throw notFound('policy');
          policyId = body.policy_id;
        }
        let quorumId = null;
        if (body.quorum_id !== undefined && body.quorum_id !== null) {
          if (typeof body.quorum_id !== 'string') throw errors.validation('quorum_id', 'Choose a quorum');
          const { rows } = await client.query('SELECT id FROM key_quorums WHERE id = $1 AND organization_id = $2', [body.quorum_id, orgId]);
          if (!rows.length) throw notFound('quorum');
          quorumId = body.quorum_id;
        }
        let floor = 0n;
        if (body.approval_floor !== undefined && body.approval_floor !== null) {
          floor = checkAmount(body.approval_floor, body.asset, 'approval_floor', { allowZero: true });
        }
        const { rows: all } = await client.query(
          'SELECT id, name FROM wallets WHERE organization_id = $1', [orgId]);
        for (const w of all) {
          if (caseFold(w.name) === caseFold(name)) throw errors.conflict('WALLET_NAME_TAKEN', 'A wallet with this name already exists');
        }
        const id = newId('wal');
        const now = nowSeconds();
        await client.query(
          `INSERT INTO wallets (id, organization_id, name, chain, asset, address, balance_raw, policy_id, quorum_id, approval_floor_raw, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,$9,'active',$10)`,
          [id, orgId, name, body.chain, body.asset, walletAddress(id), policyId, quorumId, floor.toString(), now]);
        const movement = newId('evt');
        await client.query(
          `INSERT INTO ledger_entries (id, organization_id, movement_id, kind, account, asset, raw_amount, intent_id, deposit_id, created_at)
           VALUES ($1,$2,$3,'opening','external',$4,0,NULL,NULL,$5)`,
          [newId('evt'), orgId, movement, body.asset, now]);
        await client.query(
          `INSERT INTO ledger_entries (id, organization_id, movement_id, kind, account, asset, raw_amount, intent_id, deposit_id, created_at)
           VALUES ($1,$2,$3,'opening',$4,$5,0,NULL,NULL,$6)`,
          [newId('evt'), orgId, movement, id, body.asset, now]);
        await auditAppend(client, orgId, 'wallet.created', actorOf(ctx), id, now,
          { wallet_id: id, name, chain: body.chain, asset: body.asset, balance_raw: '0' }, { signed: false });
        const { rows: [wallet] } = await client.query('SELECT * FROM wallets WHERE id = $1', [id]);
        return walletResponse(client, wallet);
      });
      send(201, data);
    } },
  { method: 'PATCH', pattern: /^\/api\/v1\/wallets\/([a-z0-9_]+)$/, auth: ['owner'], bodyKeys: ['name', 'policy_id', 'quorum_id', 'approval_floor'],
    async handler(ctx, { params, body, send }) {
      const data = await withTransaction(async (client) => {
        const orgId = ctx.organization_id;
        const wallet = await getWalletLocked(client, orgId, params[0]);
        if (!wallet) throw notFound('wallet');
        for (const k of Object.keys(body)) {
          if (!['name', 'policy_id', 'quorum_id', 'approval_floor'].includes(k)) throw errors.unknownField(k);
        }
        const updates = {};
        if (Object.hasOwn(body, 'name')) {
          const name = textField(body.name, { field: 'name', min: 1, max: 60 });
          const { rows: all } = await client.query('SELECT id, name FROM wallets WHERE organization_id = $1', [orgId]);
          for (const w of all) {
            if (w.id !== wallet.id && caseFold(w.name) === caseFold(name)) {
              throw errors.conflict('WALLET_NAME_TAKEN', 'A wallet with this name already exists');
            }
          }
          updates.name = name;
        }
        if (Object.hasOwn(body, 'policy_id')) {
          if (body.policy_id === null) updates.policy_id = null;
          else {
            if (typeof body.policy_id !== 'string') throw errors.validation('policy_id', 'Choose a policy');
            const { rows } = await client.query('SELECT id FROM policies WHERE id = $1 AND organization_id = $2', [body.policy_id, orgId]);
            if (!rows.length) throw notFound('policy');
            updates.policy_id = body.policy_id;
          }
        }
        if (Object.hasOwn(body, 'quorum_id')) {
          if (body.quorum_id === null) updates.quorum_id = null;
          else {
            if (typeof body.quorum_id !== 'string') throw errors.validation('quorum_id', 'Choose a quorum');
            const { rows } = await client.query('SELECT id FROM key_quorums WHERE id = $1 AND organization_id = $2', [body.quorum_id, orgId]);
            if (!rows.length) throw notFound('quorum');
            updates.quorum_id = body.quorum_id;
          }
        }
        if (Object.hasOwn(body, 'approval_floor')) {
          if (body.approval_floor === null) throw errors.validation('approval_floor', 'Enter an approval floor');
          updates.approval_floor = checkAmount(body.approval_floor, wallet.asset, 'approval_floor', { allowZero: true }).toString();
        }
        for (const [k, v] of Object.entries(updates)) {
          await client.query(`UPDATE wallets SET ${k} = $1 WHERE id = $2`, [v, wallet.id]);
        }
        const now = nowSeconds();
        await auditAppend(client, orgId, 'wallet.updated', actorOf(ctx), wallet.id, now,
          { wallet_id: wallet.id, changes: Object.keys(updates) }, { signed: false });
        const { rows: [fresh] } = await client.query('SELECT * FROM wallets WHERE id = $1', [wallet.id]);
        return walletResponse(client, fresh);
      });
      send(200, data);
    } },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/([a-z0-9_]+)\/freeze$/, auth: ['owner'], bodyKeys: [],
    async handler(ctx, { params, body, send }) {
      const data = await withTransaction(async (client) => {
        const wallet = await getWalletLocked(client, ctx.organization_id, params[0]);
        if (!wallet) throw notFound('wallet');
        for (const k of Object.keys(body)) throw errors.unknownField(k);
        if (wallet.status === 'frozen') throw errors.conflict('WALLET_FROZEN', 'This wallet is already frozen.');
        await client.query(`UPDATE wallets SET status = 'frozen' WHERE id = $1`, [wallet.id]);
        await auditAppend(client, ctx.organization_id, 'wallet.frozen', actorOf(ctx), wallet.id, nowSeconds(),
          { wallet_id: wallet.id, status: 'frozen' }, { signed: false });
        const { rows: [fresh] } = await client.query('SELECT * FROM wallets WHERE id = $1', [wallet.id]);
        return walletResponse(client, fresh);
      });
      send(200, data);
    } },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/([a-z0-9_]+)\/unfreeze$/, auth: ['owner'], bodyKeys: [],
    async handler(ctx, { params, body, send }) {
      const data = await withTransaction(async (client) => {
        const wallet = await getWalletLocked(client, ctx.organization_id, params[0]);
        if (!wallet) throw notFound('wallet');
        for (const k of Object.keys(body)) throw errors.unknownField(k);
        if (wallet.status !== 'frozen') throw errors.conflict('WALLET_NOT_FROZEN', 'This wallet is not frozen.');
        await client.query(`UPDATE wallets SET status = 'active' WHERE id = $1`, [wallet.id]);
        await auditAppend(client, ctx.organization_id, 'wallet.unfrozen', actorOf(ctx), wallet.id, nowSeconds(),
          { wallet_id: wallet.id, status: 'active' }, { signed: false });
        const { rows: [fresh] } = await client.query('SELECT * FROM wallets WHERE id = $1', [wallet.id]);
        return walletResponse(client, fresh);
      });
      send(200, data);
    } },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/([a-z0-9_]+)\/transfers$/, auth: ['owner', 'operator'],
    idempotent: true,
    async handler(ctx, { params, body, rawBody, req, send, sendErr }) {
      const out = await runWithIdempotency(ctx, ctx.idempotencyKey, 'POST', req.pathname, rawBody, () =>
        createTransferIntent(ctx, params[0], body));
      sendIdempotent(out, send, sendErr);
    } },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/([a-z0-9_]+)\/batches$/, auth: ['owner', 'operator'],
    idempotent: true,
    async handler(ctx, { params, body, rawBody, req, send, sendErr }) {
      const out = await runWithIdempotency(ctx, ctx.idempotencyKey, 'POST', req.pathname, rawBody, () =>
        createBatchIntent(ctx, params[0], body));
      sendIdempotent(out, send, sendErr);
    } },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/([a-z0-9_]+)\/deposits$/, auth: ['owner', 'operator'],
    idempotent: true,
    async handler(ctx, { params, body, rawBody, req, send, sendErr }) {
      const out = await runWithIdempotency(ctx, ctx.idempotencyKey, 'POST', req.pathname, rawBody, () =>
        createDeposit(ctx, params[0], body));
      sendIdempotent(out, send, sendErr);
    } },
  { method: 'GET', pattern: /^\/api\/v1\/intents$/, auth: 'readers',
    async handler(ctx, { query, send }) {
      const cursor = query.get('cursor');
      send(200, await listIntents(ctx, query, cursor));
    } },
  { method: 'GET', pattern: /^\/api\/v1\/intents\/export$/, auth: 'readers', raw: 'csv',
    async handler(ctx, { query, sendRaw }) {
      const csv = await exportIntents(ctx, query);
      sendRaw(200, csv, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="corvo-intents.csv"',
      });
    } },
  { method: 'GET', pattern: /^\/api\/v1\/intents\/([a-z0-9_]+)$/, auth: 'readers',
    async handler(ctx, { params, send }) {
      const data = await withTransaction(async (client) => {
        await applyExpiry(client, new Date(), ctx.organization_id);
        const { rows } = await client.query(
          'SELECT * FROM intents WHERE id = $1 AND organization_id = $2', [params[0], ctx.organization_id]);
        if (!rows.length) throw notFound('intent');
        return intentResponse(client, rows[0]);
      });
      send(200, data);
    } },
  { method: 'POST', pattern: /^\/api\/v1\/intents\/([a-z0-9_]+)\/approve$/, auth: 'any', bodyKeys: [],
    async handler(ctx, { params, body, send }) {
      send(200, await decideIntent(ctx, params[0], 'approve', body));
    } },
  { method: 'POST', pattern: /^\/api\/v1\/intents\/([a-z0-9_]+)\/reject$/, auth: 'any', bodyKeys: ['reason'],
    async handler(ctx, { params, body, send }) {
      send(200, await decideIntent(ctx, params[0], 'reject', body));
    } },
  { method: 'POST', pattern: /^\/api\/v1\/intents\/([a-z0-9_]+)\/cancel$/, auth: ['owner', 'operator'], bodyKeys: [],
    async handler(ctx, { params, body, send }) {
      send(200, await cancelIntent(ctx, params[0], body));
    } },
  { method: 'GET', pattern: /^\/api\/v1\/approvals\/inbox$/, auth: 'members',
    async handler(ctx, { send }) {
      send(200, await approvalsInbox(ctx));
    } },
];

export function sendIdempotent(out, send, sendErr) {
  const headers = { 'Idempotent-Replayed': String(out.replayed) };
  if (out.body && out.body.error) {
    sendErr(out.status, out.body.error, headers);
  } else {
    send(out.status, out.body.data, headers);
  }
}
