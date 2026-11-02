import { randomUUID } from 'node:crypto';
import { type Role, ROLES, codePointLength, compareByName } from '../../shared/domain.ts';
import { announceSessionEnded, appendAudit, recheckAuthority, reserveSeq } from '../commit.ts';
import { hashPassword } from '../auth.ts';
import { query, withCommitOrder, withReadTransaction } from '../db.ts';
import { type StoredAuditRow, checkChain } from '../domain/audit.ts';
import { bus } from '../events.ts';
import type { Ctx, Reply } from '../http/context.ts';
import { errors } from '../http/errors.ts';
import type { Router } from '../http/router.ts';
import { graphWrite } from './graphWrite.ts';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
}

interface AuditRowRecord extends StoredAuditRow {
  actor_name: string;
}

function auditRowBody(row: AuditRowRecord): unknown {
  return {
    id: `audit-${row.seq}`,
    seq: row.seq,
    at: row.at,
    actor: { id: row.actor_id, name: row.actor_name },
    actor_role: row.actor_role,
    action: row.action,
    target: { type: row.target_type, id: row.target_id },
    before: row.before,
    after: row.after,
    prev_hash: row.prev_hash,
    hash: row.hash,
  };
}

async function readAuditRows(beforeSeq: number | null, limit: number): Promise<AuditRowRecord[]> {
  const result = await query<AuditRowRecord & { seq: string }>(
    `SELECT a.seq, a.at, a.actor_id, a.actor_role, a.action, a.target_type, a.target_id,
            a.before, a.after, a.prev_hash, a.hash, coalesce(u.name, a.actor_id) AS actor_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      WHERE ($1::bigint IS NULL OR a.seq < $1)
      ORDER BY a.seq DESC
      LIMIT $2`,
    [beforeSeq, limit],
  );
  return result.rows.map((row) => ({ ...row, seq: Number(row.seq) }));
}

