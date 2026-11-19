import { Router } from 'express';
import { query, withTx } from './db';
import { readBody, BODY_MAX, AuthedRequest, GRADING_MAX } from './apiutil';
import { requireAuth, startSession, endSession, personFromCookie } from './auth';
import { hashPassword, verifyPassword, sixDigitCode, token } from './passwords';
import { createMailer, verificationMail } from './mailer';
import { publish } from './live';
import { todayYMD, now } from './clock';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function authRouter(mailer: ReturnType<typeof createMailer>): Router {
  const r = Router();

  r.post('/api/signup', readBody(BODY_MAX), async (req, res) => {
    const body = req.body as { name?: unknown; email?: unknown; password?: unknown };
    const errors: Record<string, string> = {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!name) errors.name = 'Enter your name';
    if (!email || !EMAIL_RE.test(email)) errors.email = 'Enter an email address like name@example.com';
    if (password.length < 8) errors.password = 'Use at least 8 characters';
    if (Object.keys(errors).length > 0) { res.status(422).json({ errors }); return; }
    const existing = (await query<{ id: string }>(`SELECT id FROM people WHERE email = $1`, [email])).rows[0];
    if (existing) { res.status(422).json({ errors: { email: 'That email already has an account' } }); return; }
    const code = sixDigitCode();
    const ins = await query<{ id: string }>(
      `INSERT INTO people (name, email, password_hash, verified, verify_code) VALUES ($1,$2,$3,false,$4) RETURNING id`,
      [name, email, hashPassword(password), code]);
    try {
      const mail = verificationMail({ email, code });
      await mailer.sendMail({ to: email, subject: mail.subject, text: mail.text, html: mail.html });
    } catch {
      // mail service down: the account exists; verification can be retried
    }
    res.status(201).json({ id: ins.rows[0].id, email, verified: false });
  });

  r.post('/api/verify', readBody(BODY_MAX), async (req, res) => {
    const body = req.body as { email?: unknown; code?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const person = (await query<{ id: string; verify_code: string | null }>(
      `SELECT id, verify_code FROM people WHERE email = $1`, [email])).rows[0];
    if (!person) { res.status(404).json({ error: 'not_found' }); return; }
    if (person.verify_code !== code) { res.status(422).json({ errors: { code: 'That code is not right' } }); return; }
    await query(`UPDATE people SET verified = true, verify_code = NULL WHERE id = $1`, [person.id]);
    res.json({ verified: true });
  });

  r.post('/api/signin', readBody(BODY_MAX), async (req, res) => {
    const body = req.body as { email?: unknown; password?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const person = (await query<{ id: string; name: string; email: string; password_hash: string }>(
      `SELECT * FROM people WHERE email = $1`, [email])).rows[0];
    if (!person || !verifyPassword(password, person.password_hash)) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }
    await startSession(res, person.id);
    res.json({ id: person.id, name: person.name, email: person.email });
  });

  r.post('/api/signout', readBody(BODY_MAX), async (req, res) => {
    await endSession(req, res);
    res.status(204).end();
  });

  r.get('/api/me', requireAuth(), async (req, res) => {
    const ar = req as AuthedRequest;
    const p = await personFromCookie(req);
    const person = (await query<{ id: string; name: string; email: string; verified: boolean }>(
      `SELECT id, name, email, verified FROM people WHERE id = $1`, [ar.personId])).rows[0];
    const teams = await query<{ id: string; name: string; role: string }>(
      `SELECT t.id, t.name, tm.role FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.person_id = $1`, [ar.personId]);
    res.json({
      id: person.id, name: person.name, email: person.email, verified: person.verified,
      teams: teams.rows.map(t => ({ id: t.id, name: t.name, role: t.role })),
    });
    void p;
  });

  r.post('/api/teams/join', requireAuth(), readBody(BODY_MAX), async (req, res) => {
    const ar = req as AuthedRequest;
    const body = req.body as { code?: unknown };
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    const person = (await query<{ verified: boolean }>(`SELECT verified FROM people WHERE id = $1`, [ar.personId])).rows[0];
    if (!person?.verified) { res.status(403).json({ error: 'not_verified' }); return; }
    const team = (await query<{ id: string; name: string }>(`SELECT id, name FROM teams WHERE join_code = $1`, [code])).rows[0];
    if (!team) { res.status(404).json({ error: 'not_found' }); return; }
    await query(
      `INSERT INTO team_members (team_id, person_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING`,
      [team.id, ar.personId]);
    publish({ teamIds: [team.id], kind: 'team', at: new Date().toISOString(), data: { teamId: team.id } });
    res.json({ teamId: team.id, name: team.name });
  });

  return r;
}
