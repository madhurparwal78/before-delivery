import { sendJson, sendNoContent, type Req, type Router } from './http.js';
import { one, rows, query, tx } from './db.js';
import { config } from './config.js';
import { invalidCredentials, invalidTransition, notFound, rateLimited, validationFailed } from './errors.js';
import {
  requireSession, clearSessionCookie,
  throttleCheck, recordFailure, clearFailures,
} from './auth.js';
import { verifyPassword, hashPassword, totpAt, currentStep, unseal, seal, sha256Hex, recoveryCodes, totpSecret } from './crypto.js';
import { auditUserAction } from './audit.js';
import { queueMail, mailTime } from './mail.js';

function jsonBody(req: Req): Record<string, unknown> {
  if (!req.rawBody || req.rawBody.length === 0) return {};
  try { return JSON.parse(req.rawBody.toString('utf8')) as Record<string, unknown>; } catch { return {}; }
}
function iso(d: Date): string { return d.toISOString(); }

const CODE_MSG = "That code didn't work. Use the current code from your app.";
const REC_MSG = "That recovery code didn't work or was already used.";
const BOTH_MSG = 'Enter a code from your app or a recovery code.';

interface TwoStepRow { sealed_secret: string | null; enabled: boolean; enabled_at: Date | null; last_accepted_step: string }

async function twoStepRow(userId: string): Promise<TwoStepRow | null> {
  return one<TwoStepRow>(
    `SELECT sealed_secret, enabled, enabled_at, last_accepted_step::text AS last_accepted_step FROM two_step WHERE user_id = $1`,
    [userId]
  );
}

/** Judges a code or recovery code against the user's two-step state, enforcing each-step-once. */
async function acceptCode(
  userId: string, emailLower: string, body: Record<string, unknown>, kind: 'enable' | 'off' | 'confirm',
): Promise<void> {
  const hasCode = 'code' in body, hasRec = 'recovery_code' in body;
  if (hasCode === hasRec) throw validationFailed({ code: BOTH_MSG });
  const throttle = await throttleCheck(emailLower);
  if (throttle !== null) throw rateLimited(throttle);
  const ts = await twoStepRow(userId);
  const now = new Date();
  const step = currentStep(now);
  if (hasCode) {
    const code = String(body.code ?? '');
    const secret = ts?.sealed_secret ? unseal(config.secretKey, ts.sealed_secret) : null;
    let ok = false;
    let usedStep = step;
    if (secret) {
      for (const s of [step - 1, step, step + 1]) {
        if (totpAt(secret, s) === code) { ok = true; usedStep = s; break; }
      }
    }
    if (!ok) {
      await recordFailure(emailLower, 'two-step code');
      throw validationFailed({ code: CODE_MSG });
    }
    if (ts && usedStep <= Number(ts.last_accepted_step)) throw validationFailed({ code: CODE_MSG });
    await query(`UPDATE two_step SET last_accepted_step = $1 WHERE user_id = $2`, [usedStep, userId]);
  } else {
    const rec = String(body.recovery_code ?? '').toLowerCase().replace(/-/g, '');
    const codes = await rows<{ idx: number; hash: string; used: boolean }>(`SELECT idx, hash, used FROM recovery_codes WHERE user_id = $1`, [userId]);
    const match = codes.find(c => !c.used && c.hash === sha256Hex(rec));
    if (!match) {
      await recordFailure(emailLower, 'two-step code');
      throw validationFailed({ recovery_code: REC_MSG });
    }
    await query(`UPDATE recovery_codes SET used = true WHERE user_id = $1 AND idx = $2`, [userId, match.idx]);
  }
  if (kind === 'enable' || kind === 'confirm' || kind === 'off') clearFailures(emailLower).catch(() => undefined);
}

