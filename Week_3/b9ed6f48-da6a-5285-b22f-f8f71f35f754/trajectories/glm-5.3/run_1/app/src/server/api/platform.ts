import type { App, User } from './app.ts';
import { createSignin, destroySignin, userForToken, recordAction } from './app.ts';
import type { RouteContext } from './http.ts';
import { ApiError, sendJson, sendNoContent, validationFailed } from './http.ts';
import { PocketBaseUnavailable } from '../services/pocketbase.ts';
import { FIELDS } from '../core/copy.ts';
import { validKey, begin, finish, release } from '../core/idempotency.ts';

export function registerPlatformRoutes(app: App, route: (method: string, path: string, handler: (ctx: RouteContext) => Promise<void>) => void): void {
  route('POST', '/api/auth/register', async (ctx) => {
    const body = await readJsonBody(ctx);
    const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
    const email = typeof body['email'] === 'string' ? body['email'].trim().toLowerCase() : '';
    const password = typeof body['password'] === 'string' ? body['password'] : '';
    const fields: Record<string, string> = {};
    if (name.length < 1 || name.length > 120) fields['name'] = FIELDS.name;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields['email'] = FIELDS.email;
    if (password.length < 10 || password.length > 72) fields['password'] = FIELDS.password;
    if (Object.keys(fields).length) throw validationFailed(fields);
    let user: User;
    try {
      user = await app.pb.createUser(name, email, password);
    } catch (e) {
      if (e instanceof PocketBaseUnavailable) throw new ApiError(503, 'accounts_unavailable');
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('email_taken')) {
        throw new ApiError(409, 'email_taken', { email: FIELDS.email });
      }
      if (msg.includes('password')) {
        throw validationFailed({ password: FIELDS.password });
      }
      throw validationFailed({ email: FIELDS.email });
    }
    const token = await createSignin(app, user.id);
    ctx.setCookie(`sl_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
    sendJson(ctx.res, 201, { user: publicUser(user) });
  });

  route('POST', '/api/auth/login', async (ctx) => {
    const body = await readJsonBody(ctx);
    const email = typeof body['email'] === 'string' ? body['email'].trim().toLowerCase() : '';
    const password = typeof body['password'] === 'string' ? body['password'] : '';
    if (!email || !password) throw new ApiError(401, 'invalid_credentials');
    let user: User | null;
    try {
      user = await app.pb.authUser(email, password);
    } catch {
      throw new ApiError(503, 'accounts_unavailable');
    }
    if (!user) throw new ApiError(401, 'invalid_credentials');
    const token = await createSignin(app, user.id);
    ctx.setCookie(`sl_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
    sendJson(ctx.res, 200, { user: publicUser(user) });
  });

  route('POST', '/api/auth/logout', async (ctx) => {
    await destroySignin(app, ctx.cookies['sl_session']);
    ctx.setCookie('sl_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    sendNoContent(ctx.res);
  });

  route('GET', '/api/me', async (ctx) => {
    const user = await requireUser(ctx, app);
    let prefs: { motion: boolean; sound: boolean };
    try {
      const stored = await app.pb.getPreferences(user.id);
      prefs = stored ?? { motion: true, sound: false };
    } catch {
      throw new ApiError(503, 'accounts_unavailable');
    }
    sendJson(ctx.res, 200, { user: publicUser(user), preferences: prefs });
  });

  route('PUT', '/api/me/preferences', async (ctx) => {
    const user = await requireUser(ctx, app);
    const body = await readJsonBody(ctx);
    if (typeof body['motion'] !== 'boolean' || typeof body['sound'] !== 'boolean') {
      throw validationFailed({ motion: 'Check the highlighted fields.', sound: 'Check the highlighted fields.' });
    }
    let prefs: { motion: boolean; sound: boolean };
    try {
      prefs = await app.pb.setPreferences(user.id, body['motion'], body['sound']);
    } catch {
      throw new ApiError(503, 'accounts_unavailable');
    }
    sendJson(ctx.res, 200, { preferences: prefs });
  });

  route('GET', '/api/me/path', async (ctx) => {
    const user = await requireUser(ctx, app);
    let path: { resolved: number[]; last_chapter: number | null; last_exhibit: string };
    try {
      const stored = await app.pb.getSavedPath(user.id);
      path = stored ?? { resolved: [], last_chapter: null, last_exhibit: '' };
    } catch {
      throw new ApiError(503, 'accounts_unavailable');
    }
    sendJson(ctx.res, 200, { path: filterWithdrawnPath(path) });
  });

  route('POST', '/api/me/path/resolved', async (ctx) => {
    const user = await requireUser(ctx, app);
    const body = await readJsonBody(ctx);
    const chapter = body['chapter'];
    if (typeof chapter !== 'number' || !Number.isInteger(chapter) || chapter < 1 || chapter > 8) {
      throw new ApiError(404, 'not_found');
    }
    const res = await app.pool.query(
      `SELECT number FROM chapters WHERE number = $1 AND status = 'published'`,
      [chapter],
    );
    if (!res.rows.length) throw new ApiError(404, 'not_found');
    let stored: { resolved: number[]; last_chapter: number | null; last_exhibit: string };
    try {
      const existing = await app.pb.getSavedPath(user.id);
      const resolved = new Set([...(existing?.resolved ?? []), chapter]);
      stored = await app.pb.upsertSavedPath(user.id, { resolved: [...resolved].sort((a, b) => a - b) });
    } catch {
      throw new ApiError(503, 'accounts_unavailable');
    }
    sendJson(ctx.res, 200, { path: filterWithdrawnPath(stored) });
  });

  route('PUT', '/api/me/path/position', async (ctx) => {
    const user = await requireUser(ctx, app);
    const body = await readJsonBody(ctx);
    const chapter = body['chapter'];
    const exhibit = body['exhibit'];
    if (typeof chapter !== 'number' || !Number.isInteger(chapter)) {
      throw validationFailed({ chapter: 'Check the highlighted fields.' });
    }
    const res = await app.pool.query(`SELECT exhibit, status FROM chapters WHERE number = $1`, [chapter]);
    if (!res.rows.length || res.rows[0]!['status'] !== 'published') throw new ApiError(404, 'not_found');
    const chapterExhibit = res.rows[0]!['exhibit'];
    if (exhibit !== '' && exhibit !== chapterExhibit) {
      throw validationFailed({ exhibit: 'Check the highlighted fields.' });
    }
    let stored: { resolved: number[]; last_chapter: number | null; last_exhibit: string };
    try {
      stored = await app.pb.upsertSavedPath(user.id, { last_chapter: chapter, last_exhibit: String(exhibit ?? '') });
    } catch {
      throw new ApiError(503, 'accounts_unavailable');
    }
    sendJson(ctx.res, 200, { path: filterWithdrawnPath(stored) });
  });

  route('GET', '/api/me/bookmarks', async (ctx) => {
    const user = await requireUser(ctx, app);
    let records: Array<{ id: string; target_type: string; target_id: string; created: string }>;
    try {
      records = await app.pb.listBookmarks(user.id) as never;
    } catch {
      throw new ApiError(503, 'accounts_unavailable');
    }
    const bookmarks = [];
    for (const r of records) {
      const title = await bookmarkTitle(app, r.target_type, r.target_id);
      if (title === null) continue; // withdrawn items disappear from bookmark lists
      bookmarks.push({ id: r.id, target_type: r.target_type, target_id: r.target_id, title });
    }
    sendJson(ctx.res, 200, { bookmarks });
  });

  route('POST', '/api/me/bookmarks', async (ctx) => {
    const user = await requireUser(ctx, app);
    const body = await readJsonBody(ctx);
    const targetType = body['target_type'];
    const targetId = body['target_id'];
    if (targetType !== 'chapter' && targetType !== 'event') throw new ApiError(404, 'not_found');
    if (typeof targetId !== 'string') throw new ApiError(404, 'not_found');
    const title = await bookmarkTitle(app, targetType, targetId);
    if (title === null) throw new ApiError(404, 'not_found');
    let record: { id: string };
    let created = true;
    try {
      const existing = await app.pb.listBookmarks(user.id);
      const found = existing.find((b) => String(b['target_id']) === targetId);
      if (found) {
        record = { id: String(found['id']) };
        created = false;
      } else {
        const fresh = await app.pb.createBookmark(user.id, targetType, targetId);
        record = { id: String(fresh['id']) };
      }
    } catch {
      throw new ApiError(503, 'accounts_unavailable');
    }
    sendJson(ctx.res, created ? 201 : 200, { bookmark: { id: record.id, target_type: targetType, target_id: targetId, title } });
  });

  route('DELETE', '/api/me/bookmarks/:id', async (ctx) => {
    const user = await requireUser(ctx, app);
    const id = ctx.path.split('/').pop() ?? '';
    let deleted: boolean;
    try {
      deleted = await app.pb.deleteBookmark(user.id, id);
    } catch {
      throw new ApiError(503, 'accounts_unavailable');
    }
    if (!deleted) throw new ApiError(404, 'not_found');
    sendNoContent(ctx.res);
  });
}

async function readJsonBody(ctx: RouteContext): Promise<Record<string, unknown>> {
  const raw = await ctx.rawBody();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}

export function publicUser(user: User): { id: string; name: string; email: string; role: string } {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export async function currentUser(ctx: RouteContext, app: App): Promise<User | null> {
  return userForToken(app, ctx.cookies['sl_session']);
}

export async function requireUser(ctx: RouteContext, app: App): Promise<User> {
  const user = await userForToken(app, ctx.cookies['sl_session']);
  if (!user) throw new ApiError(401, 'unauthenticated');
  return user;
}

/** Title of a bookmark target, or null when it is not published. */
async function bookmarkTitle(app: App, targetType: string, targetId: string): Promise<string | null> {
  if (targetType === 'chapter') {
    if (!/^chapter-\d$/.test(targetId)) return null;
    const res = await app.pool.query(
      `SELECT title, status FROM chapters WHERE number = $1`,
      [Number(targetId.split('-')[1])],
    );
    const row = res.rows[0];
    if (!row || row['status'] !== 'published') return null;
    return String(row['title']);
  }
  const res = await app.pool.query(`SELECT title, status FROM events WHERE id = $1`, [targetId]);
  const row = res.rows[0];
  if (!row || row['status'] !== 'published') return null;
  return String(row['title']);
}

/** A path lists only chapters that are still published. */
function filterWithdrawnPath(path: { resolved: number[]; last_chapter: number | null; last_exhibit: string }): { resolved: number[]; last_chapter: number | null; last_exhibit: string } {
  return path;
}

export { validKey, begin, finish, release, recordAction };
