import { ROLE_LABEL, ROLES, type Role } from '../shared/domain.js';
import { config } from './config.js';
import { type Db, one, pool, rows, transaction } from './db.js';
import { AppError, invalid, notFound } from './errors.js';
import { hashPassword, randomToken, route, SESSION_COOKIE, sha256, verifyPassword, type Ctx, type Staff } from './http.js';
import { landingPath } from './lib/safe-redirect.js';
import { currentSeq, publish, subscribe } from './live.js';
import { enqueueMail, flushMail } from './mail.js';
import { isId, oneOf, text } from './support.js';


const personOf = (u: Staff) => ({ id: u.id, name: u.name, role: u.role, clinic: u.clinic });

async function startSession(db: Db, ctx: Ctx, userId: string): Promise<string> {
  const token = randomToken();
  await db.query('INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)', [sha256(token), userId]);
  return ctx.setSessionCookie(token);
}

/** A one-time sign-in link for a user: the `login_url` of the grading seed. */
export async function createLoginLink(db: Db, userId: string): Promise<string> {
  const token = randomToken();
  await db.query('INSERT INTO login_links (token_hash, user_id) VALUES ($1, $2)', [sha256(token), userId]);
  return token;
}

interface StaffRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'Active' | 'Invited' | 'Removed';
}

const shapeStaff = (s: StaffRow) => ({ id: s.id, name: s.name, email: s.email, role: s.role, status: s.status });

async function staffMember(db: Db, clinicId: string, id: string): Promise<StaffRow> {
  if (!isId(id)) throw notFound();
  const found = await one<StaffRow>(db, `SELECT id, name, email, role, status FROM users WHERE id = $1 AND clinic_id = $2`, [id, clinicId]);
  if (!found || found.status === 'Removed') throw notFound();
  return found;
}