export function registerAdminRoutes(router: Router): void {
  router.add('GET', '/api/users', async (ctx: Ctx): Promise<Reply> => {
    await ctx.requireCapability('admin');
    const result = await query<UserRow>('SELECT id, name, email, role FROM users');
    return { status: 200, json: { users: result.rows.sort(compareByName) } };
  });

  router.add('POST', '/api/users', async (ctx: Ctx): Promise<Reply> => {
    const body = ctx.json();
    return graphWrite(
      ctx,
      'admin',
      async () => undefined,
      async ({ client, seq }) => {
        const rawName = typeof body.name === 'string' ? body.name : '';
        const name = rawName.trim();
        const email = typeof body.email === 'string' ? body.email : '';
        const role = body.role;
        const password = typeof body.password === 'string' ? body.password : '';
        const existing = await client.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email]);
        if ((existing.rowCount ?? 0) > 0) {
          throw errors.conflict('email_exists', 'That email is already in use.');
        }
        const fields: Record<string, string> = {};
        const nameLength = codePointLength(name);
        if (nameLength < 1 || nameLength > 80 || CONTROL_CHARACTERS.test(name)) {
          fields.name = 'Use 1 to 80 characters without control characters.';
        }
        if (!EMAIL_PATTERN.test(email)) fields.email = 'Enter a valid email address.';
        if (typeof role !== 'string' || !ROLES.includes(role as Role)) {
          fields.role = 'Role must be Admin, Steward, Analyst or Viewer.';
        }
        if (codePointLength(password) < 12) fields.password = 'Use at least 12 characters.';
        if (Object.keys(fields).length > 0) throw errors.validation(fields);

        const userId = `u-${randomUUID()}`;
        await client.query(
          'INSERT INTO users (id, name, email, role, password_hash, created_seq) VALUES ($1,$2,$3,$4,$5,$6)',
          [userId, name, email, role, hashPassword(password), seq],
        );
        await client.query('INSERT INTO user_role_history (user_id, from_seq, role) VALUES ($1,$2,$3)', [
          userId,
          seq,
          role,
        ]);
        return {
          action: 'user.create',
          targetType: 'user',
          targetId: userId,
          auditBefore: null,
          auditAfter: () => ({ name, email, role: role as string }),
          status: 201,
          json: undefined,
          body: () => ({ user: { id: userId, name, email, role: role as Role } }),
        };
      },
    );
  });

  router.add('PATCH', '/api/users/:id', async (ctx: Ctx): Promise<Reply> => {
    const actor = await ctx.requireActor();
    const userId = ctx.params.id;
    const body = ctx.json();
    const hasRole = body.role !== undefined;
    const hasPassword = body.password !== undefined;
    return withCommitOrder(async (client) => {
      const target = await client.query<UserRow>('SELECT id, name, email, role FROM users WHERE id = $1', [
        userId,
      ]);
      const user = target.rows[0];
      if (!user) throw errors.notFound();
      const current = await recheckAuthority(client, actor, 'admin');
      if (hasRole && hasPassword) {
        throw errors.validation({ role: 'Send either a role or a password.' });
      }
      if (hasRole) {
        if (userId === current.userId) {
          throw errors.conflict('own_role', "You can't change your own role.");
        }
        const role = body.role;
        if (typeof role !== 'string' || !ROLES.includes(role as Role)) {
          throw errors.validation({ role: 'Role must be Admin, Steward, Analyst or Viewer.' });
        }
        if (role === user.role) {
          return { status: 200, json: { user: { ...user } } };
        }
        const seq = await reserveSeq(client);
        await client.query('UPDATE users SET role = $2 WHERE id = $1', [userId, role]);
        await client.query('INSERT INTO user_role_history (user_id, from_seq, role) VALUES ($1,$2,$3)', [
          userId,
          seq,
          role,
        ]);
        await appendAudit(client, seq, {
          actorId: current.userId,
          actorRole: current.role,
          action: 'user.role_change',
          targetType: 'user',
          targetId: userId,
          before: { role: user.role },
          after: { role: role as string },
        });
        return { status: 200, json: { user: { ...user, role: role as Role } } };
      }
      if (hasPassword) {
        if (userId === current.userId) {
          throw errors.conflict('own_password', "You can't reset your own password here.");
        }
        const password = typeof body.password === 'string' ? body.password : '';
        if (codePointLength(password) < 12) {
          throw errors.validation({ password: 'Use at least 12 characters.' });
        }
        const seq = await reserveSeq(client);
        await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [
          userId,
          hashPassword(password),
        ]);
        const ended = await client.query<{ token_hash: string }>(
          'DELETE FROM sessions WHERE user_id = $1 RETURNING token_hash',
          [userId],
        );
        const tokenHashes = ended.rows.map((row) => row.token_hash);
        await announceSessionEnded(client, tokenHashes);
        await appendAudit(client, seq, {
          actorId: current.userId,
          actorRole: current.role,
          action: 'user.password_reset',
          targetType: 'user',
          targetId: userId,
          before: null,
          after: { sessions_ended: tokenHashes.length },
        });
        for (const tokenHash of tokenHashes) bus.publishSessionEnded(tokenHash);
        return { status: 200, json: { user: { ...user }, sessions_ended: tokenHashes.length } };
      }
      throw errors.validation({ role: 'Send either a role or a password.' });
    });
  });

  router.add('GET', '/api/audit', async (ctx: Ctx): Promise<Reply> => {
    await ctx.requireCapability('admin');
    const rawLimit = ctx.queryParam('limit');
    const rawBefore = ctx.queryParam('before_seq');
    const fields: Record<string, string> = {};
    const limit = rawLimit === null ? 100 : Number(rawLimit);
    if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || limit < 1 || limit > 500)) {
      fields.limit = 'Use a whole number from 1 to 500.';
    }
    const beforeSeq = rawBefore === null ? null : Number(rawBefore);
    if (rawBefore !== null && (!/^\d+$/.test(rawBefore) || beforeSeq === 0)) {
      fields.before_seq = 'Use a positive whole number.';
    }
    if (Object.keys(fields).length > 0) throw errors.validation(fields);

    const rows = await readAuditRows(beforeSeq, limit);
    const total = await query<{ count: string }>('SELECT count(*) AS count FROM audit_log');
    const last = rows[rows.length - 1];
    return {
      status: 200,
      json: {
        rows: rows.map(auditRowBody),
        total: Number(total.rows[0].count),
        next_before_seq: last === undefined || last.seq === 1 ? null : last.seq,
      },
    };
  });

  router.add('GET', '/api/audit/chain', async (ctx: Ctx): Promise<Reply> => {
    await ctx.requireCapability('admin');
    return withReadTransaction(async (client) => {
      const result = await client.query<StoredAuditRow & { seq: string }>(
        `SELECT seq, at, actor_id, actor_role, action, target_type, target_id, before, after,
                prev_hash, hash
           FROM audit_log ORDER BY seq ASC`,
      );
      const rows = result.rows.map((row) => ({ ...row, seq: Number(row.seq) }));
      return { status: 200, json: checkChain(rows) };
    });
  });

  for (const [method, path] of [
    ['PUT', '/api/audit'],
    ['PATCH', '/api/audit'],
    ['DELETE', '/api/audit'],
    ['POST', '/api/audit'],
    ['PUT', '/api/audit/chain'],
    ['PATCH', '/api/audit/chain'],
    ['DELETE', '/api/audit/chain'],
    ['POST', '/api/audit/chain'],
    ['PUT', '/api/audit/:id'],
    ['PATCH', '/api/audit/:id'],
    ['DELETE', '/api/audit/:id'],
  ] as const) {
    router.add(method, path, async (ctx: Ctx): Promise<Reply> => {
      await ctx.requireActor();
      throw errors.methodNotAllowed();
    });
  }
}
