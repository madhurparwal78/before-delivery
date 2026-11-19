import { ApiError, asString, parseCookies, readJsonBody, sendJson, sendNoContent, sessionCookie } from '../http.js';
import { DEFAULT_WORLD, query, queryOne } from '../db.js';
import { endAuthSession, hashPassword, startTeacherSession, verifyPassword } from '../auth.js';
import { newId } from '../ids.js';
import { requireViewer } from '../access.js';
import type { Router } from '../router.js';

const emailPattern = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function accountRoutes(router: Router): void {
  router.add('POST', '/api/teachers', async ({ req, res }) => {
    const body = await readJsonBody(req);
    const email = asString(body.email).trim();
    const password = asString(body.password);
    const displayName = asString(body.displayName).trim();
    if (!emailPattern.test(email)) throw new ApiError(422, 'Enter a valid email address.');
    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM teachers WHERE world_id = $1 AND email_lower = $2',
      [DEFAULT_WORLD, email.toLowerCase()]
    );
    if (existing !== null) throw new ApiError(409, 'An account with that email already exists.');
    if (password.length < 10) throw new ApiError(422, 'Use at least 10 characters for your password.');
    if (displayName.length < 1 || displayName.length > 60) throw new ApiError(422, 'Enter a name of 1 to 60 characters.');

    const id = newId('tch');
    await query(
      `INSERT INTO teachers (id, world_id, email, email_lower, password_hash, display_name)
         VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, DEFAULT_WORLD, email, email.toLowerCase(), await hashPassword(password), displayName]
    );
    const token = await startTeacherSession(id);
    res.setHeader('set-cookie', sessionCookie(token));
    sendJson(res, 201, { id, email, displayName });
  });

  router.add('POST', '/api/sign-in', async ({ req, res }) => {
    const body = await readJsonBody(req);
    const email = asString(body.email).trim().toLowerCase();
    const password = asString(body.password);
    const candidates = await query<{ id: string; email: string; display_name: string; password_hash: string }>(
      `SELECT id, email, display_name, password_hash FROM teachers
        WHERE email_lower = $1 ORDER BY created_at DESC`,
      [email]
    );
    for (const candidate of candidates) {
      if (await verifyPassword(password, candidate.password_hash)) {
        const token = await startTeacherSession(candidate.id);
        res.setHeader('set-cookie', sessionCookie(token));
        sendJson(res, 200, { id: candidate.id, email: candidate.email, displayName: candidate.display_name });
        return;
      }
    }
    throw new ApiError(401, 'Email or password is wrong.');
  });

  router.add('POST', '/api/sign-out', async ({ req, res }) => {
    const token = parseCookies(req.headers.cookie).get('slatehall_session');
    if (token !== undefined) await endAuthSession(token);
    res.setHeader('set-cookie', 'slatehall_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    sendNoContent(res);
  });

  router.add('GET', '/api/me', async ({ res, viewer }) => {
    const signedIn = requireViewer(viewer);
    if (signedIn.kind === 'teacher') {
      sendJson(res, 200, {
        role: 'teacher',
        id: signedIn.id,
        email: signedIn.email,
        displayName: signedIn.displayName
      });
      return;
    }
    sendJson(res, 200, { role: 'learner', id: signedIn.id, displayName: signedIn.displayName });
  });
}
