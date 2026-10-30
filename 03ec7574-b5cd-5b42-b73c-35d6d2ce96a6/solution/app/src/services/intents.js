import crypto from 'node:crypto';
import { ApiError, formatAmount, iso, newId, nowSeconds, parseAmount, sha256Hex, toDate, toSeconds, txHash } from '../lib/core.js';
import { address, fail, noFields, objectBody, present, text, unknown } from '../lib/validate.js';
import { config } from '../config.js';
import { pool, query, tx } from '../db.js';
import { actorOf, lockOrg, record } from './audit.js';
import { aggregationValues, decide } from './policy.js';
import { INTENT_SELECT, depositView, findWallet, intentViews } from './views.js';

export const creatorOf = (caller) => (caller.apiKey ? caller.apiKey.id : caller.member.id);

const notPending = () => new ApiError(409, 'INTENT_NOT_PENDING', 'This intent is no longer waiting for approval.');
const frozen = () => new ApiError(409, 'WALLET_FROZEN', 'This wallet is frozen. New transfers and approvals are paused.');
const insufficient = () => new ApiError(409, 'INSUFFICIENT_FUNDS', 'Not enough available balance');

function intentEventData(intent) {
  return { intent_id: intent.id, wallet_id: intent.wallet_id, kind: intent.kind,
    raw_amount: BigInt(intent.raw_amount).toString(), status: intent.status };
}

async function intentEvent(client, actor, intent, type, at) {
  await record(client, intent.organization_id, { type, actor, subjectId: intent.id, data: intentEventData(intent), at });
}

// ---------------------------------------------------------------- expiry
// A pending intent is expired from the server second equal to its expires_at. Expiry releases the
// reservation and writes exactly one intent.expired event dated at expires_at, however many requests race.
async function expireWithin(client, orgId, nowSec, intentId = null) {
  const { rows } = await client.query(
    `UPDATE intents SET status = 'expired', decided_at = expires_at
      WHERE organization_id = $1 AND status = $4 AND expires_at <= to_timestamp($2)
        AND ($3::text IS NULL OR id = $3)
      RETURNING *`, [orgId, nowSec, intentId, 'pending_approval']);
  rows.sort((a, b) => toSeconds(a.expires_at) - toSeconds(b.expires_at) || (a.id < b.id ? -1 : 1));
  for (const row of rows) await intentEvent(client, 'system', row, 'intent.expired', toSeconds(row.expires_at));
  return rows.length;
}

export async function expireDue(orgId) {
  const nowSec = nowSeconds();
  const due = await query(
    `SELECT id FROM intents WHERE organization_id = $1 AND status = $3
        AND expires_at <= to_timestamp($2) LIMIT 1`, [orgId, nowSec, 'pending_approval']);
  if (!due.rows.length) return;
  await tx(async (client) => {
    await lockOrg(client, orgId);
    await expireWithin(client, orgId, nowSec);
  });
}

// The sweep: every organization with a pending intent past its expiry.
export async function sweepExpired() {
  const { rows } = await query(
    `SELECT DISTINCT organization_id FROM intents WHERE status = 'pending_approval' AND expires_at <= to_timestamp($1)`,
    [nowSeconds()]);
  for (const row of rows) await expireDue(row.organization_id);
}

// ---------------------------------------------------------------- idempotency
const IDEMPOTENT_KEY = /^[\x20-\x7e]{1,128}$/;

export function idempotency(req) {
  const key = req.get('Idempotency-Key');
  if (key === undefined) return null;
  if (!IDEMPOTENT_KEY.test(key)) {
    fail('Idempotency-Key', 'Idempotency-Key is 1 to 128 printable ASCII characters.');
  }
  return { key, method: req.method, path: `${req.baseUrl}${req.path}`, bodySha: sha256Hex(req.rawBody || '') };
}