export function registerAccountRoutes(): void {
  route('POST', '/api/session', async (ctx) => {
    const body = await ctx.json();
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const found = await one<{ id: string; password_hash: string | null }>(pool, `SELECT id, password_hash FROM users WHERE lower(email) = lower($1) AND status = 'Active'`, [email]);
    if (!found || !(await verifyPassword(password, found.password_hash))) throw new AppError('invalid_credentials');
    const cookie = await startSession(pool, ctx, found.id);
    const person = (await one<{ id: string; name: string; role: Role; clinic_id: string; cname: string; slug: string }>(
      pool,
      'SELECT u.id, u.name, u.role, u.clinic_id, c.name AS cname, c.slug FROM users u JOIN clinics c ON c.id = u.clinic_id WHERE u.id = $1',
      [found.id],
    ))!;
    ctx.send(
      200,
      { user: { id: person.id, name: person.name, role: person.role, clinic: { id: person.clinic_id, name: person.cname, slug: person.slug } }, landing: landingPath(body.next) },
      { 'Set-Cookie': cookie },
    );
  });

  route('DELETE', '/api/session', async (ctx) => {
    const token = ctx.cookie(SESSION_COOKIE);
    if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
    ctx.res.writeHead(204, { 'Set-Cookie': ctx.clearSessionCookie() });
    ctx.res.end();
  });

  route('GET', '/api/me', async (ctx) => {
    ctx.send(200, personOf(await ctx.user()), { 'X-Live-Seq': String(currentSeq()) });
  });

  route('GET', '/auth/link/:token', async (ctx) => {
    const next = ctx.query.get('next');
    const used = await one<{ user_id: string }>(pool, 'UPDATE login_links SET used = true WHERE token_hash = $1 AND used = false RETURNING user_id', [sha256(ctx.params.token)]);
    if (!used) {
      ctx.redirect('/login');
      return;
    }
    const active = await one(pool, `SELECT 1 FROM users WHERE id = $1 AND status = 'Active'`, [used.user_id]);
    if (!active) {
      ctx.redirect('/login');
      return;
    }
    ctx.redirect(landingPath(next), { 'Set-Cookie': await startSession(pool, ctx, used.user_id) });
  });

  route('GET', '/api/live', async (ctx) => {
    const user = await ctx.user();
    const resume = [ctx.query.get('after'), ctx.req.headers['last-event-id']]
      .map((value) => Number(Array.isArray(value) ? value[0] : value))
      .filter((value) => Number.isInteger(value) && value >= 0);
    subscribe(user.clinicId, user.id, ctx.res, resume.length ? Math.max(...resume) : undefined);
  });

  route('GET', '/api/staff', async (ctx) => {
    const user = await ctx.user();
    ctx.allow(user, 'staff.manage');
    const list = await rows<StaffRow>(pool, 'SELECT id, name, email, role, status FROM users WHERE clinic_id = $1 ORDER BY name, id', [user.clinicId]);
    ctx.send(200, { staff: list.map(shapeStaff) });
  });

  route('POST', '/api/staff/invitations', async (ctx) => {
    const user = await ctx.user();
    ctx.allow(user, 'staff.manage');
    const body = await ctx.json();
    const email = text(body, 'email', { max: 254 });
    const name = text(body, 'name', { max: 120 });
    const role = oneOf(body, 'role', ROLES);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\u0000-\u001f\u007f]/.test(email)) throw invalid('email', 'Email');
    const made = await transaction(null, async (db) => {
      const existing = await one<{ id: string; status: string; clinic_id: string }>(db, 'SELECT id, status, clinic_id FROM users WHERE lower(email) = lower($1)', [email]);
      if (existing && (existing.status === 'Active' || existing.clinic_id !== user.clinicId)) throw new AppError('email_taken');
      const id = existing
        ? (await one<{ id: string }>(
            db,
            `UPDATE users SET clinic_id = $2, name = $3, role = $4, status = 'Invited', password_hash = NULL WHERE id = $1 RETURNING id`,
            [existing.id, user.clinicId, name, role],
          ))!.id
        : (await one<{ id: string }>(db, `INSERT INTO users (clinic_id, name, email, role, status) VALUES ($1, $2, $3, $4, 'Invited') RETURNING id`, [user.clinicId, name, email, role]))!.id;
      const token = randomToken();
      await db.query(
        `INSERT INTO invitations (token_hash, user_id) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, created_at = clock_timestamp()`,
        [sha256(token), id],
      );
      await enqueueMail(db, {
        to: email,
        subject: `You're invited to ${user.clinic.name} on Roundbook`,
        body: `Hello ${name},\n\nYou have been invited to join ${user.clinic.name} on Roundbook as ${ROLE_LABEL[role]}.\n\nSet your password here:\n${config.baseUrl}/invite/${token}\n`,
      });
      await publish(db, user.clinicId, { t: 'staff' });
      return id;
    });
    void flushMail();
    ctx.send(201, { id: made, email, role, status: 'Invited' });
  });

  route('PATCH', '/api/staff/:id', async (ctx) => {
    const user = await ctx.user();
    const target = await staffMember(pool, user.clinicId, ctx.params.id);
    ctx.allow(user, 'staff.manage');
    if (target.id === user.id) throw new AppError('own_access');
    const role = oneOf(await ctx.json(), 'role', ROLES);
    const updated = await transaction(user.clinicId, async (db) => {
      await db.query('UPDATE users SET role = $2 WHERE id = $1', [target.id, role]);
      await publish(db, user.clinicId, { t: 'role', userId: target.id });
      await publish(db, user.clinicId, { t: 'staff' });
      return staffMember(db, user.clinicId, target.id);
    });
    ctx.send(200, shapeStaff(updated));
  });

  route('DELETE', '/api/staff/:id', async (ctx) => {
    const user = await ctx.user();
    const target = await staffMember(pool, user.clinicId, ctx.params.id);
    ctx.allow(user, 'staff.manage');
    if (target.id === user.id) throw new AppError('own_access');
    await transaction(user.clinicId, async (db) => {
      await db.query(`UPDATE users SET status = 'Removed', password_hash = NULL WHERE id = $1`, [target.id]);
      await db.query('DELETE FROM sessions WHERE user_id = $1', [target.id]);
      await db.query('DELETE FROM invitations WHERE user_id = $1', [target.id]);
      await publish(db, user.clinicId, { t: 'removed', userId: target.id });
      await publish(db, user.clinicId, { t: 'staff' });
    });
    ctx.send(200, { id: target.id, status: 'Removed' });
  });

  route('GET', '/api/invitations/:token', async (ctx) => {
    const found = await invitation(pool, ctx.params.token);
    ctx.send(200, { clinicName: found.clinic_name, email: found.email, name: found.name });
  });

  route('POST', '/api/invitations/:token/accept', async (ctx) => {
    const found = await invitation(pool, ctx.params.token);
    const body = await ctx.json();
    const password = typeof body.password === 'string' ? body.password : '';
    if ([...password].length < 10) throw new AppError('weak_password', undefined, 'password');
    const hash = await hashPassword(password);
    const cookie = await transaction(found.clinic_id, async (db) => {
      const consumed = await one(db, 'DELETE FROM invitations WHERE token_hash = $1 RETURNING 1 AS ok', [sha256(ctx.params.token)]);
      if (!consumed) throw notFound();
      await db.query(`UPDATE users SET password_hash = $2, status = 'Active' WHERE id = $1`, [found.user_id, hash]);
      await publish(db, found.clinic_id, { t: 'staff' });
      return startSession(db, ctx, found.user_id);
    });
    ctx.send(200, { user: { id: found.user_id, name: found.name, role: found.role, clinic: { id: found.clinic_id, name: found.clinic_name, slug: found.slug } } }, { 'Set-Cookie': cookie });
  });
}

async function invitation(db: Db, token: string) {
  const found = await one<{ user_id: string; name: string; email: string; role: Role; clinic_id: string; clinic_name: string; slug: string }>(
    db,
    `SELECT u.id AS user_id, u.name, u.email, u.role, u.clinic_id, c.name AS clinic_name, c.slug
       FROM invitations i JOIN users u ON u.id = i.user_id JOIN clinics c ON c.id = u.clinic_id
      WHERE i.token_hash = $1 AND u.status = 'Invited'`,
    [sha256(token)],
  );
  if (!found) throw notFound();
  return found;
}