export function registerAccountRoutes(json: Router): void {
  json.get('/api/me/two-step', async (req, res) => {
    const { user } = await requireSession(req);
    const ts = await twoStepRow(user.id);
    const left = ts?.enabled
      ? await one<{ c: string }>(`SELECT count(*)::text AS c FROM recovery_codes WHERE user_id = $1 AND used = false`, [user.id])
      : null;
    sendJson(res, 200, {
      enabled: ts?.enabled ?? false,
      enabled_at: ts?.enabled_at ? iso(ts.enabled_at) : null,
      recovery_codes_left: left ? Number(left.c) : 0,
    });
  });

  json.post('/api/me/two-step/setup', async (req, res) => {
    const { user } = await requireSession(req);
    const ts = await twoStepRow(user.id);
    if (ts?.enabled) throw invalidTransition('on', 'on');
    const secret = totpSecret();
    await query(
      `INSERT INTO two_step (user_id, sealed_secret, enabled, last_accepted_step, setup_at)
       VALUES ($1,$2,false,-1,now())
       ON CONFLICT (user_id) DO UPDATE SET sealed_secret = $2, enabled = false, last_accepted_step = -1, setup_at = now()`,
      [user.id, seal(config.secretKey, secret)]
    );
    const uri = `otpauth://totp/Farshore:${encodeURIComponent(user.email)}?secret=${secret}&issuer=Farshore&algorithm=SHA1&digits=6&period=30`;
    sendJson(res, 200, { secret, otpauth_uri: uri });
  });

  json.post('/api/me/two-step/enable', async (req, res) => {
    const { user } = await requireSession(req);
    const body = jsonBody(req);
    const errors: Record<string, string> = {};
    for (const k of Object.keys(body)) if (k !== 'code') errors[k] = "This field can't be set.";
    if (!('code' in body)) errors.code = 'This field is required.';
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    const ts = await twoStepRow(user.id);
    if (!ts || ts.enabled) throw invalidTransition('off', 'on');
    if (!ts.sealed_secret) throw invalidTransition('off', 'on');
    await acceptCode(user.id, user.email.toLowerCase(), body, 'enable');
    const now = new Date();
    await query(`UPDATE two_step SET enabled = true, enabled_at = $1 WHERE user_id = $2`, [now, user.id]);
    const codes = recoveryCodes();
    await query(`DELETE FROM recovery_codes WHERE user_id = $1`, [user.id]);
    for (let i = 0; i < codes.length; i++) {
      await query(`INSERT INTO recovery_codes (user_id, idx, hash, used) VALUES ($1,$2,$3,false)`, [user.id, i, sha256Hex(codes[i])]);
    }
    await auditUserAction(user.id, user.email, 'two_step.enabled', user.email, '');
    await queueMail(user.email, 'Two-step sign-in turned on for your Farshore account',
      `Two-step sign-in was turned on at ${mailTime(now)}.\nSave your recovery codes somewhere safe; Farshore won't show them again.\n`);
    sendJson(res, 200, { recovery_codes: codes });
  });

  json.delete('/api/me/two-step', async (req, res) => {
    const { user } = await requireSession(req);
    const body = jsonBody(req);
    const hasCode = 'code' in body, hasRec = 'recovery_code' in body;
    if (hasCode === hasRec) throw validationFailed({ code: BOTH_MSG });
    const ts = await twoStepRow(user.id);
    if (!ts || !ts.enabled) throw invalidTransition('off', 'off');
    await acceptCode(user.id, user.email.toLowerCase(), body, 'off');
    const now = new Date();
    await query(`UPDATE two_step SET enabled = false, enabled_at = NULL, sealed_secret = NULL, last_accepted_step = -1 WHERE user_id = $1`, [user.id]);
    await query(`DELETE FROM recovery_codes WHERE user_id = $1`, [user.id]);
    await auditUserAction(user.id, user.email, 'two_step.disabled', user.email, '');
    await queueMail(user.email, 'Two-step sign-in turned off for your Farshore account',
      `Two-step sign-in was turned off at ${mailTime(now)}.\n`);
    sendNoContent(res);
  });

  json.post('/api/me/two-step/confirm', async (req, res) => {
    const { user, sessionId } = await requireSession(req);
    const body = jsonBody(req);
    const hasCode = 'code' in body, hasRec = 'recovery_code' in body;
    if (hasCode === hasRec) throw validationFailed({ code: BOTH_MSG });
    const ts = await twoStepRow(user.id);
    if (!ts || !ts.enabled) throw invalidTransition('off', 'confirmed');
    await acceptCode(user.id, user.email.toLowerCase(), body, 'confirm');
    const until = new Date(Date.now() + config.timing.stepUp * 1000);
    await query(`UPDATE sessions SET confirmed_until = $1 WHERE id = $2`, [until, sessionId]);
    sendJson(res, 200, { confirmed_until: iso(until) });
  });

  json.get('/api/me/sessions', async (req, res) => {
    const { user, sessionId } = await requireSession(req);
    const list = await rows<{ id: string; device: string; created_at: Date; last_seen_at: Date }>(
      `SELECT id, device, created_at, last_seen_at FROM sessions
       WHERE user_id = $1 AND state = 'active' ORDER BY last_seen_at DESC`, [user.id]
    );
    sendJson(res, 200, {
      sessions: list.map(s => ({
        id: s.id, device: s.device, created_at: iso(s.created_at), last_seen_at: iso(s.last_seen_at),
        current: s.id === sessionId,
      })),
    });
  });

  json.delete('/api/me/sessions/{id}', async (req, res) => {
    const { user, sessionId } = await requireSession(req);
    const target = req.params['id'];
    const s = await one<{ user_id: string; state: string }>(`SELECT user_id, state FROM sessions WHERE id = $1`, [target]);
    if (!s || s.user_id !== user.id || s.state !== 'active') throw notFound();
    await query(`UPDATE sessions SET state = 'ended', ended_at = now(), confirmed_until = NULL WHERE id = $1`, [target]);
    if (target === sessionId) {
      res.writeHead(204, { 'Set-Cookie': clearSessionCookie() });
      res.end();
      return;
    }
    sendNoContent(res);
  });

  json.post('/api/me/sessions/sign-out-others', async (req, res) => {
    const { user, sessionId } = await requireSession(req);
    const r = await query(
      `UPDATE sessions SET state = 'ended', ended_at = now(), confirmed_until = NULL
       WHERE user_id = $1 AND id <> $2 AND state IN ('active','pending')`,
      [user.id, sessionId]
    );
    sendJson(res, 200, { ended: r.rowCount ?? 0 });
  });

  json.put('/api/me/password', async (req, res) => {
    const { user, sessionId } = await requireSession(req);
    const body = jsonBody(req);
    const errors: Record<string, string> = {};
    for (const k of Object.keys(body)) if (k !== 'current_password' && k !== 'new_password') errors[k] = "This field can't be set.";
    if (!('current_password' in body)) errors.current_password = 'This field is required.';
    if (!('new_password' in body)) errors.new_password = 'This field is required.';
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    const current = String(body.current_password ?? '');
    const next = String(body.new_password ?? '');
    const emailLower = user.email.toLowerCase();
    const throttle = await throttleCheck(emailLower);
    if (throttle !== null) throw rateLimited(throttle);
    const row = await one<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);
    if (!row || !verifyPassword(current, row.password_hash)) {
      await recordFailure(emailLower, 'password');
      throw invalidCredentials();
    }
    if (next.length < 12 || next.length > 128 || next === current) {
      throw validationFailed({ new_password: 'Use 12 to 128 characters, different from your current password.' });
    }
    const now = new Date();
    const r = await tx(async client => {
      await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hashPassword(next), user.id]);
      const ended = await client.query(
        `UPDATE sessions SET state = 'ended', ended_at = now(), confirmed_until = NULL
         WHERE user_id = $1 AND id <> $2 AND state IN ('active','pending')`, [user.id, sessionId]
      );
      return ended.rowCount ?? 0;
    });
    await clearFailures(emailLower);
    await auditUserAction(user.id, user.email, 'password.changed', user.email, '');
    await queueMail(user.email, 'Your Farshore password was changed',
      `Your password was changed at ${mailTime(now)}. ${r} other ${r === 1 ? 'session was' : 'sessions were'} signed out.\n`);
    sendJson(res, 200, { ended_sessions: r });
  });
}