// Claims the key for this request, or answers from the record: in flight, replay or reuse.
async function claim(orgId, idem) {
  return tx(async (client) => {
    const nowSec = nowSeconds();
    const values = [orgId, idem.key, idem.method, idem.path, idem.bodySha, nowSec];
    const inserted = await client.query(
      `INSERT INTO idempotency_records (organization_id, key, method, path, body_sha256, created_at)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6)) ON CONFLICT DO NOTHING RETURNING key`, values);
    if (inserted.rows.length) return null;
    const { rows } = await client.query(
      'SELECT * FROM idempotency_records WHERE organization_id = $1 AND key = $2 FOR UPDATE', [orgId, idem.key]);
    const row = rows[0];
    if (nowSec - toSeconds(row.created_at) > config.idempotencyRetentionSeconds) {
      await client.query(
        `UPDATE idempotency_records SET method = $3, path = $4, body_sha256 = $5, status_code = NULL, response = NULL,
                created_at = to_timestamp($6) WHERE organization_id = $1 AND key = $2`, values);
      return null;
    }
    if (row.status_code === null) {
      throw new ApiError(409, 'IDEMPOTENCY_KEY_IN_PROGRESS', 'A request with this Idempotency-Key is still running.');
    }
    if (row.method !== idem.method || row.path !== idem.path || row.body_sha256 !== idem.bodySha) {
      throw new ApiError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request.');
    }
    return { status: row.status_code, body: row.response, replayed: true };
  });
}

const release = (orgId, idem) => query('DELETE FROM idempotency_records WHERE organization_id = $1 AND key = $2',
  [orgId, idem.key]).catch(() => {});

// A write answers {status, body} where body is the serialised {success, data, error}. Successes and
// policy denials are kept for the key; any other refusal releases it.
async function keyed(caller, idem, work) {
  const orgId = caller.org.id;
  const prior = idem ? await claim(orgId, idem) : null;
  if (prior) return prior;
  try {
    return await tx(async (client) => {
      await lockOrg(client, orgId);
      const result = await work(client, nowSeconds());
      const body = JSON.stringify(result.error
        ? { success: false, data: null, error: result.error } : { success: true, data: result.data, error: null });
      if (idem) {
        await client.query(
          'UPDATE idempotency_records SET status_code = $3, response = $4 WHERE organization_id = $1 AND key = $2',
          [orgId, idem.key, result.status, body]);
      }
      return { status: result.status, body };
    });
  } catch (err) {
    if (idem) await release(orgId, idem);
    throw err;
  }
}

// ---------------------------------------------------------------- shared steps
async function lockWallet(client, orgId, walletId) {
  await client.query('SELECT id FROM wallets WHERE id = $1 AND organization_id = $2 FOR UPDATE', [walletId, orgId]);
  return findWallet(client, orgId, walletId);
}

const available = (wallet) => BigInt(wallet.balance_raw) - BigInt(wallet.reserved_raw);

// The transfer body in its pinned order: amount, destination_address (address, checksum, self transfer,
// crossed asset), memo. prefix and index place a batch line's refusals.
async function readLine(client, wallet, body, prefix = '', index = undefined) {
  const field = (name) => (prefix ? `${prefix}.${name}` : name);
  const extra = index === undefined ? {} : { index };
  if (!present(body, 'amount')) fail(field('amount'), 'amount is required.', extra);
  let rawAmount;
  try {
    rawAmount = parseAmount(body.amount, wallet.asset, field('amount'));
  } catch (err) {
    err.details = { ...extra, ...err.details };
    throw err;
  }
  const destination = address(body, 'destination_address', { field: field('destination_address'), extra });
  if (destination === wallet.address) {
    throw new ApiError(422, 'SELF_TRANSFER', 'A wallet cannot pay its own address.',
      { ...extra, field: field('destination_address') });
  }
  const { rows } = await client.query('SELECT chain, asset FROM wallets WHERE organization_id = $1 AND address = $2',
    [wallet.organization_id, destination]);
  if (rows.length && (rows[0].chain !== wallet.chain || rows[0].asset !== wallet.asset)) {
    throw new ApiError(422, 'ASSET_MISMATCH', 'The destination wallet holds a different chain or asset.',
      { ...extra, field: field('destination_address') });
  }
  const memo = text(body, 'memo', { min: 0, max: 140, optional: true, field: field('memo'), label: 'memo', extra }) ?? '';
  return { destination, rawAmount, memo };
}

