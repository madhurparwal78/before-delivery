import { ApiError, hashPassword, iso, newId, nowSeconds, parseAmount, randomHex, sha256Hex, toDate, walletAddress } from '../lib/core.js';
import { EMAIL_RE, address, choice, fail, fold, integer, noFields, objectBody, present, ref, text, unknown } from '../lib/validate.js';
import { pool, query, tx } from '../db.js';
import { actorOf, lockOrg, record } from './audit.js';
import { expireDue } from './intents.js';
import { aggregationValues, decide, referencedAggregations, validateRules } from './policy.js';
import { aggregationView, findWallet, keyView, memberView, policyView, quorumView, walletRows, walletView } from './views.js';

// A write in an organization: one transaction that first takes the organization's lock.
function write(caller, fn) {
  return tx(async (client) => {
    await lockOrg(client, caller.org.id);
    return fn(client, nowSeconds());
  });
}

async function orgRow(db, table, code, label, orgId, id, lock = '') {
  const { rows } = await db.query(`SELECT * FROM ${table} WHERE id = $1 AND organization_id = $2 ${lock}`, [String(id), orgId]);
  if (!rows.length) throw new ApiError(404, code, `No ${label} with that id exists.`);
  return rows[0];
}
export const policyRow = (db, orgId, id, lock) => orgRow(db, 'policies', 'POLICY_NOT_FOUND', 'policy', orgId, id, lock);
const quorumRow = (db, orgId, id, lock) => orgRow(db, 'key_quorums', 'QUORUM_NOT_FOUND', 'key quorum', orgId, id, lock);
const memberRow = (db, orgId, id) => orgRow(db, 'members', 'MEMBER_NOT_FOUND', 'member', orgId, id, 'FOR UPDATE');

// ---------------------------------------------------------------- wallets
const nameTaken = () => new ApiError(409, 'WALLET_NAME_TAKEN', 'Another wallet already has that name.');
const walletName = (body, optional = false) => text(body, 'name', { min: 1, max: 60, trim: true, optional, label: 'name' });

export async function listWallets(orgId) {
  await expireDue(orgId);
  return (await walletRows(pool, orgId)).map(walletView);
}

export async function getWallet(orgId, id) {
  await expireDue(orgId);
  return walletView(await findWallet(pool, orgId, id));
}

function floorOf(body, asset) {
  if (!present(body, 'approval_floor')) return undefined;
  return parseAmount(body.approval_floor, asset, 'approval_floor', { allowZero: true });
}

export function createWallet(caller, rawBody) {
  return write(caller, async (client, now) => {
    const body = objectBody(rawBody);
    unknown(body, { name: true, chain: true, asset: true, policy_id: true, quorum_id: true, approval_floor: true });
    const name = walletName(body);
    const chain = choice(body, 'chain', ['ethereum', 'base']);
    const asset = choice(body, 'asset', ['usdc', 'eth']);
    const policyId = ref(body, 'policy_id') ?? null;
    if (policyId) await policyRow(client, caller.org.id, policyId);
    const quorumId = ref(body, 'quorum_id') ?? null;
    if (quorumId) await quorumRow(client, caller.org.id, quorumId);
    const floor = floorOf(body, asset) ?? 0n;
    const taken = await client.query('SELECT 1 FROM wallets WHERE organization_id = $1 AND name_key = $2',
      [caller.org.id, fold(name)]);
    if (taken.rows.length) throw nameTaken();
    const id = newId('wal');
    await client.query(
      `INSERT INTO wallets (id, organization_id, name, name_key, chain, asset, address, policy_id, quorum_id,
                            approval_floor_raw, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, to_timestamp($11))`,
      [id, caller.org.id, name, fold(name), chain, asset, walletAddress(id), policyId, quorumId, floor.toString(), now]);
    await record(client, caller.org.id, { type: 'wallet.created', actor: actorOf(caller), subjectId: id,
      data: { name, chain, asset, policy_id: policyId, quorum_id: quorumId, approval_floor_raw: floor.toString() }, at: now });
    return walletView(await findWallet(client, caller.org.id, id));
  });
}

