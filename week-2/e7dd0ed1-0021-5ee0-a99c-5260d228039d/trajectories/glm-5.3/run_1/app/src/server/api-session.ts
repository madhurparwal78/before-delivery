import { sendJson, type Req, type Router } from './http.js';
import { one, rows, query } from './db.js';
import { config } from './config.js';
import { invalidCredentials, rateLimited, validationFailed, unauthenticated } from './errors.js';
import {
  loadSession, requireSession, createSession, promotePendingSession, deviceFrom,
  sessionCookie, clearSessionCookie, throttleCheck, recordFailure, clearFailures,
} from './auth.js';
import {
  verifyPassword, totpAt, currentStep, unseal, sha256Hex,
} from './crypto.js';
import { auditUserAction } from './audit.js';

function jsonBody(req: Req): Record<string, unknown> {
  if (!req.rawBody || req.rawBody.length === 0) return {};
  try { return JSON.parse(req.rawBody.toString('utf8')) as Record<string, unknown>; } catch { return {}; }
}

function fieldErrors(body: Record<string, unknown>, allowed: string[], required: string[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const k of Object.keys(body)) {
    if (!allowed.includes(k)) errors[k] = "This field can't be set.";
  }
  for (const k of required) {
    if (!(k in body) || body[k] === undefined) errors[k] = 'This field is required.';
  }
  return errors;
}

function iso(d: Date): string { return d.toISOString(); }