async function policyOf(client, wallet) {
  if (!wallet.policy_id) return null;
  const { rows } = await client.query('SELECT * FROM policies WHERE id = $1', [wallet.policy_id]);
  return rows[0];
}

// A denial reserves nothing: one transfer.denied event naming the rule and revision, and a kept refusal.
async function denial(client, caller, wallet, rawAmount, decision, nowSec, index) {
  const data = { wallet_id: wallet.id, raw_amount: rawAmount.toString(), rule: decision.rule, reason: decision.reason,
    policy_revision: decision.policy_revision };
  const where = index === undefined ? {} : { index };
  await record(client, wallet.organization_id, { type: 'transfer.denied', actor: actorOf(caller), subjectId: wallet.id,
    data: { ...data, ...where }, at: nowSec });
  const message = decision.rule ? `Blocked by policy rule ${decision.rule}` : 'Blocked by policy: no rule allowed this transfer';
  return { status: 403, error: { code: 'POLICY_DENIED', message,
    details: { ...where, rule: decision.rule, reason: decision.reason, policy_revision: decision.policy_revision } } };
}

// Moves the money of an intent: one balancing pair of ledger entries per line, internal lines credited.
async function execute(client, actor, intent, nowSec) {
  const transfer = intent.kind === 'transfer';
  const lines = transfer
    ? [{ destination_address: intent.destination_address, raw_amount: intent.raw_amount }]
    : (await client.query('SELECT * FROM intent_items WHERE intent_id = $1 ORDER BY position', [intent.id])).rows;
  const { rows: [source] } = await client.query('SELECT * FROM wallets WHERE id = $1', [intent.wallet_id]);
  for (const line of lines) {
    const credited = await client.query(
      'UPDATE wallets SET balance_raw = balance_raw + $3 WHERE organization_id = $1 AND address = $2 RETURNING id',
      [intent.organization_id, line.destination_address, line.raw_amount]);
    await ledgerPair(client, { orgId: intent.organization_id, kind: transfer ? 'transfer' : 'batch_line', asset: source.asset,
      from: source.id, to: credited.rows[0]?.id || 'external', rawAmount: line.raw_amount, intentId: intent.id, at: nowSec });
  }
  await client.query('UPDATE wallets SET balance_raw = balance_raw - $2 WHERE id = $1', [source.id, intent.raw_amount]);
  const { rows } = await client.query(
    `UPDATE intents SET status = 'executed', executed_at = to_timestamp($2), decided_at = to_timestamp($2), tx_hash = $3
      WHERE id = $1 RETURNING *`, [intent.id, nowSec, txHash(intent.id)]);
  await intentEvent(client, actor, rows[0], 'intent.executed', nowSec);
  return rows[0];
}

// Every money movement is two entries sharing a movement id that sum to zero.
export async function ledgerPair(client, { orgId, kind, asset, from, to, rawAmount, intentId = null, depositId = null, at }) {
  const movement = crypto.randomUUID();
  const amount = BigInt(rawAmount);
  for (const [account, signed] of [[from, -amount], [to, amount]]) {
    await client.query(
      `INSERT INTO ledger_entries (organization_id, movement_id, kind, account, asset, raw_amount, intent_id, deposit_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9))`,
      [orgId, movement, kind, account, asset, signed.toString(), intentId, depositId, at]);
  }
}

