import { errors, ApiError, NOT_FOUND_CODES } from '../lib/http.js';
import { newId, newWebhookSecret, numToBigInt, formatTs, newToken, sha256Hex } from '../lib/core.js';
import { textField } from '../lib/text.js';
import { auditAppend, verifyChain, eventSignature } from '../lib/audit.js';
import { withTransaction, withClient } from '../lib/db.js';
import { actorOf } from '../lib/intents.js';
import { checkAmount } from '../lib/intents.js';
import { validatePolicyBody } from '../lib/policy-validate.js';
import {
  walletResponse, policyResponse, quorumResponse, aggregationResponse,
  memberResponse, apiKeyResponse,
} from '../lib/shapes.js';
import { policyDecisionForRequest } from '../lib/intents.js';
import { aggValuesByField } from '../lib/policy.js';
import { rawToDisplay } from '../lib/core.js';
import { getWallet, checkAddress } from '../lib/intents.js';
import { aggregationValuesForPolicy, evaluatePolicy } from '../lib/policy.js';
import { isPlainObject } from '../lib/validate.js';
import { newSalt, hashPassword } from '../lib/core.js';

const notFound = (kind) => errors.notFound(...NOT_FOUND_CODES[kind]);
const nowSeconds = () => new Date(Math.floor(Date.now() / 1000) * 1000);

const QUORUM_ROLES = ['owner', 'approver'];

async function orgAggregationIds(client, orgId) {
  const { rows } = await client.query('SELECT id FROM aggregations WHERE organization_id = $1', [orgId]);
  return new Set(rows.map((r) => r.id));
}

