// Session endpoints.

import { Router } from 'express';
import express from 'express';
import { one } from '../lib/db.js';
import { ApiError, FIELD_ERRORS, validationError } from '../lib/errors.js';
import {
  createSession,
  endSession,
  memberFromRow,
  requireSession,
  setSessionCookie,
  verifyPassword,
} from '../lib/auth.js';
import { memberRow, projectMemberFor } from '../lib/scope.js';
import type { AuthedRequest } from '../lib/auth.js';
import { wrap } from './helpers.js';
import type { Config } from '../lib/config.js';

export function sessionRouter(config: Config): Router {
  const router = Router();

  router.post('/api/session', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const errors: Record<string, string> = {};
    if (!email) errors.email = FIELD_ERRORS.required('Email');
    if (!password) errors.password = FIELD_ERRORS.required('Password');
    if (Object.keys(errors).length > 0) throw validationError(errors);
    const row = await one<Parameters<typeof memberFromRow>[0] & { password_hash: string | null }>(
      'SELECT * FROM members WHERE lower(email) = $1',
      [email],
    );
    if (!row || row.status !== 'active' || !verifyPassword(password, row.password_hash)) {
      throw new ApiError(401, { error: 'invalid_credentials' });
    }
    const token = await createSession(row.id);
    setSessionCookie(res, token, config.timing.sessionIdleTimeout);
    const member = memberFromRow(row);
    const full = await memberRow(row.id);
    res.json({ member: { id: member.id, name: member.name, role: member.role, organisation: full ? projectMemberFor(member, full).organisation : 'Marrow Hall Interiors' } });
  }));

  router.get('/api/session', requireSession(config.timing.sessionIdleTimeout), wrap(async (req, res) => {
    const member = (req as AuthedRequest).member!;
    const full = await memberRow(member.id);
    res.json({
      member: {
        id: member.id,
        name: member.name,
        role: member.role,
        organisation: full ? projectMemberFor(member, full).organisation : 'Marrow Hall Interiors',
      },
    });
  }));

  router.delete('/api/session', requireSession(config.timing.sessionIdleTimeout), wrap(async (req, res) => {
    await endSession(req);
    res.setHeader('Set-Cookie', 'plumbline_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.status(204).end();
  }));

  return router;
}