// A transfer or batch waits as pending_approval when the wallet has a quorum and the amount reaches the
// floor; it then copies the quorum, the expiry and the policy decision. Otherwise it executes at once.
async function createIntent(client, caller, wallet, { kind, destination, rawAmount, memo, decision, lines }, nowSec) {
  let quorum = null;
  if (wallet.quorum_id && rawAmount >= BigInt(wallet.approval_floor_raw)) {
    quorum = (await client.query('SELECT * FROM key_quorums WHERE id = $1', [wallet.quorum_id])).rows[0];
  }
  const id = newId('int');
  const { rows } = await client.query(
    `INSERT INTO intents (id, organization_id, wallet_id, kind, destination_address, raw_amount, memo, status, created_by,
                          required_approvals, quorum_member_ids, policy_decision, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, to_timestamp($13), $14) RETURNING *`,
    [id, wallet.organization_id, wallet.id, kind, destination, rawAmount.toString(), memo,
      quorum ? 'pending_approval' : 'executed', creatorOf(caller), quorum ? quorum.authorization_threshold : 0,
      JSON.stringify(quorum ? quorum.member_ids : []), JSON.stringify(decision), nowSec,
      quorum ? toDate(nowSec + quorum.expiry_seconds) : null]);
  for (const [position, line] of (lines || []).entries()) {
    await client.query(
      'INSERT INTO intent_items (intent_id, position, destination_address, raw_amount, memo) VALUES ($1, $2, $3, $4, $5)',
      [id, position, line.destination, line.rawAmount.toString(), line.memo]);
  }
  const actor = actorOf(caller);
  await intentEvent(client, actor, rows[0], 'intent.created', nowSec);
  return quorum ? rows[0] : execute(client, actor, rows[0], nowSec);
}

async function viewOne(client, id) {
  const { rows } = await client.query(`${INTENT_SELECT} WHERE i.id = $1`, [id]);
  return (await intentViews(client, rows))[0];
}

// ---------------------------------------------------------------- transfers, batches, deposits
export async function transfer(caller, walletId, rawBody, idem) {
  await expireDue(caller.org.id);
  return keyed(caller, idem, async (client, nowSec) => {
    const wallet = await lockWallet(client, caller.org.id, walletId);
    const body = objectBody(rawBody);
    unknown(body, { destination_address: true, amount: true, memo: true });
    const { destination, rawAmount, memo } = await readLine(client, wallet, body);
    if (wallet.status === 'frozen') throw frozen();
    const policy = await policyOf(client, wallet);
    const [values] = await aggregationValues(client, policy, wallet, [{ destination, rawAmount }], nowSec);
    const { decision } = decide(policy, { method: 'transfer', asset: wallet.asset, chain: wallet.chain, destination,
      rawAmount, nowSec }, values);
    if (decision.action === 'DENY') return denial(client, caller, wallet, rawAmount, decision, nowSec);
    if (rawAmount > available(wallet)) throw insufficient();
    const intent = await createIntent(client, caller, wallet, { kind: 'transfer', destination, rawAmount, memo, decision }, nowSec);
    return { status: 201, data: await viewOne(client, intent.id) };
  });
}

export async function batch(caller, walletId, rawBody, idem) {
  await expireDue(caller.org.id);
  return keyed(caller, idem, async (client, nowSec) => {
    const wallet = await lockWallet(client, caller.org.id, walletId);
    const body = objectBody(rawBody);
    unknown(body, { items: [{ destination_address: true, amount: true, memo: true }] });
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) {
      fail('items', 'A batch has 1 to 100 lines.');
    }
    const lines = [];
    for (const [index, item] of body.items.entries()) {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) fail(`items.${index}`, 'A batch line is an object.', { index });
      lines.push(await readLine(client, wallet, item, `items.${index}`, index));
    }
    if (wallet.status === 'frozen') throw frozen();
    const policy = await policyOf(client, wallet);
    const values = await aggregationValues(client, policy, wallet, lines, nowSec);
    let accepted = null;
    for (const [index, line] of lines.entries()) {
      const { decision } = decide(policy, { method: 'batch_payout', asset: wallet.asset, chain: wallet.chain,
        destination: line.destination, rawAmount: line.rawAmount, nowSec }, values[index]);
      if (decision.action === 'DENY') return denial(client, caller, wallet, line.rawAmount, decision, nowSec, index);
      accepted ||= decision;
    }
    const total = lines.reduce((sum, l) => sum + l.rawAmount, 0n);
    if (total > available(wallet)) throw insufficient();
    const intent = await createIntent(client, caller, wallet,
      { kind: 'batch', destination: null, rawAmount: total, memo: '', decision: accepted, lines }, nowSec);
    return { status: 201, data: await viewOne(client, intent.id) };
  });
}

