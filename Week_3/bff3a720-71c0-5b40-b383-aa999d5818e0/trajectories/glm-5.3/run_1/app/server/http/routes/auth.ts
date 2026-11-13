import type { Model } from '../../domain/model.js';
import { err, unauthenticated, notFound } from '../../http/errors.js';
import type { Ctx, Router } from '../../http/router.js';
import { newId } from '../../services/ids.js';
import { isoInBrussels } from '../../domain/time.js';

export function registerAuthRoutes(model: Model, router: Router): void {
  const { db, cfg, mailer, clock } = model;

  router.add('POST', '/api/auth/code', async (ctx: Ctx) => {
    const body = ctx.body as { email?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw err(422, 'validation_failed', 'Check the highlighted fields.', { email: 'Enter an email address.' });
    }
    const now = clock.nowMs();
    const recent = await db.query(
      `SELECT issued_at FROM sign_in_codes WHERE email = $1 AND issued_at > $2 ORDER BY issued_at`,
      [email, now - 3_600_000],
    );
    if (recent.rows.length >= cfg.signinCodeRatePerHour) {
      const oldest = Number((recent.rows[0] as { issued_at: string | number }).issued_at);
      const retryAfter = Math.max(1, Math.ceil((oldest + 3_600_000 - now) / 1000));
      const minutes = Math.ceil(retryAfter / 60);
      throw err(429, 'rate_limited', `Too many codes asked for. Try again in ${minutes} minutes.`, undefined, { 'Retry-After': String(retryAfter) });
    }
    const code = await model.issueCode(email);
    const client = await db.connect();
    try {
      const minutes = Math.floor(cfg.emailCodeTtlSeconds / 60);
      const outboxId = await mailer.queue(client, 'sign_in_code', email, 'Your Longseat sign-in code', `Your code is ${code}. It expires in ${minutes} minutes.`, now);
      client.release();
      await mailer.trySend(db, outboxId, now).catch(() => undefined);
    } catch (e) {
      client.release();
      throw e;
    }
    return { status: 202, payload: { sent: true } };
  }, { member: false });

  router.add('POST', '/api/auth/verify', async (ctx: Ctx) => {
    const body = ctx.body as { email?: unknown; code?: unknown; display_name?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const existing = await model.memberByEmail(email);
    const matched = await db.query(
      `SELECT * FROM sign_in_codes WHERE email = $1 AND code = $2 AND used_at IS NULL ORDER BY issued_at DESC LIMIT 1`,
      [email, code],
    );
    if (matched.rows.length === 0) throw err(422, 'code_invalid');
    const row = matched.rows[0] as { id: string; issued_at: number };
    const now = clock.nowMs();
    if (now >= row.issued_at + cfg.emailCodeTtlSeconds * 1000) throw err(422, 'code_expired');
    let member = existing;
    if (!member) {
      const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
      if (displayName.length < 1 || displayName.length > 60) {
        throw err(422, 'validation_failed', 'Check the highlighted fields.', { display_name: 'Enter a display name of 1 to 60 characters.' });
      }
      await db.query(
        `INSERT INTO members (id, email, display_name, roles, id_state, created_at) VALUES ($1,$2,$3,$4,'none',$5)`,
        [newId(), email, displayName, ['driver', 'passenger'], now],
      );
      member = await model.memberByEmail(email);
    }
    if (!member) throw err(422, 'code_invalid');
    await db.query('UPDATE sign_in_codes SET used_at = $2 WHERE id = $1', [row.id, now]);
    const token = await model.createSession(member.id);
    ctx.res.setHeader('Set-Cookie', `ls_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
    const rating = await model.memberRating(db, member.id);
    return {
      status: 200,
      payload: { ...model.memberPublic(member, rating), email: member.email, wallet_cents: await model.walletBalance(db, member.id) },
    };
  }, { member: false });

  router.add('POST', '/api/auth/sign-out', async (ctx: Ctx) => {
    const token = ctx.cookies['ls_session'];
    if (token) await model.dropSession(token);
    ctx.res.setHeader('Set-Cookie', 'ls_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return { status: 204, payload: null };
  }, { member: true, json: false });

  router.add('GET', '/api/me', async (ctx: Ctx) => {
    const member = await model.memberById(ctx.memberId!);
    if (!member) throw unauthenticated();
    const rating = await model.memberRating(db, member.id);
    return {
      status: 200,
      payload: { ...model.memberPublic(member, rating), email: member.email, wallet_cents: await model.walletBalance(db, member.id) },
    };
  }, { member: true, json: false });

  router.add('GET', '/api/members/:id', async (ctx: Ctx) => {
    const member = await model.memberById(ctx.params.id);
    if (!member) throw notFound();
    const rating = await model.memberRating(db, member.id);
    return { status: 200, payload: model.memberPublic(member, rating) };
  }, { member: true, json: false });

  router.add('GET', '/api/cities', async () => {
    const { CITIES, allDistances } = await import('../../domain/cities.js');
    return { status: 200, payload: { cities: CITIES, distances: allDistances() } };
  }, { member: false, json: false });

  router.add('GET', '/api/price-range', async (ctx: Ctx) => {
    const stopsParam = ctx.query.get('stops') ?? '';
    const stops = stopsParam.split(',').map(s => s.trim()).filter(s => s.length > 0);
    const { buildRoute, priceRange } = await import('../../domain/route.js');
    const spec = buildRoute(stops, 0, cfg);
    if (!spec || stops.length < 2) {
      throw err(422, 'validation_failed', 'Check the highlighted fields.', { stops: 'Choose two or more towns from the table.' });
    }
    const range = priceRange(spec.routeKm, cfg);
    return { status: 200, payload: { route_km: spec.routeKm, low_cents: range.lowCents, high_cents: range.highCents } };
  }, { member: false, json: false });

  // The page receives only TOAST_SECONDS and SEARCH_DEBOUNCE_MS, plus server now.
  router.add('GET', '/api/config', async () => {
    return {
      status: 200,
      payload: {
        toast_seconds: cfg.toastSeconds,
        search_debounce_ms: cfg.searchDebounceMs,
        server_now: isoInBrussels(clock.nowMs()),
      },
    };
  }, { member: false, json: false });
}