export function updateWallet(caller, id, rawBody) {
  return write(caller, async (client, now) => {
    await client.query('SELECT id FROM wallets WHERE id = $1 AND organization_id = $2 FOR UPDATE', [id, caller.org.id]);
    const wallet = await findWallet(client, caller.org.id, id);
    const body = objectBody(rawBody);
    unknown(body, { name: true, policy_id: true, quorum_id: true, approval_floor: true });
    const changes = {};
    const name = walletName(body, true);
    if (name !== undefined) changes.name = name;
    const policyId = ref(body, 'policy_id');
    if (policyId) await policyRow(client, caller.org.id, policyId);
    if (policyId !== undefined) changes.policy_id = policyId;
    const quorumId = ref(body, 'quorum_id');
    if (quorumId) await quorumRow(client, caller.org.id, quorumId);
    if (quorumId !== undefined) changes.quorum_id = quorumId;
    const floor = floorOf(body, wallet.asset);
    if (floor !== undefined) changes.approval_floor_raw = floor.toString();
    if (name !== undefined) {
      const taken = await client.query('SELECT 1 FROM wallets WHERE organization_id = $1 AND name_key = $2 AND id <> $3',
        [caller.org.id, fold(name), id]);
      if (taken.rows.length) throw nameTaken();
    }
    await client.query(
      `UPDATE wallets SET name = COALESCE($2, name), name_key = COALESCE($3, name_key),
              policy_id = CASE WHEN $4 THEN $5 ELSE policy_id END,
              quorum_id = CASE WHEN $6 THEN $7 ELSE quorum_id END,
              approval_floor_raw = COALESCE($8::numeric, approval_floor_raw)
        WHERE id = $1`,
      [id, name ?? null, name === undefined ? null : fold(name), policyId !== undefined, policyId ?? null,
        quorumId !== undefined, quorumId ?? null, floor === undefined ? null : floor.toString()]);
    await record(client, caller.org.id, { type: 'wallet.updated', actor: actorOf(caller), subjectId: id, data: changes, at: now });
    return walletView(await findWallet(client, caller.org.id, id));
  });
}

export function setFrozen(caller, id, frozen, rawBody) {
  return write(caller, async (client, now) => {
    await client.query('SELECT id FROM wallets WHERE id = $1 AND organization_id = $2 FOR UPDATE', [id, caller.org.id]);
    const wallet = await findWallet(client, caller.org.id, id);
    noFields(rawBody);
    if (frozen && wallet.status === 'frozen') throw new ApiError(409, 'WALLET_FROZEN', 'This wallet is already frozen.');
    if (!frozen && wallet.status !== 'frozen') throw new ApiError(409, 'WALLET_NOT_FROZEN', 'This wallet is not frozen.');
    const status = frozen ? 'frozen' : 'active';
    await client.query('UPDATE wallets SET status = $2 WHERE id = $1', [id, status]);
    await record(client, caller.org.id, { type: frozen ? 'wallet.frozen' : 'wallet.unfrozen', actor: actorOf(caller),
      subjectId: id, data: { status }, at: now });
    return walletView(await findWallet(client, caller.org.id, id));
  });
}

// ---------------------------------------------------------------- policies
async function aggregationIds(db, orgId) {
  const { rows } = await db.query('SELECT id FROM aggregations WHERE organization_id = $1', [orgId]);
  return new Set(rows.map((r) => r.id));
}

const RULES_SHAPE = { rules: [{ name: true, method: true, action: true,
  conditions: [{ field_source: true, field: true, operator: true, value: true }] }] };
const policyName = (body, optional = false) => text(body, 'name', { min: 1, max: 80, trim: true, optional, label: 'name' });

async function saveRevision(client, row, now) {
  await client.query('INSERT INTO policy_revisions (policy_id, revision, name, rules, created_at) VALUES ($1, $2, $3, $4, to_timestamp($5))',
    [row.id, row.revision, row.name, JSON.stringify(row.rules), now]);
}