export async function deposit(caller, walletId, rawBody, idem) {
  return keyed(caller, idem, async (client, nowSec) => {
    const wallet = await lockWallet(client, caller.org.id, walletId);
    const body = objectBody(rawBody);
    unknown(body, { amount: true, reference: true });
    if (!present(body, 'amount')) fail('amount', 'amount is required.');
    const rawAmount = parseAmount(body.amount, wallet.asset, 'amount');
    const reference = text(body, 'reference', { min: 1, max: 64, trim: true, label: 'reference' });
    const dup = await client.query('SELECT id FROM deposits WHERE reference = $2 AND wallet_id = $1', [wallet.id, reference]);
    if (dup.rows.length) throw new ApiError(409, 'DUPLICATE_DEPOSIT', 'This wallet already has a deposit with that reference.');
    const id = newId('dep');
    const { rows } = await client.query(
      `INSERT INTO deposits (id, wallet_id, raw_amount, reference, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6)) RETURNING *`,
      [id, wallet.id, rawAmount.toString(), reference, creatorOf(caller), nowSec]);
    await client.query('UPDATE wallets SET balance_raw = balance_raw + $2 WHERE id = $1', [wallet.id, rawAmount.toString()]);
    await ledgerPair(client, { orgId: wallet.organization_id, kind: 'deposit', asset: wallet.asset, from: 'external',
      to: wallet.id, rawAmount, depositId: id, at: nowSec });
    await record(client, wallet.organization_id, { type: 'deposit.received', actor: actorOf(caller), subjectId: id,
      data: { deposit_id: id, wallet_id: wallet.id, raw_amount: rawAmount.toString() }, at: nowSec });
    return { status: 201, data: depositView(rows[0], wallet.asset) };
  });
}

// ---------------------------------------------------------------- decisions
async function lockIntent(client, orgId, intentId) {
  const { rows } = await client.query(
    `${INTENT_SELECT} WHERE i.id = $1 AND i.organization_id = $2 FOR UPDATE OF i`, [intentId, orgId]);
  if (!rows.length) throw new ApiError(404, 'INTENT_NOT_FOUND', 'No intent with that id exists.');
  return rows[0];
}

// Runs a decision; an intent found past its expiry is expired (and committed) before the refusal.
async function deciding(caller, intentId, work) {
  await expireDue(caller.org.id);
  const outcome = await tx(async (client) => {
    await lockOrg(client, caller.org.id);
    const nowSec = nowSeconds();
    const intent = await lockIntent(client, caller.org.id, intentId);
    const pending = async () => {
      if (await expireWithin(client, caller.org.id, nowSec, intent.id)) return false;
      return intent.status === 'pending_approval';
    };
    return work(client, intent, nowSec, pending);
  });
  if (outcome instanceof ApiError) throw outcome;
  return outcome;
}

