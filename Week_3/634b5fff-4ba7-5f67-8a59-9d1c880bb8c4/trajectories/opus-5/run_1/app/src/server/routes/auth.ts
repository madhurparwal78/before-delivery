import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { fail } from '../errors.js';
import { closeSession, handler, openSession } from '../http.js';
import { authorizationUrl, exchangeCode, identityUp, IdentityUnreachable } from '../services/identity.js';

export const authRouter: Router = Router();

const pendingStates = new Set<string>();

function redirectUri(): string {
  return `${config.publicUrl}/auth/callback`;
}

authRouter.get(
  '/auth/login',
  handler(async (unusedRequest, res) => {
    if (!(await identityUp())) throw fail(503, 'identity_unreachable');
    const state = randomBytes(16).toString('hex');
    pendingStates.add(state);
    res.redirect(authorizationUrl(state, redirectUri()));
  }),
);

authRouter.get(
  '/auth/callback',
  handler(async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!pendingStates.delete(state) || code === '') throw fail(403, 'origin_refused');
    try {
      openSession(res, await exchangeCode(code, redirectUri()));
    } catch (error) {
      if (error instanceof IdentityUnreachable) throw fail(503, 'identity_unreachable');
      throw error;
    }
    res.redirect('/staff');
  }),
);

authRouter.post('/auth/logout', (req, res) => {
  closeSession(req, res);
  res.status(204).end();
});
