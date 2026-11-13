import { randomUUID } from 'node:crypto';
import { pool, withTransaction, type Queryable } from '../../../db/pool.js';
import { appendAuditEntry } from '../../../domain/audit.js';
import { normaliseEmail } from '../../../domain/candidate.js';
import { grantStatus, isStaffRole, type StaffRole } from '../../../domain/roles.js';
import { voidLapsedSignoffs } from '../../../domain/releaserecord.js';
import { errors } from '../../errors.js';
import { jsonReply } from '../../reply.js';
import { route } from '../../server.js';
import { consoleRead, consoleWrite, etag, ifMatch, objectBody, onlyKeys, requireRole } from './guard.js';

type GrantRow = {
  id: string;
  staff_email: string;
  role: StaffRole;
  granted_by: string;
  granted_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  revoked_by: string | null;
  version: number;
};

const GRANT_COLUMNS = `id, staff_email, role, granted_by, granted_at, expires_at,
  revoked_at, revoked_by, version`;

function grantObject(row: GrantRow): Record<string, unknown> {
  return {
    id: row.id,
    staff_email: row.staff_email,
    role: row.role,
    granted_by: row.granted_by,
    granted_at: row.granted_at.toISOString(),
    expires_at: row.expires_at.toISOString(),
    revoked_at: row.revoked_at === null ? null : row.revoked_at.toISOString(),
    revoked_by: row.revoked_by,
    status: grantStatus(row),
    version: row.version,
  };
}

async function loadGrant(tx: Queryable, id: string): Promise<GrantRow | undefined> {
  const result = await tx.query<GrantRow>(
    `SELECT ${GRANT_COLUMNS} FROM role_grants WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

export function registerConsoleGrantsApi(): void {
  route('GET', '/api/console/grants', null, async (ctx) =>
    consoleRead(ctx, async (session) => {
      requireRole(session, 'administrator');
      const result = await pool.query<GrantRow>(
        `SELECT ${GRANT_COLUMNS} FROM role_grants ORDER BY granted_at DESC, id`,
      );
      return jsonReply(200, { grants: result.rows.map(grantObject) });
    }),
  );

  route('POST', '/api/console/grants', 'console_writes', async (ctx) =>
    consoleWrite(ctx, async (session) => {
      requireRole(session, 'administrator');
      const payload = objectBody(ctx.json());
      onlyKeys(payload, ['staff_email', 'role', 'expires_at']);

      const email =
        typeof payload.staff_email === 'string' ? normaliseEmail(payload.staff_email) : '';
      const role = typeof payload.role === 'string' ? payload.role : '';
      const expiresRaw = typeof payload.expires_at === 'string' ? payload.expires_at : '';
      const expiresAt = new Date(expiresRaw);
      const fields: Record<string, string> = {};
      const staff = await pool.query<{ email: string; name: string }>(
        'SELECT email, name FROM staff WHERE email = $1',
        [email],
      );
      if ((staff.rowCount ?? 0) === 0) fields.staff_email = 'No staff account has that email.';
      if (!isStaffRole(role)) {
        fields.role = 'Choose editor, approver, recruiter or administrator.';
      }
      if (
        expiresRaw === '' ||
        Number.isNaN(expiresAt.getTime()) ||
        expiresAt.getTime() <= Date.now()
      ) {
        fields.expires_at = 'Choose an expiry in the future.';
      }
      if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

      const grant = await withTransaction(async (tx) => {
        const existing = await tx.query(
          `SELECT 1 FROM role_grants
            WHERE staff_email = $1 AND role = $2 AND revoked_at IS NULL AND expires_at > now()`,
          [email, role],
        );
        if ((existing.rowCount ?? 0) > 0) {
          throw errors.conflict('grant_exists', 'That person already holds this role.');
        }
        const id = randomUUID();
        const inserted = await tx.query<GrantRow>(
          `INSERT INTO role_grants (id, staff_email, role, granted_by, granted_at, expires_at, version)
           VALUES ($1,$2,$3,$4, now(), $5, 1)
           RETURNING ${GRANT_COLUMNS}`,
          [id, email, role, session.staff.email, expiresAt],
        );
        const row = inserted.rows[0] as GrantRow;
        await appendAuditEntry(tx, {
          actor: session.staff.email,
          action: 'grant.create',
          targetType: 'grant',
          targetId: id,
          detail: { staff_email: email, role, expires_at: expiresAt.toISOString() },
        });
        return row;
      });
      return jsonReply(201, { grant: grantObject(grant) }, etag(grant.version));
    }),
  );

  route('POST', '/api/console/grants/:id/revoke', 'console_writes', async (ctx) =>
    consoleWrite(ctx, async (session) => {
      const id = ctx.params.id as string;
      const existing = await loadGrant(pool, id);
      if (existing === undefined) throw errors.consoleNotFound();
      requireRole(session, 'administrator');
      const version = ifMatch(ctx);
      onlyKeys(objectBody(ctx.json()), []);

      const grant = await withTransaction(async (tx) => {
        const current = await tx.query<GrantRow>(
          `SELECT ${GRANT_COLUMNS} FROM role_grants WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const row = current.rows[0];
        if (row === undefined) throw errors.consoleNotFound();
        if (row.version !== version) throw errors.staleVersion();
        if (grantStatus(row) !== 'active') {
          throw errors.conflict('grant_inactive', 'This grant has already ended.');
        }
        if (row.role === 'administrator') {
          const others = await tx.query(
            `SELECT 1 FROM role_grants
              WHERE role = 'administrator' AND id <> $1 AND revoked_at IS NULL
                AND expires_at > now()`,
            [id],
          );
          if ((others.rowCount ?? 0) === 0) {
            throw errors.conflict(
              'last_administrator',
              'You cannot revoke the last active administrator grant.',
            );
          }
        }
        const revoked = await tx.query<GrantRow>(
          `UPDATE role_grants
              SET revoked_at = now(), revoked_by = $2, version = version + 1,
                  lapse_swept_at = now()
            WHERE id = $1 AND version = $3
            RETURNING ${GRANT_COLUMNS}`,
          [id, session.staff.email, version],
        );
        const updated = revoked.rows[0];
        if (updated === undefined) throw errors.staleVersion();
        await appendAuditEntry(tx, {
          actor: session.staff.email,
          action: 'grant.revoke',
          targetType: 'grant',
          targetId: id,
          detail: { staff_email: row.staff_email, role: row.role },
        });
        if (row.role === 'approver') {
          const stillApprover = await tx.query(
            `SELECT 1 FROM role_grants
              WHERE staff_email = $1 AND role = 'approver' AND revoked_at IS NULL
                AND expires_at > now()`,
            [row.staff_email],
          );
          if ((stillApprover.rowCount ?? 0) === 0) {
            await voidLapsedSignoffs(tx, row.staff_email, session.staff.email);
          }
        }
        return updated;
      });
      return jsonReply(200, { grant: grantObject(grant) }, etag(grant.version));
    }),
  );
}
