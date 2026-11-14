import { config, timers } from '../config.js';
import {
  checkPassword,
  clearCookie,
  COOKIE,
  hashPassword,
  newToken,
  requireInstructor,
  requireUser,
  schoolOf,
  startSession,
  type User,
} from '../auth.js';
import { newId, one, query } from '../db.js';
import { ApiError, fieldErrors, notFound, ok, type Router, str } from '../http.js';
import { sendMailOrUnavailable } from '../mail.js';

const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

function isDate(text: string): boolean {
  if (!DATE.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function passwordError(password: string): string | null {
  return password.length >= 10 ? null : 'Password must be at least 10 characters.';
}

async function sendVerification(user: { id: string; email: string }): Promise<void> {
  const token = newToken();
  await query('INSERT INTO verify_tokens (token, user_id) VALUES ($1, $2)', [token, user.id]);
  try {
    await sendMailOrUnavailable(
      user.email,
      'Verify your Runup Bay email',
      `Open this link to verify your email:\n\n${config.publicUrl}/verify?token=${token}\n`,
    );
  } catch (error) {
    await query('DELETE FROM verify_tokens WHERE token = $1', [token]);
    throw error;
  }
}

export async function createInvitation(classId: string, email: string, sentAt: Date, used = false): Promise<string> {
  const token = newToken();
  await query('INSERT INTO invitations (token, class_id, email, sent_at, used) VALUES ($1, $2, $3, $4, $5)', [
    token,
    classId,
    email,
    sentAt,
    used,
  ]);
  return token;
}

export const inviteUrl = (token: string) => `${config.publicUrl}/invite/${token}`;

interface ClassRow {
  id: string;
  school_id: string;
  name: string;
}

async function classAccess(user: User, classId: string): Promise<{ cls: ClassRow; instructor: boolean }> {
  const cls = await one<ClassRow>('SELECT id, school_id, name FROM classes WHERE id = $1', [classId]);
  if (!cls) throw notFound();
  const school = await schoolOf(user.id);
  if (school && school.id === cls.school_id) return { cls, instructor: true };
  const member = await one('SELECT 1 FROM class_students WHERE class_id = $1 AND user_id = $2', [classId, user.id]);
  if (!member) throw notFound();
  return { cls, instructor: false };
}

async function meView(user: User) {
  const school = await schoolOf(user.id);
  const classes = school
    ? await query<{ id: string; name: string }>('SELECT id, name FROM classes WHERE school_id = $1 ORDER BY seq', [school.id])
    : await query<{ id: string; name: string }>(
        'SELECT c.id, c.name FROM class_students cs JOIN classes c ON c.id = cs.class_id WHERE cs.user_id = $1 ORDER BY c.seq',
        [user.id],
      );
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    reduceMotion: user.reduce_motion,
    school: school ? { id: school.id, name: school.name } : null,
    classes,
  };
}

interface InvitationRow {
  token: string;
  class_id: string;
  email: string;
  sent_at: Date;
  used: boolean;
  class_name: string;
}

async function liveInvitation(token: string): Promise<InvitationRow> {
  const invitation = await one<InvitationRow>(
    'SELECT i.*, c.name AS class_name FROM invitations i JOIN classes c ON c.id = i.class_id WHERE i.token = $1',
    [token],
  );
  if (!invitation) throw notFound();
  if (invitation.used) {
    throw new ApiError(410, { error: 'invite_used', message: 'This invitation has already been used.' });
  }
  if (Date.now() - new Date(invitation.sent_at).getTime() > timers.inviteTtlHours * 3600_000) {
    throw new ApiError(410, {
      error: 'invite_expired',
      message: 'This invitation is out of date. Please request a fresh one from your instructor.',
    });
  }
  return invitation;
}

function throwIfAny(errors: Record<string, string>): void {
  if (Object.keys(errors).length > 0) throw fieldErrors(errors);
}

export function registerAccountRoutes(router: Router): void {
  router.add('POST', '/api/signup', async (ctx) => {
    const body = await ctx.json();
    const name = str(body, 'name').trim();
    const email = normaliseEmail(str(body, 'email'));
    const password = str(body, 'password');
    const errors: Record<string, string> = {};
    if (!name) errors.name = 'Enter your name.';
    if (!EMAIL.test(email)) errors.email = 'Enter a valid email address.';
    const pwError = passwordError(password);
    if (pwError) errors.password = pwError;
    const existing = await one<User>('SELECT * FROM users WHERE email = $1', [email]);
    if (!errors.email && existing?.verified) errors.email = 'This email is already registered.';
    throwIfAny(errors);
    const hash = await hashPassword(password);
    if (existing) {
      await sendVerification(existing);
      await query('UPDATE users SET name = $2, password_hash = $3 WHERE id = $1', [existing.id, name, hash]);
      return ok({ id: existing.id }, 201);
    }
    const id = newId();
    await query('INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)', [id, email, name, hash]);
    try {
      await sendVerification({ id, email });
    } catch (error) {
      await query('DELETE FROM users WHERE id = $1', [id]);
      throw error;
    }
    return ok({ id }, 201);
  });

  router.add('POST', '/api/verify', async (ctx) => {
    const body = await ctx.json();
    const row = await one<{ user_id: string; created_at: Date }>('SELECT * FROM verify_tokens WHERE token = $1', [
      str(body, 'token'),
    ]);
    if (!row) throw notFound();
    if (Date.now() - new Date(row.created_at).getTime() > timers.verifyTtlHours * 3600_000) {
      throw new ApiError(410, { error: 'verify_expired', message: 'This verification link has expired.' });
    }
    await query('UPDATE users SET verified = true WHERE id = $1', [row.user_id]);
    return ok({ verified: true });
  });

  router.add('POST', '/api/session', async (ctx) => {
    const body = await ctx.json();
    const user = await one<User>('SELECT * FROM users WHERE email = $1', [normaliseEmail(str(body, 'email'))]);
    if (!user || !(await checkPassword(str(body, 'password'), user.password_hash))) {
      throw new ApiError(401, { error: 'invalid_credentials', message: 'Email or password is incorrect.' });
    }
    if (!user.verified) throw new ApiError(401, { error: 'unverified', message: 'Verify your email first.' });
    const cookie = await startSession(user.id);
    return { status: 200, json: { id: user.id, name: user.name, email: user.email }, headers: { 'Set-Cookie': cookie } };
  });

  router.add('DELETE', '/api/session', async (ctx) => {
    await requireUser(ctx);
    await query('DELETE FROM auth_sessions WHERE token = $1', [ctx.cookies[COOKIE]]);
    return { status: 204, headers: { 'Set-Cookie': clearCookie } };
  });

  router.add('GET', '/api/me', async (ctx) => ok(await meView(await requireUser(ctx))));

  router.add('PATCH', '/api/me', async (ctx) => {
    const user = await requireUser(ctx);
    const body = await ctx.json();
    const errors: Record<string, string> = {};
    if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) errors.name = 'Enter your name.';
    const wantsPassword = typeof body.newPassword === 'string' && body.newPassword !== '';
    if (wantsPassword) {
      const pwError = passwordError(str(body, 'newPassword'));
      if (pwError) errors.newPassword = pwError;
      if (!(await checkPassword(str(body, 'currentPassword'), user.password_hash))) {
        errors.currentPassword = 'Current password is incorrect.';
      }
    }
    if (body.reduceMotion !== undefined && typeof body.reduceMotion !== 'boolean') errors.reduceMotion = 'Choose on or off.';
    throwIfAny(errors);
    if (typeof body.name === 'string') await query('UPDATE users SET name = $2 WHERE id = $1', [user.id, body.name.trim()]);
    if (wantsPassword) {
      await query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, await hashPassword(str(body, 'newPassword'))]);
    }
    if (typeof body.reduceMotion === 'boolean') {
      await query('UPDATE users SET reduce_motion = $2 WHERE id = $1', [user.id, body.reduceMotion]);
    }
    return ok(await meView((await one<User>('SELECT * FROM users WHERE id = $1', [user.id]))!));
  });

  router.add('POST', '/api/schools', async (ctx) => {
    const user = await requireUser(ctx);
    const member = await one('SELECT 1 FROM class_students WHERE user_id = $1', [user.id]);
    if (member) throw notFound();
    const body = await ctx.json();
    if (await schoolOf(user.id)) throw new ApiError(409, { error: 'school_exists', message: 'You already have a school.' });
    const name = str(body, 'name').trim();
    if (!name) throw fieldErrors({ name: 'Enter a school name.' });
    const id = newId();
    await query('INSERT INTO schools (id, name, instructor_id) VALUES ($1, $2, $3)', [id, name, user.id]);
    return ok({ id, name }, 201);
  });

  router.add('POST', '/api/classes', async (ctx) => {
    const { school } = await requireInstructor(ctx);
    const name = str(await ctx.json(), 'name').trim();
    if (!name) throw fieldErrors({ name: 'Enter a class name.' });
    const id = newId();
    await query('INSERT INTO classes (id, school_id, name) VALUES ($1, $2, $3)', [id, school.id, name]);
    return ok({ id, name }, 201);
  });

  router.add('GET', '/api/classes/:id', async (ctx) => {
    const user = await requireUser(ctx);
    const { cls, instructor } = await classAccess(user, ctx.params.id!);
    const students = await query<{ id: string; name: string; email: string }>(
      'SELECT u.id, u.name, u.email FROM class_students cs JOIN users u ON u.id = cs.user_id WHERE cs.class_id = $1 ORDER BY cs.seq',
      [cls.id],
    );
    const assignments = await query<{
      id: string;
      scenario_id: string;
      scenario_name: string;
      due_on: string;
      session_id: string | null;
    }>(
      `SELECT a.id, a.scenario_id, s.data->>'name' AS scenario_name, a.due_on,
        (SELECT ss.id FROM sim_sessions ss WHERE ss.assignment_id = a.id AND ss.status <> 'ended' ORDER BY ss.seq DESC LIMIT 1) AS session_id
       FROM assignments a JOIN scenarios s ON s.id = a.scenario_id WHERE a.class_id = $1 ORDER BY a.seq`,
      [cls.id],
    );
    const invitations = instructor
      ? await query<{ email: string; used: boolean }>('SELECT email, used FROM invitations WHERE class_id = $1 ORDER BY seq', [
          cls.id,
        ])
      : [];
    return ok({
      id: cls.id,
      name: cls.name,
      instructor,
      students: instructor ? students : students.map(({ id, name }) => ({ id, name })),
      invitations: invitations.map((row) => ({ email: row.email, status: row.used ? 'used' : 'pending' })),
      assignments: assignments.map((row) => ({
        id: row.id,
        scenario: row.scenario_id,
        scenarioName: row.scenario_name,
        dueOn: row.due_on,
        sessionId: row.session_id,
      })),
    });
  });

  router.add('POST', '/api/classes/:id/invitations', async (ctx) => {
    const user = await requireUser(ctx);
    const { cls, instructor } = await classAccess(user, ctx.params.id!);
    if (!instructor) throw notFound();
    const body = await ctx.json();
    const raw: unknown[] = Array.isArray(body.emails) ? body.emails : [];
    const emails = [
      ...new Set(
        raw
          .filter((email): email is string => typeof email === 'string')
          .map(normaliseEmail)
          .filter(Boolean),
      ),
    ];
    if (emails.length === 0) throw fieldErrors({ emails: 'Enter at least one email address.' });
    const invalid = emails.filter((email) => !EMAIL.test(email));
    if (invalid.length > 0) throw fieldErrors({ emails: `Check these addresses: ${invalid.join(', ')}` });
    const sent: string[] = [];
    for (const email of emails) {
      const token = await createInvitation(cls.id, email, new Date());
      try {
        await sendMailOrUnavailable(
          email,
          `Join ${cls.name} on Runup Bay`,
          `You are invited to join ${cls.name} on Runup Bay.\n\n${inviteUrl(token)}\n`,
        );
      } catch (error) {
        await query('DELETE FROM invitations WHERE token = $1', [token]);
        throw error;
      }
      sent.push(email);
    }
    return ok({ sent }, 201);
  });

  router.add('GET', '/api/invitations/:token', async (ctx) => {
    const invitation = await liveInvitation(ctx.params.token!);
    return ok({ class: invitation.class_name, email: invitation.email });
  });

  router.add('POST', '/api/invitations/:token/accept', async (ctx) => {
    const invitation = await liveInvitation(ctx.params.token!);
    const body = await ctx.json();
    const password = str(body, 'password');
    let user = await one<User>('SELECT * FROM users WHERE email = $1', [invitation.email]);
    if (user) {
      if (!(await checkPassword(password, user.password_hash))) {
        throw new ApiError(401, { error: 'invalid_credentials', message: 'Email or password is incorrect.' });
      }
      await query('UPDATE users SET verified = true WHERE id = $1', [user.id]);
    } else {
      const name = str(body, 'name').trim();
      const errors: Record<string, string> = {};
      if (!name) errors.name = 'Enter your name.';
      const pwError = passwordError(password);
      if (pwError) errors.password = pwError;
      throwIfAny(errors);
      const id = newId();
      await query('INSERT INTO users (id, email, name, password_hash, verified) VALUES ($1, $2, $3, $4, true)', [
        id,
        invitation.email,
        name,
        await hashPassword(password),
      ]);
      user = (await one<User>('SELECT * FROM users WHERE id = $1', [id]))!;
    }
    await query('INSERT INTO class_students (class_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
      invitation.class_id,
      user.id,
    ]);
    await query('UPDATE invitations SET used = true WHERE token = $1', [invitation.token]);
    const cookie = await startSession(user.id);
    return { status: 200, json: { classId: invitation.class_id }, headers: { 'Set-Cookie': cookie } };
  });

  router.add('POST', '/api/classes/:id/assignments', async (ctx) => {
    const user = await requireUser(ctx);
    const { cls, instructor } = await classAccess(user, ctx.params.id!);
    if (!instructor) throw notFound();
    const body = await ctx.json();
    const scenarioId = str(body, 'scenario');
    const dueOn = str(body, 'dueOn').trim();
    if (scenarioId) {
      const scenario = await one('SELECT 1 FROM scenarios WHERE id = $1 AND school_id = $2', [scenarioId, cls.school_id]);
      if (!scenario) throw notFound();
    }
    const errors: Record<string, string> = {};
    if (!scenarioId) errors.scenario = 'Choose a scenario.';
    if (!isDate(dueOn)) errors.dueOn = 'Enter a date as YYYY-MM-DD.';
    throwIfAny(errors);
    const id = newId();
    await query('INSERT INTO assignments (id, class_id, scenario_id, due_on) VALUES ($1, $2, $3, $4)', [
      id,
      cls.id,
      scenarioId,
      dueOn,
    ]);
    return ok({ id }, 201);
  });
}
