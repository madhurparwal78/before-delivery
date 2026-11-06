import { lockOrganization, query, withTransaction } from '../db/pool.js';
import { apiKeyShape, getMember, getQuorum, listApiKeys, listMembers, listQuorums, memberShape, quorumShape } from '../db/repo.js';
import { appendEvent, verifyChain } from '../domain/audit.js';
import { hashPassword, hashSecret } from '../domain/credentials.js';
import { newApiKeySecret, newId, newWebhookSecret } from '../domain/ids.js';
import { codePointLength, normaliseText } from '../domain/text.js';
import { formatTimestamp } from '../domain/time.js';
import { ApiError } from '../http/errors.js';
import { ensureKnownFields, requireEnum, requireInteger, requireText, validationError } from '../http/validate.js';

export const MEMBER_ROLES = ['owner', 'operator', 'approver', 'auditor'];
const QUORUM_ELIGIBLE_ROLES = ['owner', 'approver'];

export async function listQuorumsRoute(ctx) {
  const rows = await listQuorums(null, ctx.organization.id);
  return { status: 200, data: { quorums: rows.map(quorumShape) } };
}

async function readQuorumMembers(client, organizationId, memberIds) {
  if (!Array.isArray(memberIds)) throw validationError('member_ids');
  if (memberIds.length < 1 || memberIds.length > 10) throw new ApiError('INVALID_QUORUM_MEMBER');
  if (new Set(memberIds).size !== memberIds.length) throw new ApiError('INVALID_QUORUM_MEMBER');
  for (const id of memberIds) {
    if (typeof id !== 'string') throw new ApiError('INVALID_QUORUM_MEMBER');
    const member = await getMember(client, organizationId, id);
    if (!member || !QUORUM_ELIGIBLE_ROLES.includes(member.role)) throw new ApiError('INVALID_QUORUM_MEMBER');
  }
  return memberIds;
}

