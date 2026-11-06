import { randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import { ERR, asyncRoute } from '../errors';
import type { AppServices } from '../session';
import type { Role } from '../../shared/domain';
import { ROLES } from '../../shared/domain';
import { cpLen } from '../../shared/domain';
import { readJsonBody } from '../body';
import { writeAuditRow } from '../audit';
import { authorityFor, lockGraph } from './tags';
import { compareFolded } from '../derived';
import { hasControlChars } from '../../shared/domain';
import { isValidEmailShape } from '../types';
import { hashPassword } from '../passwords';

/** GET/POST /api/users, PATCH /api/users/{id} (DP-03, DP-07). */
export function userRoutes(svc: AppServices) {
  const listRoute = [
    asyncRoute(async (req: Request, res: Response) => {
      if (req.sessionUser!.role !== 'Admin') throw ERR.forbidden();
      const users = await svc.db.query<{ id: string; name: string; email: string; role: string }>(
        `SELECT id, name, email, role FROM users`
      );
      const sorted = users
        .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }))
        .sort((a, b) => compareFolded(a.name, b.name) || (a.id < b.id ? -1 : 1));
      res.json({ users: sorted });
    }),
  ];

  const createRoute = [
    asyncRoute(async (req: Request, res: Response) => {
      if (req.sessionUser!.role !== 'Admin') throw ERR.forbidden();
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const role = typeof body.role === 'string' ? body.role : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const fields: Record<string, string> = {};
      if (cpLen(name) < 1 || cpLen(name) > 80 || hasControlChars(name)) {
        fields.name = 'Use 1 to 80 characters without control characters.';
      }
      if (!isValidEmailShape(email)) fields.email = 'Enter a valid email address.';
      if (!(ROLES as readonly string[]).includes(role)) fields.role = 'Role must be Admin, Steward, Analyst or Viewer.';
      if (cpLen(password) < 12) fields.password = 'Use at least 12 characters.';
      if (Object.keys(fields).length > 0) throw ERR.validation(fields);
      const existing = await svc.db.queryOne<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
      if (existing) throw ERR.conflict('email_exists', 'That email is already in use.');
      const id = `u-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
      const hash = await hashPassword(password);
      await svc.db.transaction(async (tx) => {
        await lockGraph(tx);
        const authority = await authorityFor(tx, req, ['Admin'] as readonly Role[]);
        const dup = await tx.queryOne<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
        if (dup) throw ERR.conflict('email_exists', 'That email is already in use.');
        await tx.query(`INSERT INTO users (id, name, email, role, password_hash) VALUES ($1,$2,$3,$4,$5)`, [
          id,
          name,
          email,
          role,
          hash,
        ]);
        await writeAuditRow(tx, {
          actorId: authority.id,
          actorRole: authority.role,
          action: 'user.create',
          targetType: 'user',
          targetId: id,
          before: null,
          after: { name, email, role },
        });
      });
      res.status(201).json({ user: { id, name, email, role: role as Role } });
    }),
  ];

  const patchRoute = [
    asyncRoute(async (req: Request, res: Response) => {
      const targetId = String(req.params.id);
      const target = await svc.db.queryOne<{ id: string; name: string; role: string }>(`SELECT id, name, role FROM users WHERE id = $1`, [
        targetId,
      ]);
      if (!target) throw ERR.notFound();
      if (req.sessionUser!.role !== 'Admin') throw ERR.forbidden();
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const hasRole = body.role !== undefined;
      const hasPassword = body.password !== undefined;
      const fields: Record<string, string> = {};
      if (hasRole && hasPassword) {
        throw ERR.validation({ role: 'Send either a role or a password.' });
      }
      if (!hasRole && !hasPassword) {
        throw ERR.validation({ role: 'Send either a role or a password.' });
      }
      if (hasRole && !(ROLES as readonly string[]).includes(String(body.role))) {
        fields.role = 'Role must be Admin, Steward, Analyst or Viewer.';
      }
      if (hasPassword && cpLen(String(body.password)) < 12) fields.password = 'Use at least 12 characters.';
      if (Object.keys(fields).length > 0) throw ERR.validation(fields);

      if (hasRole) {
        const newRole = String(body.role);
        if (targetId === req.sessionUser!.id) {
          throw ERR.conflict('own_role', "You can't change your own role.");
        }
        await svc.db.transaction(async (tx) => {
          await lockGraph(tx);
          const authority = await authorityFor(tx, req, ['Admin'] as readonly Role[]);
          const fresh = await tx.queryOne<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [targetId]);
          if (!fresh) throw ERR.notFound();
          if (targetId === authority.id) throw ERR.conflict('own_role', "You can't change your own role.");
          if (fresh.role !== newRole) {
            await tx.query(`UPDATE users SET role = $2 WHERE id = $1`, [targetId, newRole]);
            await writeAuditRow(tx, {
              actorId: authority.id,
              actorRole: authority.role,
              action: 'user.role_change',
              targetType: 'user',
              targetId,
              before: { role: fresh.role },
              after: { role: newRole },
            });
          }
        });
        const user = await svc.db.queryOne<{ id: string; name: string; email: string; role: string }>(
          `SELECT id, name, email, role FROM users WHERE id = $1`,
          [targetId]
        );
        res.json({ user: { id: user!.id, name: user!.name, email: user!.email, role: user!.role } });
        return;
      }

      // Password reset: replace the hash, end every session, one audit row (DP-07).
      const password = String(body.password);
      const hash = await hashPassword(password);
      await svc.db.transaction(async (tx) => {
        await lockGraph(tx);
        const authority = await authorityFor(tx, req, ['Admin'] as readonly Role[]);
        const fresh = await tx.queryOne<{ id: string }>(`SELECT id FROM users WHERE id = $1`, [targetId]);
        if (!fresh) throw ERR.notFound();
        if (targetId === authority.id) throw ERR.conflict('own_password', "You can't reset your own password here.");
        await tx.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [targetId, hash]);
        const ended = await tx.query<{ token_hash: string }>(`DELETE FROM sessions WHERE user_id = $1 RETURNING token_hash`, [targetId]);
        sessionsEndedLocal.value = ended.length;
        await writeAuditRow(tx, {
          actorId: authority.id,
          actorRole: authority.role,
          action: 'user.password_reset',
          targetType: 'user',
          targetId,
          before: null,
          after: { sessions_ended: ended.length },
        });
      });
      const user = await svc.db.queryOne<{ id: string; name: string; email: string; role: string }>(
        `SELECT id, name, email, role FROM users WHERE id = $1`,
        [targetId]
      );
      res.json({
        user: { id: user!.id, name: user!.name, email: user!.email, role: user!.role },
        sessions_ended: sessionsEndedLocal.value,
      });
    }),
  ];

  return { listRoute, createRoute, patchRoute };
}

const sessionsEndedLocal = { value: 0 };