export function createPolicy(caller, rawBody) {
  return write(caller, async (client, now) => {
    const body = objectBody(rawBody);
    unknown(body, { version: true, name: true, chain_type: true, ...RULES_SHAPE });
    if (body.version !== '1.0') throw new ApiError(422, 'INVALID_POLICY', 'version is the string "1.0".', { path: 'version' });
    const name = policyName(body);
    if (body.chain_type !== 'ethereum') {
      throw new ApiError(422, 'INVALID_POLICY', 'chain_type is the string "ethereum".', { path: 'chain_type' });
    }
    const rules = validateRules(body.rules, await aggregationIds(client, caller.org.id));
    const { rows } = await client.query(
      `INSERT INTO policies (id, organization_id, version, name, chain_type, rules, revision, created_at, updated_at)
       VALUES ($1, $2, '1.0', $3, 'ethereum', $4, 1, to_timestamp($5), to_timestamp($5)) RETURNING *`,
      [newId('pol'), caller.org.id, name, JSON.stringify(rules), now]);
    await saveRevision(client, rows[0], now);
    await record(client, caller.org.id, { type: 'policy.created', actor: actorOf(caller), subjectId: rows[0].id,
      data: { name, revision: 1 }, at: now });
    return policyView(rows[0]);
  });
}

// Every successful update raises the revision by one and keeps the earlier revision readable.
export function updatePolicy(caller, id, rawBody) {
  return write(caller, async (client, now) => {
    const current = await policyRow(client, caller.org.id, id, 'FOR UPDATE');
    const body = objectBody(rawBody);
    unknown(body, { name: true, ...RULES_SHAPE });
    const name = policyName(body, true) ?? current.name;
    const rules = present(body, 'rules') ? validateRules(body.rules, await aggregationIds(client, caller.org.id)) : current.rules;
    const { rows } = await client.query(
      `UPDATE policies SET name = $2, rules = $3, revision = revision + 1, updated_at = to_timestamp($4)
        WHERE id = $1 RETURNING *`, [id, name, JSON.stringify(rules), now]);
    await saveRevision(client, rows[0], now);
    await record(client, caller.org.id, { type: 'policy.updated', actor: actorOf(caller), subjectId: id,
      data: { name, revision: rows[0].revision }, at: now });
    return policyView(rows[0]);
  });
}

export function deletePolicy(caller, id, rawBody) {
  return write(caller, async (client, now) => {
    const current = await policyRow(client, caller.org.id, id, 'FOR UPDATE');
    noFields(rawBody);
    const used = await client.query('SELECT 1 FROM wallets WHERE policy_id = $1 LIMIT 1', [id]);
    if (used.rows.length) throw new ApiError(409, 'POLICY_IN_USE', 'A wallet uses this policy.');
    await client.query('DELETE FROM policies WHERE id = $1', [id]);
    await record(client, caller.org.id, { type: 'policy.deleted', actor: actorOf(caller), subjectId: id,
      data: { name: current.name, revision: current.revision }, at: now });
    return { deleted: true };
  });
}

export async function listPolicies(orgId) {
  const { rows } = await query('SELECT * FROM policies WHERE organization_id = $1 ORDER BY name COLLATE "C", id', [orgId]);
  return rows.map(policyView);
}

export async function getPolicy(orgId, id) {
  return policyView(await policyRow(pool, orgId, id));
}

export async function listRevisions(orgId, id) {
  await policyRow(pool, orgId, id);
  const { rows } = await query('SELECT * FROM policy_revisions WHERE policy_id = $1 ORDER BY revision', [id]);
  return rows.map((r) => ({ revision: r.revision, name: r.name, rules: r.rules, created_at: iso(r.created_at) }));
}