export function decideIntent(caller, intentId, decision, rawBody) {
  return deciding(caller, intentId, async (client, intent, nowSec, pending) => {
    if (caller.apiKey) throw new ApiError(403, 'FORBIDDEN_ROLE', 'API keys cannot approve or reject.');
    const body = objectBody(rawBody);
    unknown(body, decision === 'reject' ? { reason: true } : {});
    const reason = decision === 'reject'
      ? text(body, 'reason', { min: 1, max: 280, nonBlank: true, label: 'reason', message: 'Enter a reason to reject' })
      : null;
    if (!(await pending())) return notPending();
    const me = caller.member.id;
    if (!intent.quorum_member_ids.includes(me)) {
      throw new ApiError(403, 'NOT_IN_QUORUM', 'You are not in the key quorum of this intent.');
    }
    if (intent.created_by === me) throw new ApiError(403, 'SELF_APPROVAL', 'You cannot decide a request you started.');
    const prior = await client.query('SELECT 1 FROM approvals WHERE intent_id = $1 AND member_id = $2', [intent.id, me]);
    if (prior.rows.length) throw new ApiError(409, 'ALREADY_DECIDED', 'You already decided this intent.');
    if (decision === 'approve') {
      const wallet = await lockWallet(client, caller.org.id, intent.wallet_id);
      if (wallet.status === 'frozen') throw frozen();
    }
    await client.query(
      'INSERT INTO approvals (intent_id, member_id, decision, reason, created_at) VALUES ($1, $2, $3, $4, to_timestamp($5))',
      [intent.id, me, decision, reason, nowSec]);
    const actor = actorOf(caller);
    if (decision === 'reject') {
      const { rows } = await client.query(
        `UPDATE intents SET status = 'rejected', decided_at = to_timestamp($2), rejection_reason = $3 WHERE id = $1 RETURNING *`,
        [intent.id, nowSec, reason]);
      await intentEvent(client, actor, rows[0], 'intent.rejected', nowSec);
    } else {
      await intentEvent(client, actor, intent, 'intent.approved', nowSec);
      const { rows } = await client.query(
        "SELECT count(*)::int AS approved FROM approvals WHERE intent_id = $1 AND decision = 'approve'", [intent.id]);
      if (rows[0].approved >= intent.required_approvals) await execute(client, actor, intent, nowSec);
    }
    return viewOne(client, intent.id);
  });
}

// Cancel: the role step admits owners, operators and operator keys; operators cancel only their own.
export function cancelIntent(caller, intentId, rawBody) {
  return deciding(caller, intentId, async (client, intent, nowSec, pending) => {
    noFields(rawBody);
    if (caller.role !== 'owner' && intent.created_by !== creatorOf(caller)) {
      throw new ApiError(403, 'FORBIDDEN_ROLE', 'Only the member who started this request or an owner may cancel it.');
    }
    if (!(await pending())) return notPending();
    const { rows } = await client.query(
      "UPDATE intents SET status = 'cancelled', decided_at = to_timestamp($2) WHERE id = $1 RETURNING *", [intent.id, nowSec]);
    await intentEvent(client, actorOf(caller), rows[0], 'intent.cancelled', nowSec);
    return viewOne(client, intent.id);
  });
}

// ---------------------------------------------------------------- reads
export const STATUSES = ['pending_approval', 'executed', 'rejected', 'cancelled', 'expired'];

// A cursor names the last (created_at, id) of a page with the filters and organization it was issued for,
// and a digest of all of it, so a cursor used elsewhere or altered is refused.
function cursorDigest(payload) {
  return sha256Hex(`corvo-cursor:${payload}`).slice(0, 24);
}

function encodeCursor(row, filters) {
  const payload = Buffer.from(JSON.stringify([iso(row.created_at), row.id, filters.status, filters.walletId, filters.orgId]))
    .toString('base64url');
  return `${payload}.${cursorDigest(payload)}`;
}

function decodeCursor(cursor, filters) {
  const refuse = () => { throw new ApiError(422, 'INVALID_CURSOR', 'This cursor is not valid for this list.', { field: 'cursor' }); };
  const [payload, digest, rest] = String(cursor).split('.');
  if (rest !== undefined || !payload || digest !== cursorDigest(payload)) refuse();
  let parts;
  try {
    parts = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return refuse();
  }
  const [at, id, status, walletId, orgId] = parts;
  if (status !== filters.status || walletId !== filters.walletId || orgId !== filters.orgId) refuse();
  return [at, id];
}