export async function createQuorum(ctx) {
  ensureKnownFields(ctx.body, { name: true, member_ids: true, authorization_threshold: true, expiry_seconds: true });
  const name = requireText(ctx.body.name, 'quorumName', 'name', { trim: true });
  const quorum = await withTransaction(async (client) => {
    const organization = await lockOrganization(client, ctx.organization.id);
    const memberIds = await readQuorumMembers(client, organization.id, ctx.body.member_ids);
    const threshold = ctx.body.authorization_threshold;
    if (typeof threshold !== 'number' || !Number.isInteger(threshold) || threshold < 1 || threshold > memberIds.length) {
      throw new ApiError('INVALID_THRESHOLD');
    }
    const expirySeconds = requireInteger(ctx.body.expiry_seconds, 'expiry_seconds', { min: 60, max: 2592000 });

    const id = newId('kq_');
    await client.query(
      `INSERT INTO key_quorums (id, organization_id, name, member_ids, authorization_threshold, expiry_seconds, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, organization.id, name, JSON.stringify(memberIds), threshold, expirySeconds, organization.now]
    );
    await appendEvent(client, {
      organizationId: organization.id,
      webhookSecret: organization.webhook_secret,
      type: 'quorum.created',
      actor: ctx.principal.actor,
      subjectId: id,
      at: organization.now,
      data: { quorum_id: id, name, member_ids: memberIds, authorization_threshold: threshold, expiry_seconds: expirySeconds }
    });
    return getQuorum(client, organization.id, id);
  });
  return { status: 201, data: quorumShape(quorum) };
}

export async function patchQuorum(ctx) {
  const quorum = await withTransaction(async (client) => {
    const organization = await lockOrganization(client, ctx.organization.id);
    const current = await getQuorum(client, organization.id, ctx.params.id);
    if (!current) throw new ApiError('QUORUM_NOT_FOUND');
    ensureKnownFields(ctx.body, { name: true, member_ids: true, authorization_threshold: true, expiry_seconds: true });

    const name = ctx.body.name === undefined ? current.name : requireText(ctx.body.name, 'quorumName', 'name', { trim: true });
    const memberIds = ctx.body.member_ids === undefined
      ? current.member_ids
      : await readQuorumMembers(client, organization.id, ctx.body.member_ids);
    const threshold = ctx.body.authorization_threshold === undefined ? current.authorization_threshold : ctx.body.authorization_threshold;
    if (typeof threshold !== 'number' || !Number.isInteger(threshold) || threshold < 1 || threshold > memberIds.length) {
      throw new ApiError('INVALID_THRESHOLD');
    }
    const expirySeconds = ctx.body.expiry_seconds === undefined
      ? current.expiry_seconds
      : requireInteger(ctx.body.expiry_seconds, 'expiry_seconds', { min: 60, max: 2592000 });

    await client.query(
      'UPDATE key_quorums SET name = $2, member_ids = $3, authorization_threshold = $4, expiry_seconds = $5 WHERE id = $1',
      [current.id, name, JSON.stringify(memberIds), threshold, expirySeconds]
    );
    await appendEvent(client, {
      organizationId: organization.id,
      webhookSecret: organization.webhook_secret,
      type: 'quorum.updated',
      actor: ctx.principal.actor,
      subjectId: current.id,
      at: organization.now,
      data: { quorum_id: current.id, name, member_ids: memberIds, authorization_threshold: threshold, expiry_seconds: expirySeconds }
    });
    return getQuorum(client, organization.id, current.id);
  });
  return { status: 200, data: quorumShape(quorum) };
}

export async function listMembersRoute(ctx) {
  const rows = await listMembers(null, ctx.organization.id);
  return { status: 200, data: { members: rows.map(memberShape) } };
}

export async function createMember(ctx) {
  ensureKnownFields(ctx.body, { name: true, email: true, role: true, password: true });
  const name = requireText(ctx.body.name, 'memberName', 'name', { trim: true });
  if (typeof ctx.body.email !== 'string') throw validationError('email');
  const email = normaliseText(ctx.body.email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email) || email.length > 254) throw validationError('email');
  const role = requireEnum(ctx.body.role, MEMBER_ROLES, 'role');
  if (typeof ctx.body.password !== 'string' || codePointLength(normaliseText(ctx.body.password)) < 12) {
    throw validationError('password');
  }

  const member = await withTransaction(async (client) => {
    const organization = await lockOrganization(client, ctx.organization.id);
    const existing = await client.query('SELECT id FROM members WHERE email = $1', [email]);
    if (existing.rows.length) throw new ApiError('MEMBER_EXISTS');
    const id = newId('mem_');
    await client.query(
      `INSERT INTO members (id, organization_id, name, email, role, password_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, organization.id, name, email, role, hashPassword(ctx.body.password), organization.now]
    );
    await appendEvent(client, {
      organizationId: organization.id,
      webhookSecret: organization.webhook_secret,
      type: 'member.added',
      actor: ctx.principal.actor,
      subjectId: id,
      at: organization.now,
      data: { member_id: id, name, email, role }
    });
    return getMember(client, organization.id, id);
  });
  return { status: 201, data: memberShape(member) };
}

async function sitsInQuorum(client, organizationId, memberId) {
  const result = await client.query(
    'SELECT id FROM key_quorums WHERE organization_id = $1 AND member_ids @> to_jsonb($2::text)',
    [organizationId, memberId]
  );
  return result.rows.length > 0;
}

async function otherOwnerExists(client, organizationId, memberId) {
  const result = await client.query(
    'SELECT id FROM members WHERE organization_id = $1 AND role = $2 AND id <> $3',
    [organizationId, 'owner', memberId]
  );
  return result.rows.length > 0;
}