// Evaluates the named policy for the named wallet under its live revision, writing nothing.
export async function evaluatePolicy(caller, id, rawBody) {
  const policy = await policyRow(pool, caller.org.id, id);
  const body = objectBody(rawBody);
  unknown(body, { method: true, wallet_id: true, destination_address: true, amount: true });
  const method = choice(body, 'method', ['transfer', 'batch_payout']);
  if (typeof body.wallet_id !== 'string') fail('wallet_id', 'wallet_id is required.');
  const wallet = await findWallet(pool, caller.org.id, body.wallet_id);
  const destination = address(body, 'destination_address');
  if (!present(body, 'amount')) fail('amount', 'amount is required.');
  const rawAmount = parseAmount(body.amount, wallet.asset, 'amount');
  await expireDue(caller.org.id);
  const nowSec = nowSeconds();
  const [values] = await aggregationValues(pool, policy, wallet, [{ destination, rawAmount }], nowSec);
  const { decision, trace } = decide(policy, { method, asset: wallet.asset, chain: wallet.chain, destination, rawAmount, nowSec }, values);
  const aggregations = Object.fromEntries(referencedAggregations(policy.rules).map((agg) => [agg, values[agg].toString()]));
  return { ...decision, aggregations, trace };
}

// ---------------------------------------------------------------- aggregations and quorums
export async function listAggregations(orgId) {
  const { rows } = await query('SELECT * FROM aggregations WHERE organization_id = $1 ORDER BY created_at, id', [orgId]);
  return rows.map(aggregationView);
}

export function createAggregation(caller, rawBody) {
  return write(caller, async (client, now) => {
    const body = objectBody(rawBody);
    unknown(body, { name: true, metric: true, window_seconds: true, asset: true, group_by: true });
    const name = text(body, 'name', { min: 1, max: 80, trim: true, label: 'name' });
    const metric = choice(body, 'metric', ['sum_amount', 'count']);
    const windowSeconds = integer(body, 'window_seconds', { min: 60, max: 2592000 });
    const asset = choice(body, 'asset', ['usdc', 'eth']);
    const groupBy = choice(body, 'group_by', ['wallet', 'destination'], { optional: true }) ?? 'wallet';
    const { rows } = await client.query(
      `INSERT INTO aggregations (id, organization_id, name, metric, window_seconds, asset, group_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8)) RETURNING *`,
      [newId('agg'), caller.org.id, name, metric, windowSeconds, asset, groupBy, now]);
    await record(client, caller.org.id, { type: 'aggregation.created', actor: actorOf(caller), subjectId: rows[0].id,
      data: { name, metric, window_seconds: windowSeconds, asset, group_by: groupBy }, at: now });
    return aggregationView(rows[0]);
  });
}

export async function listQuorums(orgId) {
  const { rows } = await query('SELECT * FROM key_quorums WHERE organization_id = $1 ORDER BY created_at, id', [orgId]);
  return rows.map(quorumView);
}

const SIGNER_ROLES = ['owner', 'approver'];

// 1 to 10 distinct members of the organization whose role is owner or approver.
async function quorumMembers(client, orgId, ids) {
  const refuse = () => {
    throw new ApiError(422, 'INVALID_QUORUM_MEMBER', 'A key quorum has 1 to 10 distinct owners or approvers of this organization.',
      { field: 'member_ids' });
  };
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10 || !ids.every((v) => typeof v === 'string')
      || new Set(ids).size !== ids.length) refuse();
  const { rows } = await client.query(
    `SELECT id FROM members WHERE organization_id = $1 AND role IN ('owner', 'approver')
        AND id IN (SELECT jsonb_array_elements_text($2::jsonb))`, [orgId, JSON.stringify(ids)]);
  if (rows.length !== ids.length) refuse();
  return ids;
}

function threshold(value, count) {
  if (!Number.isSafeInteger(value) || value < 1 || value > count) {
    throw new ApiError(422, 'INVALID_THRESHOLD', `authorization_threshold is a whole number from 1 to ${count}.`,
      { field: 'authorization_threshold' });
  }
  return value;
}

const QUORUM_SHAPE = { name: true, member_ids: true, authorization_threshold: true, expiry_seconds: true };