export function registerApiRoutes(json: Router): void {
  json.get('/api/regions', async (_req, res) => {
    const r = await rows(`SELECT id, name, continent, lon, lat FROM regions ORDER BY id`);
    sendJson(res, 200, { regions: r });
  });

  json.post('/api/session', async (req, res) => {
    const body = jsonBody(req);
    const errors = fieldErrors(body, ['email', 'password'], ['email', 'password']);
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    const email = String(body.email ?? '').trim();
    const password = String(body.password ?? '');
    const emailLower = email.toLowerCase();
    const throttle = await throttleCheck(emailLower);
    if (throttle !== null) throw rateLimited(throttle);
    const user = await one<{ id: string; email: string; name: string; operator: boolean; password_hash: string }>(
      `SELECT id, email, name, operator, password_hash FROM users WHERE email_lower = $1`, [emailLower]
    );
    if (!user || !verifyPassword(password, user.password_hash)) {
      await recordFailure(emailLower, 'password');
      throw invalidCredentials();
    }
    const ts = await one<{ enabled: boolean }>(`SELECT enabled FROM two_step WHERE user_id = $1`, [user.id]);
    const device = deviceFrom(req.headers);
    if (ts?.enabled) {
      const s = await createSession(user.id, device, true);
      await query(`UPDATE sessions SET pending_expires_at = now() + interval '${config.timing.twoStepPending} seconds' WHERE id = $1`, [s.id]);
      res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': sessionCookie(s.token) });
      const pendingExpires = new Date(Date.now() + config.timing.twoStepPending * 1000);
      res.end(JSON.stringify({ two_step: 'required', expires_at: iso(pendingExpires) }));
      return;
    }
    await completeSignIn(res, user.id, user.email, user.name, user.operator, device, emailLower);
  });

  json.post('/api/session/two-step', async (req, res) => {
    const body = jsonBody(req);
    const hasCode = 'code' in body, hasRec = 'recovery_code' in body;
    if (hasCode === hasRec) {
      throw validationFailed({ code: 'Enter a code from your app or a recovery code.' });
    }
    const { session, user } = await loadSession(req);
    if (!session || !session.isPending || !user) throw unauthenticated();
    const ts = await one<{ sealed_secret: string | null; enabled: boolean; last_accepted_step: string }>(
      `SELECT sealed_secret, enabled, last_accepted_step::text AS last_accepted_step FROM two_step WHERE user_id = $1`, [user.id]
    );
    if (!ts || !ts.enabled) throw unauthenticated();
    const emailLower = user.email.toLowerCase();
    const throttle = await throttleCheck(emailLower);
    if (throttle !== null) throw rateLimited(throttle);
    const now = new Date();
    const step = currentStep(now);
    let ok = false;
    let usedStep = step;
    if (hasCode) {
      const code = String(body.code ?? '');
      const secret = ts.sealed_secret ? unseal(config.secretKey, ts.sealed_secret) : null;
      if (secret) {
        for (const s of [step - 1, step, step + 1]) {
          if (totpAt(secret, s) === code) { ok = true; usedStep = s; break; }
        }
      }
      if (!ok) {
        await recordFailure(emailLower, 'two-step code');
        throw validationFailed({ code: "That code didn't work. Use the current code from your app." });
      }
      if (usedStep <= Number(ts.last_accepted_step)) {
        throw validationFailed({ code: "That code didn't work. Use the current code from your app." });
      }
    } else {
      const rec = String(body.recovery_code ?? '').toLowerCase().replace(/-/g, '');
      const codes = await rows<{ idx: number; hash: string; used: boolean }>(
        `SELECT idx, hash, used FROM recovery_codes WHERE user_id = $1`, [user.id]
      );
      const match = codes.find(c => !c.used && c.hash === sha256Hex(rec));
      if (!match) {
        await recordFailure(emailLower, 'two-step code');
        throw validationFailed({ recovery_code: "That recovery code didn't work or was already used." });
      }
      await query(`UPDATE recovery_codes SET used = true WHERE user_id = $1 AND idx = $2`, [user.id, match.idx]);
    }
    await query(`UPDATE two_step SET last_accepted_step = $1 WHERE user_id = $2`, [usedStep, user.id]);
    const promoted = await promotePendingSession(session.id, user.id, deviceFrom(req.headers));
    await clearFailures(emailLower);
    await auditUserAction(user.id, user.email, 'session.signed_in', user.email, hasCode ? 'two-step' : 'recovery code');
    const memberships = await rows<{ slug: string; name: string; role: string }>(
      `SELECT w.slug, w.name, m.role FROM members m JOIN workspaces w ON w.slug = m.workspace_slug WHERE m.user_id = $1 ORDER BY w.name`, [user.id]
    );
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': sessionCookie(promoted.token),
    });
    res.end(JSON.stringify({
      user: { id: user.id, name: user.name, email: user.email, operator: user.operator },
      memberships: memberships.map(m => ({ workspace: { slug: m.slug, name: m.name }, role: m.role })),
    }));
  });

  json.delete('/api/session', async (req, res) => {
    const cookies = (req.headers['cookie'] ?? '');
    const token = /(?:^|;\s*)fs_session=([^;]+)/.exec(cookies)?.[1];
    if (token) {
      const { sessionTokenVerifier } = await import('./crypto.js');
      await query(`UPDATE sessions SET state = 'ended', ended_at = now() WHERE token_hash = $1`, [sessionTokenVerifier(token)]);
    }
    res.writeHead(204, { 'Set-Cookie': clearSessionCookie() });
    res.end();
  });

  json.get('/api/me', async (req, res) => {
    const { user } = await requireSession(req);
    const memberships = await rows<{ slug: string; name: string; role: string }>(
      `SELECT w.slug, w.name, m.role FROM members m JOIN workspaces w ON w.slug = m.workspace_slug WHERE m.user_id = $1 ORDER BY w.name`, [user.id]
    );
    sendJson(res, 200, {
      user: { id: user.id, name: user.name, email: user.email, operator: user.operator },
      memberships: memberships.map(m => ({ workspace: { slug: m.slug, name: m.name }, role: m.role })),
    });
  });
}

async function completeSignIn(
  res: import('node:http').ServerResponse,
  userId: string, email: string, name: string, operator: boolean, device: string, emailLower: string,
): Promise<void> {
  // Sign-in replacement: any incoming session ends in the same change.
  const s = await createSession(userId, device, false);
  await clearFailures(emailLower);
  await auditUserAction(userId, email, 'session.signed_in', email, 'password');
  const memberships = await rows<{ slug: string; name: string; role: string }>(
    `SELECT w.slug, w.name, m.role FROM members m JOIN workspaces w ON w.slug = m.workspace_slug WHERE m.user_id = $1 ORDER BY w.name`, [userId]
  );
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Set-Cookie': sessionCookie(s.token),
  });
  res.end(JSON.stringify({
    user: { id: userId, name, email, operator },
    memberships: memberships.map(m => ({ workspace: { slug: m.slug, name: m.name }, role: m.role })),
  }));
}