export async function patchMember(ctx) {
  const member = await withTransaction(async (client) => {
    const organization = await lockOrganization(client, ctx.organization.id);
    const current = await getMember(client, organization.id, ctx.params.id);
    if (!current) throw new ApiError('MEMBER_NOT_FOUND');
    ensureKnownFields(ctx.body, { role: true });
    const role = requireEnum(ctx.body.role, MEMBER_ROLES, 'role');

    if (!QUORUM_ELIGIBLE_ROLES.includes(role) && await sitsInQuorum(client, organization.id, current.id)) {
      throw new ApiError('MEMBER_IN_QUORUM');
    }
    if (current.role === 'owner' && role !== 'owner' && !await otherOwnerExists(client, organization.id, current.id)) {
      throw new ApiError('LAST_OWNER');
    }

    await client.query('UPDATE members SET role = $2 WHERE id = $1', [current.id, role]);
    await appendEvent(client, {
      organizationId: organization.id,
      webhookSecret: organization.webhook_secret,
      type: 'member.updated',
      actor: ctx.principal.actor,
      subjectId: current.id,
      at: organization.now,
      data: { member_id: current.id, role }
    });
    return getMember(client, organization.id, current.id);
  });
  return { status: 200, data: memberShape(member) };
}

export async function removeMember(ctx) {
  await withTransaction(async (client) => {
    const organization = await lockOrganization(client, ctx.organization.id);
    const current = await getMember(client, organization.id, ctx.params.id);
    if (!current) throw new ApiError('MEMBER_NOT_FOUND');

    if (await sitsInQuorum(client, organization.id, current.id)) throw new ApiError('MEMBER_IN_QUORUM');
    if (current.role === 'owner' && !await otherOwnerExists(client, organization.id, current.id)) {
      throw new ApiError('LAST_OWNER');
    }

    const keys = await client.query(
      'SELECT id, prefix FROM api_keys WHERE organization_id = $1 AND created_by = $2 AND revoked_at IS NULL ORDER BY created_at, id',
      [organization.id, current.id]
    );
    for (const key of keys.rows) {
      await client.query('UPDATE api_keys SET revoked_at = $2 WHERE id = $1', [key.id, organization.now]);
      await appendEvent(client, {
        organizationId: organization.id,
        webhookSecret: organization.webhook_secret,
        type: 'api_key.revoked',
        actor: ctx.principal.actor,
        subjectId: key.id,
        at: organization.now,
        data: { api_key_id: key.id, prefix: key.prefix }
      });
    }
    await client.query('DELETE FROM members WHERE id = $1', [current.id]);
    await appendEvent(client, {
      organizationId: organization.id,
      webhookSecret: organization.webhook_secret,
      type: 'member.removed',
      actor: ctx.principal.actor,
      subjectId: current.id,
      at: organization.now,
      data: { member_id: current.id }
    });
  });
  return { status: 200, data: { removed: true } };
}

export async function listApiKeysRoute(ctx) {
  const rows = await listApiKeys(null, ctx.organization.id);
  return { status: 200, data: { api_keys: rows.map(apiKeyShape) } };
}

export async function createApiKey(ctx) {
  ensureKnownFields(ctx.body, { name: true, role: true });
  const name = requireText(ctx.body.name, 'apiKeyName', 'name', { trim: true });
  const role = requireEnum(ctx.body.role, ['operator', 'auditor'], 'role');
  const secret = newApiKeySecret();

  const key = await withTransaction(async (client) => {
    const organization = await lockOrganization(client, ctx.organization.id);
    const id = newId('key_');
    await client.query(
      `INSERT INTO api_keys (id, organization_id, name, role, prefix, secret_hash, created_by, created_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)`,
      [id, organization.id, name, role, secret.slice(0, 12), hashSecret(secret), ctx.principal.member.id, organization.now]
    );
    await appendEvent(client, {
      organizationId: organization.id,
      webhookSecret: organization.webhook_secret,
      type: 'api_key.created',
      actor: ctx.principal.actor,
      subjectId: id,
      at: organization.now,
      data: { api_key_id: id, name, role, prefix: secret.slice(0, 12) }
    });
    const rows = await listApiKeys(client, organization.id);
    return rows.find((row) => row.id === id);
  });
  return {
    status: 201,
    data: {
      id: key.id,
      name: key.name,
      role: key.role,
      prefix: key.prefix,
      secret,
      created_by: key.created_by,
      created_at: formatTimestamp(key.created_at)
    }
  };
}

