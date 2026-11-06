/**
 * System and account routes.
 *
 * `/api/health` answers as soon as the server listens, whatever the state of
 * any provider or of the database.
 */

import type { Router } from 'express';

import { shopNowIso } from '../../domain/clock.js';
import { killbillStatus } from '../../providers/killbill.js';
import { registryStatus } from '../../providers/registry.js';
import { register, signIn, signOut } from '../../services/auth.js';
import { SESSION_COOKIE } from '../../services/auth.js';
import { readCookie } from '../app.js';
import { asyncRoute, clearSessionCookie, requireUser, setSessionCookie } from '../context.js';

export function registerSystemRoutes(api: Router): void {
  api.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  api.get('/status', (_req, res) => {
    res.status(200).json({
      killbill: killbillStatus(),
      registry: registryStatus(),
      serverNow: shopNowIso(),
    });
  });

  api.post(
    '/auth/register',
    asyncRoute(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const { user, sessionId } = await register({
        email: body.email,
        password: body.password,
        name: body.name,
        country: body.country,
      });
      setSessionCookie(res, sessionId);
      res.status(201).json(user);
    }),
  );

  api.post(
    '/auth/sign-in',
    asyncRoute(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const { user, sessionId } = await signIn(body.email, body.password);
      setSessionCookie(res, sessionId);
      res.status(200).json(user);
    }),
  );

  api.post(
    '/auth/sign-out',
    asyncRoute(async (req, res) => {
      await signOut(readCookie(req, SESSION_COOKIE));
      clearSessionCookie(res);
      res.status(204).end();
    }),
  );

  api.get(
    '/me',
    asyncRoute(async (req, res) => {
      res.status(200).json(await requireUser(req));
    }),
  );
}
