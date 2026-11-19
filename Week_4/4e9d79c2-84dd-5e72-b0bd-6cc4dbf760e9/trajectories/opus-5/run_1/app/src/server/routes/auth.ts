import { Route, jsonBody, route } from './router.js';
import { AppError, conflict, invalid } from '../errors.js';
import { copy } from '../copy.js';
import { isEmailAddress } from '../../domain/text.js';
import { instantString, ukDateOf, ukTimeOf } from '../../domain/time.js';
import {
  endOtherSessions,
  endSession,
  findDeskByEmail,
  makeDesk,
  passwordMatches,
  hashPassword,
  requireDesk,
  startSession,
} from '../session.js';
import { query } from '../db.js';
import { makeDefaultRateTable } from '../data/rates.js';

export const authRoutes: Route[] = [
  route('GET', '/api/health', 'public', async (ctx) => {
    ctx.json(200, { status: 'ok' });
  }),

  route('GET', '/api/public/clock', 'public', async (ctx) => {
    const now = Date.now();
    ctx.json(200, { date: ukDateOf(now), time: ukTimeOf(now), instant: instantString(now) });
  }),

  route('POST', '/api/auth/sign-up', 'public', async (ctx) => {
    const body = await jsonBody(ctx);
    const fields: Record<string, string> = {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name === '') fields.name = 'Enter a desk name.';
    if (!isEmailAddress(body.email)) fields.email = copy.enterEmail;
    const password = typeof body.password === 'string' ? body.password : '';
    if ([...password].length < 8) fields.password = 'Use a password of at least 8 characters.';
    if (Object.keys(fields).length > 0) {
      throw new AppError(422, 'invalidFields', Object.values(fields)[0], { fields });
    }
    const email = (body.email as string).trim();
    if (await findDeskByEmail(email)) throw conflict('emailTaken', 'That email already has a desk.');
    const desk = await makeDesk(name, email, password);
    await makeDefaultRateTable(desk.id);
    await startSession(ctx, desk.id);
    ctx.json(201, { desk });
  }),

  route('POST', '/api/auth/sign-in', 'public', async (ctx) => {
    const body = await jsonBody(ctx);
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const desk = await findDeskByEmail(email);
    if (!desk || !(await passwordMatches(password, desk.password_hash))) {
      throw new AppError(401, 'wrongPassword', copy.wrongSignIn);
    }
    await startSession(ctx, desk.id);
    ctx.json(200, { desk: { id: desk.id, name: desk.name, email: desk.email } });
  }),

  route('POST', '/api/auth/sign-out', 'session', async (ctx) => {
    if (ctx.sessionId) await endSession(ctx.sessionId);
    ctx.clearCookie();
    ctx.send(204, '');
  }),

  route('GET', '/api/auth/session', 'session', async (ctx) => {
    ctx.json(200, { desk: requireDesk(ctx) });
  }),

  route('POST', '/api/auth/password', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const body = await jsonBody(ctx);
    const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const fresh = typeof body.newPassword === 'string' ? body.newPassword : '';
    if ([...fresh].length < 8) {
      throw invalid('Use a password of at least 8 characters.', {
        newPassword: 'Use a password of at least 8 characters.',
      });
    }
    const stored = await findDeskByEmail(desk.email);
    if (!stored || !(await passwordMatches(current, stored.password_hash))) {
      throw new AppError(401, 'wrongPassword', copy.wrongSignIn);
    }
    await query('update desks set password_hash = $2 where id = $1', [desk.id, await hashPassword(fresh)]);
    if (ctx.sessionId) await endOtherSessions(desk.id, ctx.sessionId);
    ctx.send(204, '');
  }),
];