export function createQuorum(caller, rawBody) {
  return write(caller, async (client, now) => {
    const body = objectBody(rawBody);
    unknown(body, QUORUM_SHAPE);
    const name = text(body, 'name', { min: 1, max: 80, trim: true, label: 'name' });
    const memberIds = await quorumMembers(client, caller.org.id, body.member_ids);
    const required = threshold(body.authorization_threshold, memberIds.length);
    const expiry = integer(body, 'expiry_seconds', { min: 60, max: 2592000 });
    const { rows } = await client.query(
      `INSERT INTO key_quorums (id, organization_id, name, member_ids, authorization_threshold, expiry_seconds, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7)) RETURNING *`,
      [newId('kq'), caller.org.id, name, JSON.stringify(memberIds), required, expiry, now]);
    await record(client, caller.org.id, { type: 'quorum.created', actor: actorOf(caller), subjectId: rows[0].id,
      data: { name, member_ids: memberIds, authorization_threshold: required, expiry_seconds: expiry }, at: now });
    return quorumView(rows[0]);
  });
}

// Editing a quorum never changes an intent already waiting on it: intents keep their own copy.
export function updateQuorum(caller, id, rawBody) {
  return write(caller, async (client, now) => {
    const current = await quorumRow(client, caller.org.id, id, 'FOR UPDATE');
    const body = objectBody(rawBody);
    unknown(body, QUORUM_SHAPE);
    const name = text(body, 'name', { min: 1, max: 80, trim: true, optional: true, label: 'name' }) ?? current.name;
    const memberIds = present(body, 'member_ids') ? await quorumMembers(client, caller.org.id, body.member_ids) : current.member_ids;
    const required = threshold(present(body, 'authorization_threshold') ? body.authorization_threshold
      : current.authorization_threshold, memberIds.length);
    const expiry = integer(body, 'expiry_seconds', { min: 60, max: 2592000, optional: true }) ?? current.expiry_seconds;
    const { rows } = await client.query(
      `UPDATE key_quorums SET name = $2, member_ids = $3, authorization_threshold = $4, expiry_seconds = $5
        WHERE id = $1 RETURNING *`, [id, name, JSON.stringify(memberIds), required, expiry]);
    await record(client, caller.org.id, { type: 'quorum.updated', actor: actorOf(caller), subjectId: id,
      data: { name, member_ids: memberIds, authorization_threshold: required, expiry_seconds: expiry }, at: now });
    return quorumView(rows[0]);
  });
}

// ---------------------------------------------------------------- members
const ROLES = ['owner', 'operator', 'approver', 'auditor'];
const memberExists = () => new ApiError(409, 'MEMBER_EXISTS', 'A member with that email already exists.');

export async function listMembers(orgId) {
  const { rows } = await query('SELECT * FROM members WHERE organization_id = $1 ORDER BY email', [orgId]);
  return rows.map(memberView);
}

export function createMember(caller, rawBody) {
  return write(caller, async (client, now) => {
    const body = objectBody(rawBody);
    unknown(body, { name: true, email: true, role: true, password: true });
    const name = text(body, 'name', { min: 1, max: 80, trim: true, label: 'name' });
    const email = text(body, 'email', { min: 3, max: 254, trim: true, label: 'email' }).toLowerCase();
    if (!EMAIL_RE.test(email)) fail('email', 'Enter a valid email address.');
    const role = choice(body, 'role', ROLES);
    const password = text(body, 'password', { min: 12, max: Infinity, label: 'password',
      message: 'A password has at least 12 characters.' });
    const taken = await client.query('SELECT 1 FROM members WHERE email = $1', [email]);
    if (taken.rows.length) throw memberExists();
    const { rows } = await client.query(
      `INSERT INTO members (id, organization_id, name, email, role, password_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7)) RETURNING *`,
      [newId('mem'), caller.org.id, name, email, role, hashPassword(password), now]).catch((err) => {
      throw err.code === '23505' ? memberExists() : err;
    });
    await record(client, caller.org.id, { type: 'member.added', actor: actorOf(caller), subjectId: rows[0].id,
      data: { member_id: rows[0].id, email, role }, at: now });
    return memberView(rows[0]);
  });
}