export async function revokeApiKey(ctx) {
  await withTransaction(async (client) => {
    const organization = await lockOrganization(client, ctx.organization.id);
    const existing = await client.query(
      'SELECT id, prefix FROM api_keys WHERE id = $1 AND organization_id = $2 AND revoked_at IS NULL FOR UPDATE',
      [ctx.params.id, organization.id]
    );
    if (!existing.rows.length) throw new ApiError('API_KEY_NOT_FOUND');
    const key = existing.rows[0];
    await client.query('UPDATE api_keys SET revoked_at = $2 WHERE id = $1', [key.id, organization.now]);
    await appendEvent(client, {
      organizationId: organization.id,
      webhookSecret: organization.webhook_secret,
      type: 'api_key.revoked',
      actor: ctx.principal.actor,
      subjectId: key.id,
      at: organization.now,
      data: { api_key_id: key.id, prefix: key.prefix }
    });
  });
  return { status: 200, data: { revoked: true } };
}

function readSeqWindow(ctx) {
  const afterSeqRaw = ctx.query.get('after_seq');
  if (afterSeqRaw !== null && !/^[0-9]+$/.test(afterSeqRaw)) throw validationError('after_seq');
  const limitRaw = ctx.query.get('limit');
  if (limitRaw !== null && !/^[0-9]+$/.test(limitRaw)) throw validationError('limit');
  const limit = limitRaw === null ? 100 : Number.parseInt(limitRaw, 10);
  if (limit < 1 || limit > 500) throw validationError('limit');
  return { afterSeq: afterSeqRaw === null ? 0 : Number.parseInt(afterSeqRaw, 10), limit };
}

export async function listAuditEvents(ctx) {
  const { afterSeq, limit } = readSeqWindow(ctx);
  const result = await query(
    `SELECT seq, type, actor, subject_id, at, data, prev_hash, hash FROM audit_events
      WHERE organization_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
    [ctx.organization.id, afterSeq, limit]
  );
  return {
    status: 200,
    data: {
      events: result.rows.map((row) => ({
        seq: Number(row.seq),
        type: row.type,
        actor: row.actor,
        subject_id: row.subject_id ?? null,
        at: formatTimestamp(row.at),
        data: row.data,
        prev_hash: row.prev_hash,
        hash: row.hash
      }))
    }
  };
}

export async function verifyAuditChain(ctx) {
  const result = await query(
    'SELECT seq, type, actor, subject_id, at, data, prev_hash, hash FROM audit_events WHERE organization_id = $1 ORDER BY seq',
    [ctx.organization.id]
  );
  return { status: 200, data: verifyChain(result.rows) };
}

export async function readWebhookSecret(ctx) {
  const result = await query('SELECT webhook_secret FROM organizations WHERE id = $1', [ctx.organization.id]);
  return { status: 200, data: { secret: result.rows[0].webhook_secret } };
}

export async function rotateWebhookSecret(ctx) {
  const secret = newWebhookSecret();
  await withTransaction(async (client) => {
    const organization = await lockOrganization(client, ctx.organization.id);
    await client.query('UPDATE organizations SET webhook_secret = $2 WHERE id = $1', [organization.id, secret]);
    await appendEvent(client, {
      organizationId: organization.id,
      webhookSecret: organization.webhook_secret,
      type: 'webhook_secret.rotated',
      actor: ctx.principal.actor,
      subjectId: organization.id,
      at: organization.now,
      data: { organization_id: organization.id }
    });
  });
  return { status: 200, data: { secret } };
}

export async function listWebhookEvents(ctx) {
  const { afterSeq, limit } = readSeqWindow(ctx);
  const result = await query(
    `SELECT id, seq, type, created_at, timestamp, body, signature FROM webhook_events
      WHERE organization_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
    [ctx.organization.id, afterSeq, limit]
  );
  return {
    status: 200,
    data: {
      events: result.rows.map((row) => ({
        id: row.id,
        seq: Number(row.seq),
        type: row.type,
        created_at: formatTimestamp(row.created_at),
        timestamp: Number(row.timestamp),
        body: row.body,
        signature: row.signature
      }))
    }
  };
}
