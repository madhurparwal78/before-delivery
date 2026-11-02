import type { Request, Response } from 'express';
import { ERR, asyncRoute } from '../errors';
import type { AppServices } from '../session';
import { newSessionToken, resolveUser } from '../session';
import { readJsonBody } from '../body';
import { verifyPassword } from '../passwords';
import { sha256Hex } from '../hashutil';
import type { DbRow } from '../querier';

interface UserDbRow extends DbRow {
  id: string;
  name: string;
  email: string;
  role: string;
}

/** POST, GET and DELETE /api/session (DP-01). */
export function sessionRoutes(svc: AppServices) {
  const create = [
    asyncRoute(async (req: Request, res: Response) => {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const user = await svc.db.queryOne<UserDbRow & { password_hash: string }>(
        `SELECT id, name, email, role, password_hash FROM users WHERE lower(email) = $1`,
        [email]
      );
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        throw ERR.invalidCredentials();
      }
      // A new session replaces any session the browser already held.
      if (req.cookies?.strata_session) {
        const priorHash = sha256Hex(String(req.cookies.strata_session));
        await svc.db.query(`DELETE FROM sessions WHERE token_hash = $1`, [priorHash]);
      }
      const { token, tokenHash } = newSessionToken();
      await svc.db.query(`INSERT INTO sessions (token_hash, user_id, created_at) VALUES ($1,$2,$3)`, [
        tokenHash,
        user.id,
        Date.now(),
      ]);
      res.setHeader('Set-Cookie', `strata_session=${token}; HttpOnly; SameSite=Lax; Path=/`);
      res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    }),
  ];

  const read = [
    asyncRoute(async (req: Request, res: Response) => {
      const user = await resolveUser(svc.db, req.sessionTokenHash);
      if (!user) throw ERR.unauthenticated();
      res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    }),
  ];

  const destroy = [
    asyncRoute(async (req: Request, res: Response) => {
      if (req.sessionTokenHash) {
        await svc.db.query(`DELETE FROM sessions WHERE token_hash = $1`, [req.sessionTokenHash]);
      }
      res.setHeader('Set-Cookie', 'strata_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
      res.status(204).end();
    }),
  ];

  return { create, read, destroy };
}