// Quorum members keep a signing role; an organization always keeps one owner. nextRole null is a removal.
async function guardMember(client, orgId, member, nextRole) {
  if (!SIGNER_ROLES.includes(nextRole)) {
    const inQuorum = await client.query('SELECT 1 FROM key_quorums WHERE organization_id = $1 AND member_ids ? $2 LIMIT 1',
      [orgId, member.id]);
    if (inQuorum.rows.length) throw new ApiError(409, 'MEMBER_IN_QUORUM', 'This member belongs to a key quorum.');
  }
  if (member.role === 'owner' && nextRole !== 'owner') {
    const { rows } = await client.query("SELECT count(*)::int AS owners FROM members WHERE organization_id = $1 AND role = 'owner'", [orgId]);
    if (rows[0].owners <= 1) throw new ApiError(409, 'LAST_OWNER', 'An organization keeps at least one owner.');
  }
}

export function updateMember(caller, id, rawBody) {
  return write(caller, async (client, now) => {
    const member = await memberRow(client, caller.org.id, id);
    const body = objectBody(rawBody);
    unknown(body, { role: true });
    const role = choice(body, 'role', ROLES);
    await guardMember(client, caller.org.id, member, role);
    const { rows } = await client.query('UPDATE members SET role = $2 WHERE id = $1 RETURNING *', [id, role]);
    await record(client, caller.org.id, { type: 'member.updated', actor: actorOf(caller), subjectId: id,
      data: { member_id: id, role, previous_role: member.role }, at: now });
    return memberView(rows[0]);
  });
}

// Removal ends the member's sessions and revokes every live key they created, in creation order.
export function removeMember(caller, id, rawBody) {
  return write(caller, async (client, now) => {
    const member = await memberRow(client, caller.org.id, id);
    noFields(rawBody);
    await guardMember(client, caller.org.id, member, null);
    const actor = actorOf(caller);
    const { rows: keys } = await client.query(
      `UPDATE api_keys SET revoked_at = to_timestamp($2) WHERE created_by = $1 AND revoked_at IS NULL RETURNING *`, [id, now]);
    keys.sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
    for (const key of keys) {
      await record(client, caller.org.id, { type: 'api_key.revoked', actor, subjectId: key.id,
        data: { api_key_id: key.id, prefix: key.prefix }, at: now });
    }
    await client.query('DELETE FROM members WHERE id = $1', [id]);
    await record(client, caller.org.id, { type: 'member.removed', actor, subjectId: id, data: { member_id: id }, at: now });
    return { removed: true };
  });
}

// ---------------------------------------------------------------- API keys and the signing secret
export async function listKeys(orgId) {
  const { rows } = await query('SELECT * FROM api_keys WHERE organization_id = $1 ORDER BY created_at, id', [orgId]);
  return rows.map(keyView);
}

// The secret shows once, in this answer; only its hash is stored.
export function createKey(caller, rawBody) {
  return write(caller, async (client, now) => {
    const body = objectBody(rawBody);
    unknown(body, { name: true, role: true });
    const name = text(body, 'name', { min: 1, max: 60, trim: true, label: 'name' });
    const role = choice(body, 'role', ['operator', 'auditor']);
    const secret = `cvo_${randomHex(20)}`;
    const prefix = secret.slice(0, 12);
    const { rows } = await client.query(
      `INSERT INTO api_keys (id, organization_id, name, role, prefix, secret_hash, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8)) RETURNING *`,
      [newId('key'), caller.org.id, name, role, prefix, sha256Hex(secret), caller.member.id, now]);
    await record(client, caller.org.id, { type: 'api_key.created', actor: actorOf(caller), subjectId: rows[0].id,
      data: { api_key_id: rows[0].id, name, role, prefix }, at: now });
    const view = keyView(rows[0]);
    return { id: view.id, name, role, prefix, secret, created_by: view.created_by, created_at: view.created_at };
  });
}

