import { Router } from 'express';
import { SystemStatus } from '../../../shared/types';
import { pool } from '../../db/pool';
import { killbillReachable } from '../../services/killbill';
import { mailReachable } from '../../services/mail';
import { storageReachable } from '../../services/storage';
import { serverState } from '../../state';
import {
  clearSessionCookie,
  sessionToken,
  setSessionCookie,
  signIn,
  signOut,
} from '../auth';
import { jsonObject, requireAuth } from '../context';
import { validationFailed } from '../errors';

const PROBE_TIMEOUT_MS = 1800;

async function postgresReachable(): Promise<boolean> {
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  }
}

let cached: { at: number; status: SystemStatus } | null = null;

async function probe(): Promise<SystemStatus> {
  if (cached && Date.now() - cached.at < 1000) return cached.status;
  const [postgres, killbill, mail, storage] = await Promise.all([
    postgresReachable(),
    killbillReachable(PROBE_TIMEOUT_MS),
    mailReachable(PROBE_TIMEOUT_MS),
    storageReachable(PROBE_TIMEOUT_MS),
  ]);
  const status: SystemStatus = {
    postgres: postgres ? 'up' : 'down',
    killbill: killbill ? 'up' : 'down',
    mail: mail ? 'up' : 'down',
    storage: storage ? 'up' : 'down',
  };
  cached = { at: Date.now(), status };
  return status;
}

export const systemRouter = Router();

systemRouter.get('/health', (_req, res) => {
  if (!serverState.ready) {
    res.status(503).json({ status: 'starting' });
    return;
  }
  res.json({ status: 'ok' });
});

systemRouter.get('/system/status', async (_req, res) => {
  res.json(await probe());
});

systemRouter.post('/session', async (req, res) => {
  const body = jsonObject(req);
  const email = typeof body.email === 'string' ? body.email : '';
  const passcode = typeof body.passcode === 'string' ? body.passcode : '';
  const fields: Record<string, string> = {};
  if (email.trim().length === 0) fields.email = 'Enter your email address.';
  if (passcode.length === 0) fields.passcode = 'Enter the demo passcode.';
  if (Object.keys(fields).length > 0) throw validationFailed(fields);
  const { user, token } = await signIn(email, passcode);
  setSessionCookie(res, token);
  res.json({ user });
});

systemRouter.delete('/session', async (req, res) => {
  requireAuth(req);
  await signOut(sessionToken(req));
  clearSessionCookie(res);
  res.status(204).end();
});

systemRouter.get('/me', (req, res) => {
  res.json({ user: requireAuth(req) });
});