export const adminRoutes = [
  // ---- policies ---------------------------------------------------------
  { method: 'GET', pattern: /^\/api\/v1\/policies$/, auth: 'readers',
    async handler(ctx, { send }) {
      const { rows } = await withClient((client) => client.query(
        'SELECT * FROM policies WHERE organization_id = $1 ORDER BY name COLLATE "C"', [ctx.organization_id]));
      send(200, { policies: rows.map(policyResponse) });
    } },
  { method: 'POST', pattern: /^\/api\/v1\/policies$/, auth: ['owner'],
    bodyKeys: ['version', 'name', 'chain_type', 'rules'],
    async handler(ctx, { body, send }) {
      const data = await withTransaction(async (client) => {
        const orgId = ctx.organization_id;
        const valid = validatePolicyBody(body, await orgAggregationIds(client, orgId), { create: true });
        const id = newId('pol');
        const now = nowSeconds();
        await client.query(
          `INSERT INTO policies (id, organization_id, version, name, chain_type, rules, revision, created_at, updated_at)
           VALUES ($1,$2,'1.0',$3,'ethereum',$4,1,$5,$6)`,
          [id, orgId, valid.name, JSON.stringify(valid.rules), now, now]);
        await client.query(
          `INSERT INTO policy_revisions (policy_id, revision, name, rules, created_at)
           VALUES ($1,1,$2,$3,$4)`, [id, valid.name, JSON.stringify(valid.rules), now]);
        await auditAppend(client, orgId, 'policy.created', actorOf(ctx), id, now,
          { policy_id: id, name: valid.name, revision: 1, rule_count: valid.rules.length }, { signed: false });
        const { rows: [p] } = await client.query('SELECT * FROM policies WHERE id = $1', [id]);
        return policyResponse(p);
      });
      send(201, data);
    } },
  { method: 'GET', pattern: /^\/api\/v1\/policies\/([a-z0-9_]+)$/, auth: 'readers',
    async handler(ctx, { params, send }) {
      const data = await withClient(async (client) => {
        const { rows } = await client.query(
          'SELECT * FROM policies WHERE id = $1 AND organization_id = $2', [params[0], ctx.organization_id]);
        if (!rows.length) throw notFound('policy');
        return policyResponse(rows[0]);
      });
      send(200, data);
    } },
  { method: 'GET', pattern: /^\/api\/v1\/policies\/([a-z0-9_]+)\/revisions$/, auth: 'readers',
    async handler(ctx, { params, send }) {
      const data = await withClient(async (client) => {
        const { rows: p } = await client.query(
          'SELECT id FROM policies WHERE id = $1 AND organization_id = $2', [params[0], ctx.organization_id]);
        if (!p.length) throw notFound('policy');
        const { rows } = await client.query(
          'SELECT revision, name, rules, created_at FROM policy_revisions WHERE policy_id = $1 ORDER BY revision',
          [params[0]]);
        return { revisions: rows.map((r) => ({
          revision: r.revision, name: r.name, rules: r.rules, created_at: formatTs(r.created_at),
        })) };
      });
      send(200, data);
    } },
  { method: 'PATCH', pattern: /^\/api\/v1\/policies\/([a-z0-9_]+)$/, auth: ['owner'],
    bodyKeys: ['name', 'rules'],
    async handler(ctx, { params, body, send }) {
      const data = await withTransaction(async (client) => {
        const orgId = ctx.organization_id;
        const { rows: [policy] } = await client.query(
          'SELECT * FROM policies WHERE id = $1 AND organization_id = $2 FOR UPDATE', [params[0], orgId]);
        if (!policy) throw notFound('policy');
        for (const k of Object.keys(body)) {
          if (!['name', 'rules'].includes(k)) throw errors.unknownField(k);
        }
        const name = Object.hasOwn(body, 'name')
          ? textField(body.name, { field: 'name', min: 1, max: 80 })
          : policy.name;
        const rules = Object.hasOwn(body, 'rules')
          ? validatePolicyBody({ name, rules: body.rules }, await orgAggregationIds(client, orgId), { create: false }).rules
          : policy.rules;
        const revision = policy.revision + 1;
        const now = nowSeconds();
        await client.query(
          'UPDATE policies SET name = $1, rules = $2, revision = $3, updated_at = $4 WHERE id = $5',
          [name, JSON.stringify(rules), revision, now, policy.id]);
        await client.query(
          `INSERT INTO policy_revisions (policy_id, revision, name, rules, created_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [policy.id, revision, name, JSON.stringify(rules), now]);
        await auditAppend(client, orgId, 'policy.updated', actorOf(ctx), policy.id, now,
          { policy_id: policy.id, name, revision, rule_count: rules.length }, { signed: false });
        const { rows: [fresh] } = await client.query('SELECT * FROM policies WHERE id = $1', [policy.id]);
        return policyResponse(fresh);
      });
      send(200, data);
    } },
  { method: 'DELETE', pattern: /^\/api\/v1\/policies\/([a-z0-9_]+)$/, auth: ['owner'],
    async handler(ctx, { params, send }) {
      await withTransaction(async (client) => {
        const orgId = ctx.organization_id;
        const { rows: [policy] } = await client.query(
          'SELECT * FROM policies WHERE id = $1 AND organization_id = $2 FOR UPDATE', [params[0], orgId]);
        if (!policy) throw notFound('policy');
        const { rows: users } = await client.query(
          'SELECT id FROM wallets WHERE organization_id = $1 AND policy_id = $2', [orgId, policy.id]);
        if (users.length) throw errors.conflict('POLICY_IN_USE', 'A wallet still uses this policy.');
        await client.query('DELETE FROM policies WHERE id = $1', [policy.id]);
        await auditAppend(client, orgId, 'policy.deleted', actorOf(ctx), policy.id, nowSeconds(),
          { policy_id: policy.id, name: policy.name }, { signed: false });
      });
      send(200, { deleted: true });
    } },
  { method: 'POST', pattern: /^\/api\/v1\/policies\/([a-z0-9_]+)\/evaluate$/, auth: 'readers',
    bodyKeys: ['method', 'wallet_id', 'destination_address', 'amount'],
    async handler(ctx, { params, body, send }) {
      const data = await withClient(async (client) => {
        const orgId = ctx.organization_id;
        const { rows: [policy] } = await client.query(
          'SELECT * FROM policies WHERE id = $1 AND organization_id = $2', [params[0], orgId]);
        if (!policy) throw notFound('policy');
        for (const k of Object.keys(body)) {
          if (!['method', 'wallet_id', 'destination_address', 'amount'].includes(k)) throw errors.unknownField(k);
        }
        if (typeof body.method !== 'string' || !['transfer', 'batch_payout'].includes(body.method)) {
          throw errors.validation('method', 'Choose transfer or batch_payout');
        }
        if (typeof body.wallet_id !== 'string') {
          throw errors.validation('wallet_id', 'Choose a wallet');
        }
        const wallet = await getWallet(client, orgId, body.wallet_id);
        if (!wallet) throw notFound('wallet');
        const dest = checkAddress(body.destination_address, 'destination_address');
        const amount = checkAmount(body.amount, wallet.asset, 'amount');
        const now = nowSeconds();
        const aggValues = await aggregationValuesForPolicy(
          client, orgId, policy.rules, wallet, dest, now,
          [{ destination: dest, amount }], 1);
        const request = {
          method: body.method,
          source: { asset: wallet.asset, chain: wallet.chain, amount },
          destination: { address: dest },
          now: BigInt(Math.floor(now.getTime() / 1000)),
        };
        const result = evaluatePolicy(policy.rules, request, aggValuesByField(aggValues));
        const aggregations = {};
        for (const [id, v] of Object.entries(aggValues)) aggregations[id] = v.toString();
        return {
          action: result.action, rule: result.rule, reason: result.reason,
          policy_id: policy.id, policy_revision: policy.revision,
          aggregations,
          trace: result.trace.map((t) => ({ rule: t.rule, considered: t.considered, matched: t.matched, conditions: t.conditions })),
        };
      });
      send(200, data);
    } },

  // ---- aggregations -------------------------------------------------------
  { method: 'GET', pattern: /^\/api\/v1\/aggregations$/, auth: 'readers',
    async handler(ctx, { send }) {
      const { rows } = await withClient((client) => client.query(
        'SELECT * FROM aggregations WHERE organization_id = $1 ORDER BY name COLLATE "C"', [ctx.organization_id]));
      send(200, { aggregations: rows.map(aggregationResponse) });
    } },
  { method: 'POST', pattern: /^\/api\/v1\/aggregations$/, auth: ['owner'],
    bodyKeys: ['name', 'metric', 'window_seconds', 'asset', 'group_by'],
    async handler(ctx, { body, send }) {
      const data = await withTransaction(async (client) => {
        const orgId = ctx.organization_id;
        for (const k of Object.keys(body)) {
          if (!['name', 'metric', 'window_seconds', 'asset', 'group_by'].includes(k)) throw errors.unknownField(k);
        }
        const name = textField(body.name, { field: 'name', min: 1, max: 80 });
        if (body.metric !== 'sum_amount' && body.metric !== 'count') {
          throw errors.validation('metric', 'Choose sum_amount or count');
        }
        if (!Number.isInteger(body.window_seconds) || body.window_seconds < 60 || body.window_seconds > 2592000) {
          throw errors.validation('window_seconds', 'Choose a window between 60 and 2592000 seconds');
        }
        if (body.asset !== 'usdc' && body.asset !== 'eth') {
          throw errors.validation('asset', 'Choose usdc or eth');
        }
        let groupBy = 'wallet';
        if (body.group_by !== undefined && body.group_by !== null) {
          if (body.group_by !== 'wallet' && body.group_by !== 'destination') {
            throw errors.validation('group_by', 'Choose wallet or destination');
          }
          groupBy = body.group_by;
        }
        const id = newId('agg');
        const now = nowSeconds();
        await client.query(
          `INSERT INTO aggregations (id, organization_id, name, metric, window_seconds, asset, group_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, orgId, name, body.metric, body.window_seconds, body.asset, groupBy, now]);
        await auditAppend(client, orgId, 'aggregation.created', actorOf(ctx), id, now,
          { aggregation_id: id, name, metric: body.metric, window_seconds: body.window_seconds, asset: body.asset, group_by: groupBy },
          { signed: false });
        const { rows: [a] } = await client.query('SELECT * FROM aggregations WHERE id = $1', [id]);
        return aggregationResponse(a);
      });
      send(201, data);
    } },

  // ---- quorums -------------------------------------------------------------
  { method: 'GET', pattern: /^\/api\/v1\/quorums$/, auth: 'readers',
    async handler(ctx, { send }) {
      const { rows } = await withClient((client) => client.query(
        'SELECT * FROM key_quorums WHERE organization_id = $1 ORDER BY name COLLATE "C"', [ctx.organization_id]));
      send(200, { quorums: rows.map(quorumResponse) });
    } },
  { method: 'POST', pattern: /^\/api\/v1\/quorums$/, auth: ['owner'],
    bodyKeys: ['name', 'member_ids', 'authorization_threshold', 'expiry_seconds'],
    async handler(ctx, { body, send }) {
      const data = await withTransaction(async (client) => createQuorum(ctx, client, body));
      send(201, data);
    } },
  { method: 'PATCH', pattern: /^\/api\/v1\/quorums\/([a-z0-9_]+)$/, auth: ['owner'],
    bodyKeys: ['name', 'member_ids', 'authorization_threshold', 'expiry_seconds'],
    async handler(ctx, { params, body, send }) {
      const data = await withTransaction(async (client) => {
        const orgId = ctx.organization_id;
        const { rows: [q] } = await client.query(
          'SELECT * FROM key_quorums WHERE id = $1 AND organization_id = $2 FOR UPDATE', [params[0], orgId]);
        if (!q) throw notFound('quorum');
        for (const k of Object.keys(body)) {
          if (!['name', 'member_ids', 'authorization_threshold', 'expiry_seconds'].includes(k)) throw errors.unknownField(k);
        }
        const name = Object.hasOwn(body, 'name')
          ? textField(body.name, { field: 'name', min: 1, max: 80 }) : q.name;
        const memberIds = Object.hasOwn(body, 'member_ids')
          ? await validateQuorumMembers(client, orgId, body.member_ids) : q.member_ids;
        const threshold = Object.hasOwn(body, 'authorization_threshold')
          ? validateThreshold(body.authorization_threshold, memberIds) : q.authorization_threshold;
        const expiry = Object.hasOwn(body, 'expiry_seconds')
          ? validateExpiry(body.expiry_seconds) : q.expiry_seconds;
        await client.query(
          `UPDATE key_quorums SET name = $1, member_ids = $2, authorization_threshold = $3, expiry_seconds = $4
           WHERE id = $5`,
          [name, JSON.stringify(memberIds), threshold, expiry, q.id]);
        const now = nowSeconds();
        await auditAppend(client, orgId, 'quorum.updated', actorOf(ctx), q.id, now,
          { quorum_id: q.id, name, member_ids: memberIds, authorization_threshold: threshold, expiry_seconds: expiry },
          { signed: false });
        const { rows: [fresh] } = await client.query('SELECT * FROM key_quorums WHERE id = $1', [q.id]);
        return quorumResponse(fresh);
      });
      send(200, data);
    } },

  // ---- members -------------------------------------------------------------
  { method: 'GET', pattern: /^\/api\/v1\/members$/, auth: 'readers',
    async handler(ctx, { send }) {
      const { rows } = await withClient((client) => client.query(
        'SELECT * FROM members WHERE organization_id = $1 ORDER BY email', [ctx.organization_id]));
      send(200, { members: rows.map(memberResponse) });
    } },
  { method: 'POST', pattern: /^\/api\/v1\/members$/, auth: ['owner'],
    bodyKeys: ['name', 'email', 'role', 'password'],
    async handler(ctx, { body, send }) {
      const data = await withTransaction(async (client) => {
        const orgId = ctx.organization_id;
        for (const k of Object.keys(body)) {
          if (!['name', 'email', 'role', 'password'].includes(k)) throw errors.unknownField(k);
        }
        const name = textField(body.name, { field: 'name', min: 1, max: 80 });
        if (typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim().toLowerCase())) {
          throw errors.validation('email', 'Enter a valid email address');
        }
        const email = body.email.trim().toLowerCase();
        if (!['owner', 'operator', 'approver', 'auditor'].includes(body.role)) {
          throw errors.validation('role', 'Choose a valid role');
        }
        if (typeof body.password !== 'string' || [...body.password].length < 12) {
          throw errors.validation('password', 'Enter a password of at least 12 characters');
        }
        const { rows: existing } = await client.query('SELECT id FROM members WHERE lower(email) = $1', [email]);
        if (existing.length) throw errors.conflict('MEMBER_EXISTS', 'A member with this email already exists');
        const id = newId('mem');
        const salt = newSalt();
        await client.query(
          `INSERT INTO members (id, organization_id, name, email, role, password_hash, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, orgId, name, email, body.role, `corvo1:${salt}:${hashPassword(body.password, salt)}`, nowSeconds()]);
        await auditAppend(client, orgId, 'member.added', actorOf(ctx), id, nowSeconds(),
          { member_id: id, name, email, role: body.role }, { signed: false });
        const { rows: [m] } = await client.query('SELECT * FROM members WHERE id = $1', [id]);
        return memberResponse(m);
      });
      send(201, data);
    } },
  { method: 'PATCH', pattern: /^\/api\/v1\/members\/([a-z0-9_]+)$/, auth: ['owner'], bodyKeys: ['role'],
    async handler(ctx, { params, body, send }) {
      const data = await withTransaction(async (client) => {
        const orgId = ctx.organization_id;
        const { rows: [m] } = await client.query(
          'SELECT * FROM members WHERE id = $1 AND organization_id = $2 FOR UPDATE', [params[0], orgId]);
        if (!m) throw notFound('member');
        for (const k of Object.keys(body)) {
          if (k !== 'role') throw errors.unknownField(k);
        }
        if (!['owner', 'operator', 'approver', 'auditor'].includes(body.role)) {
          throw errors.validation('role', 'Choose a valid role');
        }
        if (body.role !== 'owner' && body.role !== 'approver') {
          await refuseIfInQuorum(client, orgId, m.id);
          const { rows: owners } = await client.query(
            `SELECT id FROM members WHERE organization_id = $1 AND role = 'owner'`, [orgId]);
          if (m.role === 'owner' && owners.length <= 1) {
            throw errors.conflict('LAST_OWNER', 'The organization must keep at least one owner.');
          }
        }
        await client.query('UPDATE members SET role = $1 WHERE id = $2', [body.role, m.id]);
        const now = nowSeconds();
        await auditAppend(client, orgId, 'member.updated', actorOf(ctx), m.id, now,
          { member_id: m.id, role: body.role }, { signed: false });
        const { rows: [fresh] } = await client.query('SELECT * FROM members WHERE id = $1', [m.id]);
        return memberResponse(fresh);
      });
      send(200, data);
    } },
  { method: 'DELETE', pattern: /^\/api\/v1\/members\/([a-z0-9_]+)$/, auth: ['owner'],
    async handler(ctx, { params, send }) {
      await withTransaction(async (client) => {
        const orgId = ctx.organization_id;
        const { rows: [m] } = await client.query(
          'SELECT * FROM members WHERE id = $1 AND organization_id = $2 FOR UPDATE', [params[0], orgId]);
        if (!m) throw notFound('member');
        await refuseIfInQuorum(client, orgId, m.id);
        const { rows: owners } = await client.query(
          `SELECT id FROM members WHERE organization_id = $1 AND role = 'owner'`, [orgId]);
        if (m.role === 'owner' && owners.length <= 1) {
          throw errors.conflict('LAST_OWNER', 'The organization must keep at least one owner.');
        }
        const now = nowSeconds();
        await client.query('DELETE FROM sessions WHERE member_id = $1', [m.id]);
        const { rows: keys } = await client.query(
          `SELECT id, prefix FROM api_keys WHERE created_by = $1 AND revoked_at IS NULL ORDER BY created_at`, [m.id]);
        for (const k of keys) {
          await client.query('UPDATE api_keys SET revoked_at = $1 WHERE id = $2', [now, k.id]);
          await auditAppend(client, orgId, 'api_key.revoked', actorOf(ctx), k.id, now,
            { api_key_id: k.id, prefix: k.prefix }, { signed: false });
        }
        await client.query('DELETE FROM members WHERE id = $1', [m.id]);
        await auditAppend(client, orgId, 'member.removed', actorOf(ctx), m.id, now,
          { member_id: m.id }, { signed: false });
      });
      send(200, { removed: true });
    } },

  // ---- api keys --------------------------------------------------------------
  { method: 'GET', pattern: /^\/api\/v1\/api-keys$/, auth: ['owner', 'auditor'],
    async handler(ctx, { send }) {
      const { rows } = await withClient((client) => client.query(
        'SELECT * FROM api_keys WHERE organization_id = $1 ORDER BY created_at', [ctx.organization_id]));
      send(200, { api_keys: rows.map(apiKeyResponse) });
    } },
  { method: 'POST', pattern: /^\/api\/v1\/api-keys$/, auth: ['owner'], bodyKeys: ['name', 'role'],
    async handler(ctx, { body, send }) {
      const data = await withTransaction(async (client) => {
        const orgId = ctx.organization_id;
        for (const k of Object.keys(body)) {
          if (!['name', 'role'].includes(k)) throw errors.unknownField(k);
        }
        const name = textField(body.name, { field: 'name', min: 1, max: 60 });
        if (body.role !== 'operator' && body.role !== 'auditor') {
          throw errors.validation('role', 'Choose operator or auditor');
        }
        const secret = `cvo_${newToken().slice(0, 40).replace(/[^a-f0-9]/g, '0').padEnd(40, '0')}`;
        const prefix = secret.slice(0, 12);
        const id = newId('key');
        const now = nowSeconds();
        await client.query(
          `INSERT INTO api_keys (id, organization_id, name, role, prefix, secret_hash, created_by, created_at, revoked_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL)`,
          [id, orgId, name, body.role, prefix, sha256Hex(secret), ctx.member.id, now]);
        await auditAppend(client, orgId, 'api_key.created', actorOf(ctx), id, now,
          { api_key_id: id, name, role: body.role, prefix }, { signed: false });
        return {
          id, name, role: body.role, prefix, secret,
          created_by: ctx.member.id, created_at: formatTs(now),
        };
      });
      send(201, data);
    } },
  { method: 'DELETE', pattern: /^\/api\/v1\/api-keys\/([a-z0-9_]+)$/, auth: ['owner'],
    async handler(ctx, { params, send }) {
      await withTransaction(async (client) => {
        const orgId = ctx.organization_id;
        const { rows: [k] } = await client.query(
          'SELECT * FROM api_keys WHERE id = $1 AND organization_id = $2 FOR UPDATE', [params[0], orgId]);
        if (!k) throw notFound('apiKey');
        if (!k.revoked_at) {
          const now = nowSeconds();
          await client.query('UPDATE api_keys SET revoked_at = $1 WHERE id = $2', [now, k.id]);
          await auditAppend(client, orgId, 'api_key.revoked', actorOf(ctx), k.id, now,
            { api_key_id: k.id, prefix: k.prefix }, { signed: false });
        }
      });
      send(200, { revoked: true });
    } },

  // ---- audit and signed events ------------------------------------------------
  { method: 'GET', pattern: /^\/api\/v1\/audit$/, auth: ['owner', 'auditor'],
    async handler(ctx, { query, send }) {
      const afterRaw = query.get('after_seq');
      const limitRaw = query.get('limit');
      let afterSeq = 0;
      if (afterRaw !== null && afterRaw !== undefined && afterRaw !== '') {
        if (!/^\d+$/.test(afterRaw)) throw errors.validation('after_seq', 'Choose a valid sequence');
        afterSeq = Number(afterRaw);
      }
      let limit = 100;
      if (limitRaw !== null && limitRaw !== undefined && limitRaw !== '') {
        if (!/^\d+$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > 500) {
          throw errors.validation('limit', 'Choose a limit between 1 and 500');
        }
        limit = Number(limitRaw);
      }
      const { rows } = await withClient((client) => client.query(
        `SELECT * FROM audit_events WHERE organization_id = $1 AND seq > $2 ORDER BY seq LIMIT ${limit}`,
        [ctx.organization_id, afterSeq]));
      send(200, { events: rows.map((r) => ({
        seq: Number(r.seq), type: r.type, actor: r.actor, subject_id: r.subject_id,
        at: formatTs(r.at), data: r.data, prev_hash: r.prev_hash, hash: r.hash,
      })) });
    } },
  { method: 'GET', pattern: /^\/api\/v1\/audit\/verify$/, auth: ['owner', 'auditor'],
    async handler(ctx, { send }) {
      const result = await withClient((client) => verifyChain(client, ctx.organization_id));
      send(200, result);
    } },
  { method: 'GET', pattern: /^\/api\/v1\/webhooks\/secret$/, auth: ['owner'],
    async handler(ctx, { send }) {
      const { rows } = await withClient((client) =>
        client.query('SELECT webhook_secret FROM organizations WHERE id = $1', [ctx.organization_id]));
      send(200, { secret: rows[0].webhook_secret });
    } },
  { method: 'POST', pattern: /^\/api\/v1\/webhooks\/secret\/rotate$/, auth: ['owner'],
    async handler(ctx, { send }) {
      const secret = await withTransaction(async (client) => {
        const orgId = ctx.organization_id;
        await client.query('SELECT id FROM organizations WHERE id = $1 FOR UPDATE', [orgId]);
        const secret = newWebhookSecret();
        await client.query('UPDATE organizations SET webhook_secret = $1 WHERE id = $2', [secret, orgId]);
        await auditAppend(client, orgId, 'webhook_secret.rotated', actorOf(ctx), orgId, nowSeconds(),
          { organization_id: orgId }, { signed: false });
        return secret;
      });
      send(200, { secret });
    } },
  { method: 'GET', pattern: /^\/api\/v1\/webhooks\/events$/, auth: ['owner', 'auditor'],
    async handler(ctx, { query, send }) {
      const afterRaw = query.get('after_seq');
      const limitRaw = query.get('limit');
      let afterSeq = 0;
      if (afterRaw !== null && afterRaw !== undefined && afterRaw !== '') {
        if (!/^\d+$/.test(afterRaw)) throw errors.validation('after_seq', 'Choose a valid sequence');
        afterSeq = Number(afterRaw);
      }
      let limit = 100;
      if (limitRaw !== null && limitRaw !== undefined && limitRaw !== '') {
        if (!/^\d+$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > 500) {
          throw errors.validation('limit', 'Choose a limit between 1 and 500');
        }
        limit = Number(limitRaw);
      }
      const { rows } = await withClient((client) => client.query(
        `SELECT * FROM webhook_events WHERE organization_id = $1 AND seq > $2 ORDER BY seq LIMIT ${limit}`,
        [ctx.organization_id, afterSeq]));
      send(200, { events: rows.map((r) => ({
        id: r.id, seq: Number(r.seq), type: r.type, created_at: formatTs(r.created_at),
        timestamp: Number(r.timestamp), body: r.body, signature: r.signature,
      })) });
    } },
];

async function createQuorum(ctx, client, body) {
  const orgId = ctx.organization_id;
  for (const k of Object.keys(body)) {
    if (!['name', 'member_ids', 'authorization_threshold', 'expiry_seconds'].includes(k)) throw errors.unknownField(k);
  }
  const name = textField(body.name, { field: 'name', min: 1, max: 80 });
  const memberIds = await validateQuorumMembers(client, orgId, body.member_ids);
  const threshold = validateThreshold(body.authorization_threshold, memberIds);
  const expiry = validateExpiry(body.expiry_seconds);
  const id = newId('kq');
  const now = nowSeconds();
  await client.query(
    `INSERT INTO key_quorums (id, organization_id, name, member_ids, authorization_threshold, expiry_seconds, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, orgId, name, JSON.stringify(memberIds), threshold, expiry, now]);
  await auditAppend(client, orgId, 'quorum.created', actorOf(ctx), id, now,
    { quorum_id: id, name, member_ids: memberIds, authorization_threshold: threshold, expiry_seconds: expiry },
    { signed: false });
  const { rows: [q] } = await client.query('SELECT * FROM key_quorums WHERE id = $1', [id]);
  return quorumResponse(q);
}

async function validateQuorumMembers(client, orgId, memberIds) {
  if (!Array.isArray(memberIds) || memberIds.length < 1 || memberIds.length > 10
    || !memberIds.every((id) => typeof id === 'string')) {
    throw new ApiError(422, 'INVALID_QUORUM_MEMBER', 'Choose between 1 and 10 members');
  }
  const seen = new Set();
  for (const id of memberIds) {
    const { rows } = await client.query(
      'SELECT role FROM members WHERE id = $1 AND organization_id = $2', [id, orgId]);
    if (!rows.length || !QUORUM_ROLES.includes(rows[0].role) || seen.has(id)) {
      throw new ApiError(422, 'INVALID_QUORUM_MEMBER', 'Quorum members must be owners or approvers of this organization');
    }
    seen.add(id);
  }
  return memberIds;
}

function validateThreshold(threshold, memberIds) {
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > memberIds.length) {
    throw new ApiError(422, 'INVALID_THRESHOLD', 'The threshold runs from 1 to the member count');
  }
  return threshold;
}

function validateExpiry(expiry) {
  if (!Number.isInteger(expiry) || expiry < 60 || expiry > 2592000) {
    throw errors.validation('expiry_seconds', 'Choose an expiry between 60 and 2592000 seconds');
  }
  return expiry;
}

async function refuseIfInQuorum(client, orgId, memberId) {
  const { rows } = await client.query(
    'SELECT id, member_ids FROM key_quorums WHERE organization_id = $1', [orgId]);
  for (const q of rows) {
    if ((q.member_ids || []).includes(memberId)) {
      throw errors.conflict('MEMBER_IN_QUORUM', 'This member sits in a key quorum.');
    }
  }
}