export function revokeKey(caller, id, rawBody) {
  return write(caller, async (client, now) => {
    const { rows } = await client.query('SELECT * FROM api_keys WHERE organization_id = $2 AND id = $1 FOR UPDATE',
      [id, caller.org.id]);
    if (!rows.length) throw new ApiError(404, 'API_KEY_NOT_FOUND', 'No API key with that id exists.');
    noFields(rawBody);
    if (!rows[0].revoked_at) {
      await client.query('UPDATE api_keys SET revoked_at = to_timestamp($2) WHERE id = $1', [id, now]);
      await record(client, caller.org.id, { type: 'api_key.revoked', actor: actorOf(caller), subjectId: id,
        data: { api_key_id: id, prefix: rows[0].prefix }, at: now });
    }
    return { revoked: true };
  });
}

export async function readSecret(orgId) {
  const { rows } = await query('SELECT webhook_secret FROM organizations WHERE id = $1', [orgId]);
  return { secret: rows[0].webhook_secret };
}

// Later events sign with the new secret; earlier events keep the signature they were written with.
export function rotateSecret(caller) {
  return write(caller, async (client, now) => {
    const secret = `whsec_${randomHex(16)}`;
    await client.query('UPDATE organizations SET webhook_secret = $2 WHERE id = $1', [caller.org.id, secret]);
    await record(client, caller.org.id, { type: 'webhook_secret.rotated', actor: actorOf(caller), subjectId: caller.org.id,
      data: { organization_id: caller.org.id }, at: now });
    return { secret };
  });
}

// ---------------------------------------------------------------- contact
export const VOLUMES = ['Under $1M', '$1M to $10M', '$10M to $100M', 'Over $100M'];
const FREE_MAIL = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'];
const CONTROL_MESSAGE = 'Remove control characters from this field';
const CONTACT_FIELDS = {
  full_name: (b) => text(b, 'full_name', { min: 2, max: 80, trim: true, message: 'Enter your full name (2 to 80 characters)',
    controlMessage: CONTROL_MESSAGE }),
  work_email: (b) => {
    const email = text(b, 'work_email', { min: 3, max: 254, trim: true, message: 'Enter a valid email address',
      controlMessage: CONTROL_MESSAGE });
    if (!EMAIL_RE.test(email)) fail('work_email', 'Enter a valid email address');
    if (FREE_MAIL.includes(email.split('@').pop().toLowerCase())) fail('work_email', 'Use your work email');
    return email;
  },
  company: (b) => text(b, 'company', { min: 2, max: 120, trim: true, message: 'Enter your company name (2 to 120 characters)',
    controlMessage: CONTROL_MESSAGE }),
  monthly_volume: (b) => choice(b, 'monthly_volume', VOLUMES, { message: 'Choose a monthly volume' }),
  message: (b) => text(b, 'message', { min: 10, max: 2000, lines: true, message: 'Tell us a little more (10 to 2000 characters)',
    controlMessage: CONTROL_MESSAGE }),
};

// Every field's refusal in the pinned order: the API answers the first, the page shows them all.
export function contactRefusals(rawBody) {
  const body = objectBody(rawBody);
  unknown(body, CONTACT_FIELDS);
  const values = {};
  const refusals = [];
  for (const [field, read] of Object.entries(CONTACT_FIELDS)) {
    try {
      values[field] = read(body);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      refusals.push(err);
    }
  }
  return { values, refusals };
}

export async function createContact(rawBody) {
  const { values, refusals } = contactRefusals(rawBody);
  if (refusals.length) throw refusals[0];
  const id = newId('con');
  const now = nowSeconds();
  await query(
    `INSERT INTO contact_requests (id, full_name, work_email, company, monthly_volume, message, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7))`,
    [id, values.full_name, values.work_email, values.company, values.monthly_volume, values.message, now]);
  return { id, created_at: iso(toDate(now)) };
}
