import express from 'express';
import crypto from 'node:crypto';
import { q, one } from '../db.js';
import { settings } from '../settings.js';
import { clockNow } from '../clock.js';
import { t, validationError, notValid } from '../errors.js';
import { currentUser, setSessionCookie, safeLandingPath, handler, requireRole } from '../core.js';
import * as bus from '../live.js';
import { enqueueMail } from '../mail.js';

export const router = express.Router();

export const hash = (pw: string): string =>
  crypto.createHash('sha256').update(`rb:${pw}`).digest('hex');

export const verifyPassword = (pw: string, stored: string | null): boolean =>
  stored !== null && hash(pw) === stored;

function userPublic(row: any) {
  return { id: row.id, name: row.name, email: row.email, role: row.role, status: row.status };
}

router.post('/session', handler(async (req, res) => {
  const { email, password, next } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    throw t('invalid_credentials');
  }
  const user = await one(
    `select * from users where lower(email) = lower($1) and status = 'Active'`,
    [email]
  );
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw t('invalid_credentials');
  }
  const token = crypto.randomBytes(24).toString('base64url');
  await q(`insert into sessions (token, user_id) values ($1, $2)`, [token, user.id]);
  setSessionCookie(res, token);
  return { status: 200, body: { user: userPublic(user), landing: safeLandingPath(next) } };
}));

router.delete('/session', handler(async (req, res) => {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)rb_session=([^;]+)/);
  if (m) {
    await q(`delete from sessions where token = $1`, [decodeURIComponent(m[1])]);
  }
  res.setHeader('Set-Cookie', 'rb_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.status(204).end();
  return null;
}));

router.get('/me', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  const row = await one(
    `select u.id, u.name, u.role, c.id as clinic_id, c.name as clinic_name, c.slug
     from users u join clinics c on c.id = u.clinic_id where u.id = $1`,
    [user.userId]
  );
  return {
    status: 200,
    body: {
      id: row.id,
      name: row.name,
      role: row.role,
      clinic: { id: row.clinic_id, name: row.clinic_name, slug: row.slug },
    },
  };
}));

// ---- invitations and staff (manager) ------------------------------------

router.post('/staff/invitations', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, ['manager']);
  const { email, name, role } = req.body ?? {};
  if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw validationError('email');
  if (typeof name !== 'string' || name.trim() === '') throw validationError('name');
  if (typeof role !== 'string' || !['front-desk', 'nurse', 'vet', 'manager'].includes(role)) {
    throw notValid('role');
  }
  const existing = await one(
    `select id, clinic_id, status from users where lower(email) = lower($1)`,
    [email]
  );
  if (existing && existing.status === 'Active') throw t('email_taken');
  const pending = await one(
    `select id from invitations where lower(email) = lower($1) and status = 'Invited'`,
    [email]
  );
  if (pending) {
    await q(`update invitations set status = 'Superseded' where id = $1`, [pending.id]);
  }
  const token = crypto.randomBytes(24).toString('base64url');
  let invite = await one(
    `insert into invitations (clinic_id, email, name, role, token)
     values ($1, $2, $3, $4, $5) returning *`,
    [user.clinicId, email, name.trim(), role, token]
  );
  if (existing && existing.status === 'Removed') {
    // inviting a removed member re-activates them as Invited
    await q(`update users set status = 'Invited' where id = $1`, [existing.id]);
    await q(`update invitations set user_id = $1 where id = $2`, [existing.id, invite.id]);
    invite = { ...invite, user_id: existing.id };
  }
  const clinic = await one(`select name from clinics where id = $1`, [user.clinicId]);
  enqueueMail({
    to: email,
    subject: `You're invited to ${clinic.name} on Roundbook`,
    text: `Hello ${name.trim()},\n\nYou have been invited to join ${clinic.name} on Roundbook as ${roleLabel(role)}.\n\nSet your password here: ${publicOrigin(req)}/invite/${token}\n`,
    clinicId: user.clinicId,
    kind: 'invitation',
  });
  return {
    status: 201,
    body: { id: invite.id, email: invite.email, role: invite.role, status: 'Invited' },
  };
}));

function roleLabel(role: string): string {
  return { 'front-desk': 'Front desk', nurse: 'Nurse', vet: 'Vet', manager: 'Manager' }[role] ?? role;
}

function publicOrigin(req: express.Request): string {
  if (settings.appPublicUrl) return settings.appPublicUrl.replace(/\/$/, '');
  const host = req.headers.host || `127.0.0.1:${settings.appPublicPort ?? 4173}`;
  return `${req.protocol}://${host}`;
}

