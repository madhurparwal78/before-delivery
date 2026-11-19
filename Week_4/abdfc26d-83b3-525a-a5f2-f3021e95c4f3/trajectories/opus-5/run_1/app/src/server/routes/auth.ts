import { Router } from 'express';
import { beginLogin, completeLogin, safeReturnTo } from '../auth/oidc.js';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  readSessionCookie,
  setSessionCookie,
} from '../auth/session.js';
import { asyncRoute, sendNoContent } from '../http/respond.js';

export const authRouter = Router();

authRouter.get(
  '/login',
  asyncRoute(async (req, res) => {
    const returnTo = safeReturnTo(req.query.return_to);
    const redirect = await beginLogin(returnTo);
    res.redirect(302, redirect.url);
  }),
);

authRouter.get(
  '/callback',
  asyncRoute(async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (code === '' || state === '') {
      res.redirect(302, '/');
      return;
    }
    const login = await completeLogin(code, state);
    setSessionCookie(res, await createSession(login.principal.id));
    res.redirect(302, safeReturnTo(login.returnTo));
  }),
);

authRouter.post(
  '/logout',
  asyncRoute(async (req, res) => {
    const sessionId = readSessionCookie(req);
    if (sessionId) await destroySession(sessionId);
    clearSessionCookie(res);
    sendNoContent(res, 204);
  }),
);
