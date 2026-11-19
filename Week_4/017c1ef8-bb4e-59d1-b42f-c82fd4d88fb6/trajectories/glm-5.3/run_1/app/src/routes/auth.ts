import { Router } from 'express';
import { query } from '../db.js';
import { ApiError, errors, newId } from '../errors.js';
import { businessMs } from '../clock.js';
import { hashPassword, verifyPassword } from '../password.js';
import { sendMail } from '../mail.js';
import { wrap, setSessionCookie, clearSessionCookie, newSessionToken, requireSession } from '../http.js';
import { ownerProjection, getMemberById } from '../profile.js';

const HANDLE_RE = /^[a-z0-9-]{3,30}$/;

const makeCode = (): string => {
  let code = '';
  for (let i = 0; i < 6; i++) code += Math.floor(Math.random() * 10);
  return code;
};

const ensureProfileRows = async (memberId: string): Promise<void> => {
  await query(`INSERT INTO profile_sections (member_id) VALUES ($1) ON CONFLICT DO NOTHING`, [memberId]);
};

export const authRouter = (): Router => {
  const router = Router();

  router.post('/auth/signup', wrap(async (req, res) => {
    const { email, password, name, handle } = (req.body ?? {}) as Record<string, unknown>;
    const fields: Record<string, string> = {};
    const emailStr = typeof email === 'string' ? email.trim() : '';
    const passwordStr = typeof password === 'string' ? password : '';
    const nameStr = typeof name === 'string' ? name.trim() : '';
    const handleStr = typeof handle === 'string' ? handle.trim() : '';
    if (!emailStr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) fields.email = 'Enter a valid email address.';
    if (!HANDLE_RE.test(handleStr)) fields.handle = 'Handles use 3 to 30 lowercase letters, digits and hyphens.';
    if (passwordStr.length < 10) fields.password = 'Use at least 10 characters.';
    if (nameStr.length < 1 || nameStr.length > 80) fields.name = 'Enter a name of 1 to 80 characters.';

    const existingEmail = await query<{ confirmed: boolean }>(
      `SELECT confirmed FROM members WHERE lower(email) = lower($1)`, [emailStr]);
    if (existingEmail.rows.length > 0 && existingEmail.rows[0].confirmed) {
      fields.email = 'This email is already registered.';
    }
    const existingHandle = await query(`SELECT 1 FROM members WHERE lower(handle) = lower($1)`, [handleStr]);
    if (existingHandle.rows.length > 0) fields.handle = 'This handle is taken.';
    if (Object.keys(fields).length > 0) throw errors.validation(fields);

    const existing = existingEmail.rows[0];
    if (existingEmail.rows.length > 0 && !existing?.confirmed) {
      // A repeated sign-up while unconfirmed replaces the code and sends a new message.
      const code = makeCode();
      await query(
        `INSERT INTO confirmation_codes (email, code, created_at) VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE SET code = $2, created_at = $3`,
        [emailStr, code, new Date(businessMs())]);
      sendMail(emailStr, `Your Plainwork code: ${code}`, `Your Plainwork confirmation code is ${code}.`);
      res.status(201).json({ status: 'confirmation_sent' });
      return;
    }

    const code = makeCode();
    const memberId = newId();
    const hash = await hashPassword(passwordStr);
    await query(
      `INSERT INTO members (id, email, handle, password_hash, name, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [memberId, emailStr, handleStr, hash, nameStr, new Date(businessMs())]);
    await ensureProfileRows(memberId);
    await query(
      `INSERT INTO confirmation_codes (email, code, created_at) VALUES ($1, $2, $3)`,
      [emailStr, code, new Date(businessMs())]);
    sendMail(emailStr, `Your Plainwork code: ${code}`, `Your Plainwork confirmation code is ${code}.`);
    res.status(201).json({ status: 'confirmation_sent' });
  }));

  router.post('/auth/confirm', wrap(async (req, res) => {
    const { email, code } = (req.body ?? {}) as Record<string, string>;
    const result = await query<{ code: string }>(
      `SELECT code FROM confirmation_codes WHERE lower(email) = lower($1)`, [email ?? '']);
    if (result.rows.length === 0 || result.rows[0].code !== code) {
      throw errors.validation({ code: "That code doesn't match." });
    }
    const member = await query<{ id: string }>(
      `SELECT id FROM members WHERE lower(email) = lower($1)`, [email ?? '']);
    if (member.rows.length === 0) throw errors.notFound();
    await query(`UPDATE members SET confirmed = true WHERE id = $1`, [member.rows[0].id]);
    await query(`DELETE FROM confirmation_codes WHERE lower(email) = lower($1)`, [email ?? '']);
    const token = newSessionToken();
    await query(`INSERT INTO sessions (token, member_id, created_at) VALUES ($1, $2, $3)`,
      [token, member.rows[0].id, new Date(businessMs())]);
    setSessionCookie(res, token);
    const row = await getMemberById(member.rows[0].id);
    if (!row) throw errors.notFound();
    res.json({ member: { id: row.id, handle: row.handle, name: row.name } });
  }));

  router.post('/auth/signin', wrap(async (req, res) => {
    const { email, password } = (req.body ?? {}) as Record<string, string>;
    const result = await query<{ id: string; password_hash: string; confirmed: boolean }>(
      `SELECT id, password_hash, confirmed FROM members WHERE lower(email) = lower($1)`, [email ?? '']);
    if (result.rows.length === 0) throw new ApiError(422, { error: 'invalid_credentials' });
    const row = result.rows[0];
    if (!row.confirmed) {
      res.status(409).json({ error: 'unconfirmed' });
      return;
    }
    const ok = await verifyPassword(password ?? '', row.password_hash);
    if (!ok) throw new ApiError(422, { error: 'invalid_credentials' });
    const token = newSessionToken();
    await query(`INSERT INTO sessions (token, member_id, created_at) VALUES ($1, $2, $3)`,
      [token, row.id, new Date(businessMs())]);
    setSessionCookie(res, token);
    const member = await getMemberById(row.id);
    if (!member) throw errors.notFound();
    res.json({ member: { id: member.id, handle: member.handle, name: member.name } });
  }));

  router.post('/auth/signout', wrap(async (req, res) => {
    if (req.auth) {
      await query(`DELETE FROM sessions WHERE member_id = $1`, [req.auth.memberId]);
    }
    clearSessionCookie(res);
    res.status(204).end();
  }));

  router.get('/me', requireSession, wrap(async (req, res) => {
    const member = await getMemberById(req.auth!.memberId);
    if (!member) throw errors.notFound();
    res.json(await ownerProjection(member));
  }));

  return router;
};