router.get('/staff', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, ['manager']);
  const r = await q(
    `select u.id, u.name, u.email, u.role, u.status from users u
     where u.clinic_id = $1 order by u.created_at`,
    [user.clinicId]
  );
  const inv = await q(
    `select i.id, i.name, i.email, i.role, 'Invited' as status from invitations i
     where i.clinic_id = $1 and i.status = 'Invited' order by i.created_at`,
    [user.clinicId]
  );
  const staff = [...r.rows, ...inv.rows];
  return { status: 200, body: { staff } };
}));

router.patch('/staff/:id', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, ['manager']);
  if (req.params.id === user.userId) throw t('own_access');
  const { role } = req.body ?? {};
  if (typeof role !== 'string' || !['front-desk', 'nurse', 'vet', 'manager'].includes(role)) {
    throw notValid('role');
  }
  const target = await one(
    `select id, name, email, status from users where id = $1 and clinic_id = $2`,
    [req.params.id, user.clinicId]
  );
  if (!target || target.status === 'Removed') throw t('not_found');
  await q(`update users set role = $1 where id = $2`, [role, req.params.id]);
  bus.pushUser(req.params.id, 'role-changed', { role });
  return {
    status: 200,
    body: { id: req.params.id, name: target.name, email: target.email, role, status: 'Active' },
  };
}));

router.delete('/staff/:id', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, ['manager']);
  if (req.params.id === user.userId) throw t('own_access');
  const target = await one(
    `select id, status from users where id = $1 and clinic_id = $2`,
    [req.params.id, user.clinicId]
  );
  if (!target || target.status === 'Removed') throw t('not_found');
  await q(`update users set status = 'Removed' where id = $1`, [req.params.id]);
  await q(`delete from sessions where user_id = $1`, [req.params.id]);
  bus.pushUser(req.params.id, 'access-removed', {});
  bus.closeClinicStreams(user.clinicId, user.userId);
  return { status: 200, body: { id: req.params.id, status: 'Removed' } };
}));

router.get('/invitations/:token', handler(async (req, res) => {
  const inv = await one(
    `select i.*, c.name as clinic_name from invitations i
     join clinics c on c.id = i.clinic_id
     where i.token = $1 and i.status = 'Invited'`,
    [req.params.token]
  );
  if (!inv) throw t('not_found');
  return {
    status: 200,
    body: { clinicName: inv.clinic_name, email: inv.email, name: inv.name },
  };
}));

router.post('/invitations/:token/accept', handler(async (req, res) => {
  const inv = await one(
    `select i.* from invitations i where i.token = $1 and i.status = 'Invited'`,
    [req.params.token]
  );
  if (!inv) throw t('not_found');
  const { password } = req.body ?? {};
  if (typeof password !== 'string' || password.length < 10) throw t('weak_password', { field: 'password' });
  const existing = await one(`select id from users where lower(email) = lower($1) and clinic_id = $2`, [inv.email, inv.clinic_id]);
  let userRow;
  if (existing) {
    const r = await q(
      `update users set password_hash = $1, status = 'Active', role = $2, name = coalesce($3, name)
       where id = $4 returning *`,
      [hash(password), inv.role, inv.name, existing.id]
    );
    userRow = r.rows[0];
  } else {
    const r = await q(
      `insert into users (clinic_id, name, email, password_hash, role, status)
       values ($1, $2, $3, $4, $5, 'Active') returning *`,
      [inv.clinic_id, inv.name ?? inv.email, inv.email, hash(password), inv.role]
    );
    userRow = r.rows[0];
  }
  await q(`update invitations set status = 'Accepted' where id = $1`, [inv.id]);
  const token = crypto.randomBytes(24).toString('base64url');
  await q(`insert into sessions (token, user_id) values ($1, $2)`, [token, userRow.id]);
  setSessionCookie(res, token);
  return { status: 200, body: { user: userPublic(userRow) } };
}));

// One-time login links (grading seed and invitations).
export async function createLoginLink(userId: string): Promise<string> {
  const token = crypto.randomBytes(24).toString('base64url');
  await q(`insert into login_links (token, user_id) values ($1, $2)`, [token, userId]);
  return token;
}

router.get('/auth/link/:token', handler(async (req, res) => {
  const next = safeLandingPath(typeof req.query.next === 'string' ? req.query.next : undefined);
  const link = await one(
    `select l.*, u.status from login_links l join users u on u.id = l.user_id
     where l.token = $1 and l.used_at is null and u.status = 'Active'`,
    [req.params.token]
  );
  if (!link) {
    res.redirect(302, '/login');
    return null;
  }
  await q(`update login_links set used_at = now() where token = $1`, [req.params.token]);
  const sessionToken = crypto.randomBytes(24).toString('base64url');
  await q(`insert into sessions (token, user_id) values ($1, $2)`, [sessionToken, link.user_id]);
  setSessionCookie(res, sessionToken);
  res.redirect(302, next);
  return null;
}));

export default router;