function listFilters(caller, q) {
  if (q.status !== undefined && !STATUSES.includes(q.status)) fail('status', `status is one of ${STATUSES.join(', ')}.`);
  return { status: q.status ?? null, walletId: q.wallet_id === undefined ? null : String(q.wallet_id), orgId: caller.org.id };
}

function filterSql(filters) {
  const where = ['i.organization_id = $1'];
  const params = [filters.orgId];
  if (filters.status) where.push(`i.status = $${params.push(filters.status)}`);
  if (filters.walletId !== null) where.push(`i.wallet_id = $${params.push(filters.walletId)}`);
  return { where, params };
}

const ORDER = 'ORDER BY i.created_at DESC, i.id COLLATE "C" DESC';

// Newest first, keyset paged; next_cursor is null exactly when nothing further matches.
export async function listIntents(caller, q) {
  let limit = 20;
  if (q.limit !== undefined) {
    if (typeof q.limit !== 'string' || !/^\d+$/.test(q.limit) || +q.limit < 1 || +q.limit > 100) {
      fail('limit', 'limit is a whole number from 1 to 100.');
    }
    limit = +q.limit;
  }
  const filters = listFilters(caller, q);
  const { where, params } = filterSql(filters);
  if (q.cursor !== undefined) {
    const [at, id] = decodeCursor(q.cursor, filters);
    const a = params.push(at);
    const b = params.push(id);
    where.push(`(i.created_at < $${a}::timestamptz OR (i.created_at = $${a}::timestamptz AND i.id COLLATE "C" < $${b}))`);
  }
  await expireDue(caller.org.id);
  const { rows } = await query(`${INTENT_SELECT} WHERE ${where.join(' AND ')} ${ORDER} LIMIT ${limit + 1}`, params);
  const page = rows.slice(0, limit);
  return { items: await intentViews(pool, page),
    next_cursor: rows.length > limit ? encodeCursor(page[page.length - 1], filters) : null };
}

export async function getIntent(caller, id) {
  await expireDue(caller.org.id);
  const { rows } = await query(`${INTENT_SELECT} WHERE i.id = $1 AND i.organization_id = $2`, [id, caller.org.id]);
  if (!rows.length) throw new ApiError(404, 'INTENT_NOT_FOUND', 'No intent with that id exists.');
  return (await intentViews(pool, rows))[0];
}

// The caller's organization's pending intents whose quorum includes the caller, not started or decided by them.
export async function inbox(caller) {
  await expireDue(caller.org.id);
  const me = caller.member.id;
  const { rows } = await query(
    `${INTENT_SELECT}
      WHERE i.organization_id = $1 AND i.status = 'pending_approval' AND i.quorum_member_ids ? $2 AND i.created_by <> $2
        AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.intent_id = i.id AND a.member_id = $2)
      ${ORDER}`, [caller.org.id, me]);
  return intentViews(pool, rows);
}

// ---------------------------------------------------------------- export
const CSV_COLUMNS = ['id', 'wallet_id', 'wallet_name', 'kind', 'destination_address', 'amount', 'asset', 'status',
  'created_by', 'created_at', 'executed_at', 'tx_hash', 'memo'];

// A cell that could start a formula gets a leading quote; a cell with a comma, quote or line break is quoted.
function csvCell(value) {
  let cell = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export async function exportCsv(caller, q) {
  const filters = listFilters(caller, q);
  const { where, params } = filterSql(filters);
  await expireDue(caller.org.id);
  const { rows } = await query(`${INTENT_SELECT} WHERE ${where.join(' AND ')} ${ORDER}`, params);
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push([row.id, row.wallet_id, row.wallet_name, row.kind, row.destination_address,
      formatAmount(row.raw_amount, row.asset), row.asset, row.status, row.created_by, iso(row.created_at),
      iso(row.executed_at), row.tx_hash, row.memo].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
