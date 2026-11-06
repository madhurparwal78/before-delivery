import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../domain/errors.js';
import { MESSAGES } from '../domain/copy.js';
import { MARKETS, MARKET_ORDER, ZONES, type Market } from '../domain/markets.js';
import { toInstantString, isoWeekOf, cphDateOf, cphToday } from '../domain/dates.js';
import { Validator, isEmail, normaliseName } from './validate.js';
import { id, token } from './startup.js';
import { withTransaction } from './db.js';
import { countPieces, marketStatus, slugify } from './routes-drops.js';
import { graphemeCount } from '../domain/danish.js';
import { queueMail } from './routes-auth.js';
import { createHash } from 'node:crypto';

interface PublicDropRow {
  id: string; workspace_id: string; slug: string; name: string; brand: string; type: string; status: string;
  palette: string; earliest_go_live_at: Date | null; withdrawn_at: Date | null;
}

const PAGE_SIZE = 12;

// The palette column holds either a jsonb array or a plain string form.
function parsePalette(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : value.split(','); } catch { return value.split(','); }
  }
  return [];
}

function publicStatusOf(marketStates: string[]): 'upcoming' | 'live' | 'sold_out' {
  if (marketStates.includes('live')) return 'live';
  if (marketStates.length > 0 && marketStates.every(s => s === 'sold_out')) return 'sold_out';
  return 'upcoming';
}

export function registerPublicRoutes(app: FastifyInstance): void {
  app.get('/api/public/drops', async (req: FastifyRequest, reply: FastifyReply) => {
    const state = req.appState;
    const q = req.query as Record<string, string | undefined>;
    const v = new Validator();
    const market = q.market ?? '';
    if (market && !MARKET_ORDER.includes(market as Market)) v.add('market', MESSAGES.unknownMarket);
    const status = q.status ?? '';
    if (status && !['upcoming', 'live', 'sold_out'].includes(status)) v.add('status', 'Choose a status.');
    const type = q.type ?? '';
    if (type && !['simultaneous', 'rolling'].includes(type)) v.add('type', 'Choose a drop type.');
    const week = q.week ?? '';
    if (week && !/^\d{4}-W\d{2}$/.test(week)) v.add('week', 'Choose a week.');
    const sort = q.sort ?? 'soonest';
    if (!['soonest', 'latest', 'name'].includes(sort)) v.add('sort', 'Choose a sort.');
    const page = Number(q.page ?? '1');
    if (!Number.isInteger(page) || page < 1) v.add('page', 'Choose a page.');
    v.throwIfAny();

    const res = await state.db.query(
      "SELECT * FROM drops WHERE status IN ('scheduled', 'live', 'sold_out') ORDER BY created_at DESC"
    );
    const all = res.rows as PublicDropRow[];
    const now = new Date();
    const today = cphToday(now);

    const detailed = await Promise.all(all.map(async (row) => {
      const marketRows = await state.db.query('SELECT market, go_live_at, store_pieces FROM drop_markets WHERE drop_id = $1', [row.id]);
      const states: string[] = [];
      const marketOuts: Record<string, unknown>[] = [];
      let weekDate: string | null = null;
      for (const m of MARKET_ORDER) {
        const dm = marketRows.rows.find((r: { market: string }) => r.market === m);
        if (!dm) continue;
        const { claimed, held } = await countPieces(state.db, row.id, m);
        const st = marketStatus(row.status, dm.go_live_at, dm.store_pieces, claimed, now);
        states.push(st);
        const goLive = dm.go_live_at ? toInstantString(dm.go_live_at) : null;
        marketOuts.push({ market: m, city: MARKETS.find(x => x.market === m)!.city, goLiveAt: goLive, status: st });
        if (dm.go_live_at) {
          const dateStr = cphDateOf(dm.go_live_at);
          if (!market || market === m) weekDate = weekDate ?? dateStr;
        }
      }
      const firstLook = await state.db.query('SELECT id FROM looks WHERE drop_id = $1 ORDER BY position LIMIT 1', [row.id]);
      const cover = firstLook.rows[0] ? `/api/public/drops/${row.slug}/looks/${firstLook.rows[0].id}/image` : null;
      const overall = publicStatusOf(states);
      return { row, marketOuts, overall, weekDate, cover };
    }));

    let filtered = detailed.filter(d => d.overall !== undefined);
    if (market) filtered = filtered.filter(d => d.marketOuts.some(m => m.market === market));
    if (status) filtered = filtered.filter(d => d.overall === status);
    if (type) filtered = filtered.filter(d => d.row.type === type);
    if (week) filtered = filtered.filter(d => d.weekDate && isoWeekOf(d.weekDate).key === week);

    const search = (q.q ?? '').trim().toLowerCase();
    if (search) {
      filtered = filtered.filter(d =>
        d.row.name.toLowerCase().includes(search) ||
        d.row.brand.toLowerCase().includes(search) ||
        d.row.slug.includes(search));
    }

    filtered.sort((a, b) => {
      if (sort === 'name') return a.row.name.localeCompare(b.row.name) || a.row.slug.localeCompare(b.row.slug);
      const at = a.row.earliest_go_live_at?.getTime() ?? 0;
      const bt = b.row.earliest_go_live_at?.getTime() ?? 0;
      return sort === 'latest' ? bt - at : at - bt;
    });

    const total = filtered.length;
    const start = (page - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PAGE_SIZE);

    reply.code(200).send({
      items: pageItems.map(d => ({
        slug: d.row.slug,
        name: d.row.name,
        brand: d.row.brand,
        type: d.row.type,
        status: d.overall,
        goLiveAt: d.row.earliest_go_live_at ? toInstantString(d.row.earliest_go_live_at) : null,
        weekLabel: d.weekDate ? isoWeekOf(d.weekDate).label : null,
        palette: parsePalette(d.row.palette),
        coverImageUrl: d.cover,
        markets: d.marketOuts
      })),
      page,
      pageSize: PAGE_SIZE,
      total,
      todayCopenhagen: today
    });
  });

  app.get('/api/public/drops/:slug', async (req: FastifyRequest, reply: FastifyReply) => {
    const state = req.appState;
    const { slug } = req.params as { slug: string };
    const res = await state.db.query("SELECT * FROM drops WHERE slug = $1 AND status IN ('scheduled', 'live', 'sold_out')", [slug]);
    const row = res.rows[0] as PublicDropRow | undefined;
    if (!row) {
      const withdrawn = await state.db.query('SELECT id FROM drops WHERE slug = $1 AND status = $2', [slug, 'withdrawn']);
      if (withdrawn.rows[0]) throw new ApiError('drop_withdrawn');
      throw new ApiError('not_found');
    }
    const drop = await publicDropPayload(state, row.id);
    reply.code(200).send(drop);
  });

  app.get('/api/public/drops/:slug/looks/:lookId/image', async (req: FastifyRequest, reply: FastifyReply) => {
    const state = req.appState;
    const { slug, lookId } = req.params as { slug: string; lookId: string };
    const res = await state.db.query(
      "SELECT l.* FROM looks l JOIN drops d ON d.id = l.drop_id WHERE d.slug = $1 AND l.id = $2 AND d.status IN ('scheduled', 'live', 'sold_out')",
      [slug, lookId]
    );
    if (!res.rows[0]) throw new ApiError('not_found');
    const look = res.rows[0];
    try {
      const bytes = await state.storage.get(`looks/${look.drop_id}/${look.id}.${look.ext}`);
      reply.code(200).header('content-type', look.content_type).header('cache-control', 'public, max-age=300').send(bytes);
    } catch {
      reply.code(200).header('content-type', look.content_type).send(Buffer.alloc(0));
    }
  });

  // Waitlist join — the same answer for known and unknown addresses.
  app.post('/api/public/drops/:slug/waitlist', async (req: FastifyRequest, reply: FastifyReply) => {
    const state = req.appState;
    const { slug } = req.params as { slug: string };
    const body = req.body as Record<string, unknown> | undefined;

    // Rate limit first of all after the route match (ladder step 3).
    const clientAddress = clientIpOf(req);
    await checkRateLimit(state, clientAddress);

    const res = await state.db.query("SELECT * FROM drops WHERE slug = $1 AND status IN ('scheduled', 'live', 'sold_out')", [slug]);
    const row = res.rows[0];
    if (!row) {
      const withdrawn = await state.db.query('SELECT id FROM drops WHERE slug = $1 AND status = $2', [slug, 'withdrawn']);
      if (withdrawn.rows[0]) throw new ApiError('drop_withdrawn');
      throw new ApiError('not_found');
    }
    const market = typeof body?.market === 'string' ? body.market : '';
    const name = normaliseName(typeof body?.name === 'string' ? body.name : '');
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const consent = body?.consent === true;
    const v = new Validator();
    if (!MARKET_ORDER.includes(market as Market)) v.add('market', MESSAGES.unknownMarket);
    if (!name) v.add('name', MESSAGES.required);
    else if (graphemeCount(name) > 60) v.add('name', MESSAGES.tooLong(60));
    if (!email) v.add('email', MESSAGES.required);
    else if (!isEmail(email)) v.add('email', MESSAGES.email);
    if (!consent) v.add('consent', MESSAGES.consent);
    if (v.fields.market === undefined && v.fields.email === undefined) {
      const dm = await state.db.query('SELECT store_pieces FROM drop_markets WHERE drop_id = $1 AND market = $2', [row.id, market]);
      if (dm.rows[0]) {
        const { claimed } = await countPieces(state.db, row.id, market);
        if (claimed >= dm.rows[0].store_pieces) v.add('market', 'This drop is sold out in that market.');
      }
    }
    v.throwIfAny();

    const CHECK_BYTES = Buffer.from('{"status":"check_email"}');
    await withTransaction(state.db, async client => {
      const existing = await client.query('SELECT * FROM waitlist WHERE drop_id = $1 AND market = $2 AND lower(email) = lower($3)', [row.id, market, email]);
      if (existing.rows[0]) {
        const w = existing.rows[0];
        if (w.status === 'confirmed') return;
        // A pending member: queue a new link only when the earlier link has expired.
        const validLink = w.optin_token && w.optin_expires_at && new Date(w.optin_expires_at).getTime() > Date.now();
        if (validLink) return;
        await issueOptIn(client, state, row.id, market, w.id);
        return;
      }
      const pos = await client.query('SELECT coalesce(max(position), 0) + 1 AS p FROM waitlist WHERE drop_id = $1 AND market = $2', [row.id, market]);
      const wid = id('wl');
      await client.query(
        'INSERT INTO waitlist (id, drop_id, market, name, email, status, position) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [wid, row.id, market, name, email, 'pending', pos.rows[0].p]
      );
      await issueOptIn(client, state, row.id, market, wid);
    });
    reply.code(202).send(CHECK_BYTES);
  });

  app.post('/api/public/waitlist/confirm', async (req: FastifyRequest, reply: FastifyReply) => {
    const state = req.appState;
    const body = req.body as Record<string, unknown> | undefined;
    const t = typeof body?.token === 'string' ? body.token : '';
    const res = await state.db.query('SELECT w.*, d.name AS drop_name FROM waitlist w JOIN drops d ON d.id = w.drop_id WHERE w.optin_token = $1', [t]);
    const w = res.rows[0];
    if (!w) throw new ApiError('not_found');
    if (w.status === 'confirmed') throw new ApiError('link_used');
    if (new Date(w.optin_expires_at).getTime() <= Date.now()) throw new ApiError('link_expired');
    await state.db.query('UPDATE waitlist SET status = $1 WHERE id = $2', ['confirmed', w.id]);
    reply.code(200).send({ status: 'confirmed', dropName: w.drop_name, market: w.market });
  });

  app.get('/api/public/holds/:holdToken', async (req: FastifyRequest, reply: FastifyReply) => {
    const state = req.appState;
    const { holdToken } = req.params as { holdToken: string };
    const res = await state.db.query(
      `SELECT h.*, d.name AS drop_name, d.slug AS drop_slug, d.status AS drop_status FROM holds h JOIN drops d ON d.id = h.drop_id WHERE h.token = $1`,
      [holdToken]
    );
    const h = res.rows[0];
    if (!h) throw new ApiError('not_found');
    let status = h.status;
    if (status === 'offered' && new Date(h.expires_at).getTime() <= Date.now()) status = 'expired';
    if (h.drop_status === 'withdrawn' && status === 'offered') status = 'void';
    reply.code(200).send({
      dropSlug: h.drop_slug,
      dropName: h.drop_name,
      market: h.market,
      city: MARKETS.find(m => m.market === h.market)?.city ?? h.market,
      status,
      offeredAt: toInstantString(new Date(h.offered_at)),
      expiresAt: toInstantString(new Date(h.expires_at))
    });
  });

  app.post('/api/public/drops/:slug/claims', async (req: FastifyRequest, reply: FastifyReply) => {
    const state = req.appState;
    const { slug } = req.params as { slug: string };
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 1 || key.length > 100 || !/^[\x20-\x7E]+$/.test(key)) {
      throw new ApiError('idempotency_key_required');
    }
    const body = req.body as Record<string, unknown> | undefined;
    const bodyStr = JSON.stringify(body ?? {});
    const hash = createHash('sha256').update(bodyStr).digest('hex');

    const res = await state.db.query("SELECT * FROM drops WHERE slug = $1 AND status IN ('scheduled', 'live', 'sold_out')", [slug]);
    let row = res.rows[0];
    if (!row) {
      const withdrawn = await state.db.query('SELECT id FROM drops WHERE slug = $1 AND status = $2', [slug, 'withdrawn']);
      if (withdrawn.rows[0]) throw new ApiError('drop_withdrawn');
      throw new ApiError('not_found');
    }
    row = row as PublicDropRow & { id: string; hold_seconds: number };

    // Idempotent replay: same key and equal body returns the stored answer.
    const stored = await state.db.query('SELECT * FROM idempotency WHERE key = $1 AND workspace_id = $2', [key, row.workspace_id]);
    if (stored.rows[0]) {
      if (stored.rows[0].request_hash !== hash) throw new ApiError('idempotency_key_reused');
      reply.code(stored.rows[0].status).header('content-type', 'application/json').send(stored.rows[0].body);
      return;
    }

    const outcome = await processClaim(state, row, body ?? {});
    await state.db.query(
      'INSERT INTO idempotency (key, workspace_id, request_hash, status, body) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [key, row.workspace_id, hash, outcome.status, JSON.stringify(outcome.body)]
    );
    reply.code(outcome.status).send(outcome.body);
  });
}

async function issueOptIn(client: import('pg').PoolClient, state: { cfg: import('./providers.js').Config; db: import('./db.js').Db }, dropId: string, market: string, waitlistId: string): Promise<void> {
  const t = token(48);
  const expiresAt = new Date(Date.now() + state.cfg.optInLinkTtlSeconds * 1000);
  await client.query('UPDATE waitlist SET optin_token = $1, optin_expires_at = $2 WHERE id = $3', [t, expiresAt, waitlistId]);
  const w = await client.query('SELECT w.email, w.name, d.name AS drop_name, d.workspace_id FROM waitlist w JOIN drops d ON d.id = w.drop_id WHERE w.id = $1', [waitlistId]);
  const row = w.rows[0];
  const link = `${state.cfg.appPublicUrl}/waitlist/confirm/${t}`;
  await client.query(
    'INSERT INTO jobs (run_at, kind, payload, workspace_id) VALUES (now(), $1, $2, $3)',
    ['mail', JSON.stringify({
      kind: 'waitlist_optin',
      to: row.email,
      toName: row.name,
      subject: `Confirm your place on the ${row.drop_name} waitlist`,
      body: `Hello ${row.name},\n\nConfirm your place on the ${row.drop_name} waitlist in ${MARKETS.find(m => m.market === market)?.city}:\n\n${link}\n\nThis link expires at ${toInstantString(expiresAt)} and works once.`
    }), row.workspace_id]
  );
}

export async function processClaim(state: { db: import('./db.js').Db; cfg: import('./providers.js').Config }, drop: { id: string; hold_seconds: number; slug: string; name: string; workspace_id: string }, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const db = state.db;
  const now = new Date();
  const reference = 'HL-' + Array.from({ length: 6 }, () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return alphabet[Math.floor(Math.random() * alphabet.length)];
  }).join('');

  const result = await withTransaction(db, async client => {
    // Lock the drop's market rows for this drop to serialise last-piece races.
    const holdToken = typeof body.holdToken === 'string' ? body.holdToken : null;
    const market = typeof body.market === 'string' ? body.market : null;
    let email: string | null = null;
    let name = '';
    let holdRow: Record<string, unknown> | null = null;

    if (holdToken) {
      const h = await client.query('SELECT * FROM holds WHERE token = $1 FOR UPDATE', [holdToken]);
      holdRow = h.rows[0] ?? null;
      if (!holdRow) return { code: 'not_found' as const };
      const w = await client.query('SELECT * FROM waitlist WHERE id = $1', [(holdRow as Record<string, unknown>).waitlist_id]);
      email = w.rows[0]?.email ?? null;
      name = w.rows[0]?.name ?? '';
    } else {
      name = normaliseName(typeof body.name === 'string' ? body.name : '');
      email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!market || !MARKET_ORDER.includes(market as Market)) {
        return { code: 'validation' as const, fields: { market: MESSAGES.unknownMarket } };
      }
      if (!name) return { code: 'validation' as const, fields: { name: MESSAGES.required } };
      if (!email || !isEmail(email)) return { code: 'validation' as const, fields: { email: MESSAGES.email } };
    }

    const m = (holdRow?.market ?? market) as string;
    const dm = await client.query('SELECT * FROM drop_markets WHERE drop_id = $1 AND market = $2 FOR UPDATE', [drop.id, m]);
    if (!dm.rows[0]) return { code: 'not_found' as const };
    const dropRow = await client.query('SELECT * FROM drops WHERE id = $1', [drop.id]);
    const dropStatus = dropRow.rows[0].status;
    if (dropStatus === 'withdrawn') return { code: 'drop_withdrawn' as const };

    if (holdRow) {
      const expiresAt = new Date((holdRow as Record<string, unknown>).expires_at as Date).getTime();
      if ((holdRow as Record<string, unknown>).status === 'claimed') return { code: 'hold_claimed' as const };
      if (expiresAt <= now.getTime()) {
        await client.query("UPDATE holds SET status = 'expired' WHERE id = $1", [(holdRow as Record<string, unknown>).id]);
        return { code: 'hold_expired' as const };
      }
      if ((holdRow as Record<string, unknown>).status !== 'offered') return { code: 'hold_expired' as const };
    } else {
      const already = await client.query(
        'SELECT * FROM claims WHERE drop_id = $1 AND market = $2 AND lower(email) = lower($3)',
        [drop.id, m, email]
      );
      if (already.rows[0]) return { code: 'already_claimed' as const };
    }

    const claimedRes = await client.query('SELECT count(*)::int AS n FROM claims WHERE drop_id = $1 AND market = $2', [drop.id, m]);
    const claimed = claimedRes.rows[0].n;
    // A hold claim's own hold stays live until it is claimed, so the open-piece
    // check excludes the claimer's own hold.
    const holdsRes = await client.query(
      "SELECT count(*)::int AS n FROM holds WHERE drop_id = $1 AND market = $2 AND status = 'offered' AND expires_at > now() AND id <> $3",
      [drop.id, m, (holdRow as Record<string, unknown>)?.id ?? '']
    );
    const held = holdsRes.rows[0].n;
    const storePieces = dm.rows[0].store_pieces;
    const goLiveAt = dm.rows[0].go_live_at ? new Date(dm.rows[0].go_live_at) : null;

    if (goLiveAt === null || goLiveAt.getTime() > now.getTime()) return { code: 'market_not_live' as const };
    if (claimed + held >= storePieces) {
      const last = await client.query('SELECT claimed_at FROM claims WHERE drop_id = $1 AND market = $2 ORDER BY claimed_at DESC LIMIT 1', [drop.id, m]);
      return { code: 'sold_out' as const, claimedAt: last.rows[0] ? toInstantString(new Date(last.rows[0].claimed_at)) : null };
    }
    if (!holdRow) {
      // Open claims succeed only when no confirmed member still waits for a first offer.
      const waiting = await client.query(
        `SELECT count(*)::int AS n FROM waitlist w
         WHERE w.drop_id = $1 AND w.market = $2 AND w.status = 'confirmed'
         AND NOT EXISTS (SELECT 1 FROM holds h WHERE h.waitlist_id = w.id AND h.drop_id = $1)`,
        [drop.id, m]
      );
      if (waiting.rows[0].n > 0) return { code: 'waitlist_pending' as const };
    }

    const claimId = id('clm');
    await client.query(
      'INSERT INTO claims (id, drop_id, market, reference, name, email, waitlist_id, hold_id, claimed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [claimId, drop.id, m, reference, name, email, (holdRow as Record<string, unknown>)?.waitlist_id ?? null, (holdRow as Record<string, unknown>)?.id ?? null, now]
    );
    if (holdRow) await client.query("UPDATE holds SET status = 'claimed' WHERE id = $1", [(holdRow as Record<string, unknown>).id]);

    const piecesLeft = Math.max(0, storePieces - claimed - 1 - held);
    return { code: 'ok' as const, reference, market: m, claimedAt: now, piecesLeft };
  });

  if (result.code === 'not_found') return { status: 404, body: { error: { code: 'not_found', message: 'Not found.' } } };
  if (result.code === 'validation') return { status: 422, body: { error: { code: 'validation_failed', message: 'Validation failed.', fields: result.fields } } };
  if (result.code === 'hold_expired') return { status: 409, body: { error: { code: 'hold_expired', message: 'This hold ended. The piece has gone back to the drop.' } } };
  if (result.code === 'hold_claimed') return { status: 409, body: { error: { code: 'hold_claimed', message: 'This piece is already claimed.' } } };
  if (result.code === 'already_claimed') return { status: 409, body: { error: { code: 'already_claimed', message: 'You already have a piece from this drop.' } } };
  if (result.code === 'market_not_live') return { status: 409, body: { error: { code: 'market_not_live', message: "This drop isn't live yet." } } };
  if (result.code === 'waitlist_pending') return { status: 409, body: { error: { code: 'waitlist_pending', message: 'Pieces are being offered to the waitlist first. Check back shortly.' } } };
  if (result.code === 'sold_out') {
    const body: Record<string, unknown> = { error: { code: 'sold_out', message: 'Sorry — the last piece went to another shopper.' } };
    if (result.claimedAt) (body.error as Record<string, unknown>).claimedAt = result.claimedAt;
    return { status: 409, body };
  }
  if (result.code === 'drop_withdrawn') return { status: 410, body: { error: { code: 'drop_withdrawn', message: 'This drop was withdrawn.' } } };
  return {
    status: 201,
    body: {
      claim: { id: id('clm'), reference: result.reference, market: result.market, claimedAt: toInstantString(result.claimedAt) },
      piecesLeft: result.piecesLeft
    }
  };
}

export function clientIpOf(req: FastifyRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  if (Array.isArray(fwd) && fwd.length > 0) return String(fwd[0]).split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}

// At most 5 waitlist joins per client address within the window, counted across
// every running app copy. Every join that reaches the limit check counts.
export async function checkRateLimit(state: { db: import('./db.js').Db; cfg: import('./providers.js').Config }, clientAddress: string): Promise<void> {
  const windowSeconds = state.cfg.waitlistRateWindowSeconds;
  const now = Date.now();
  const windowStart = new Date(now - windowSeconds * 1000);
  await state.db.query('DELETE FROM rate_limits WHERE window_start < $1', [new Date(now - windowSeconds * 2000)]);
  const res = await state.db.query(
    'SELECT count(*)::int AS n FROM rate_limits WHERE bucket = $1 AND window_start > $2',
    [clientAddress, windowStart]
  );
  if (res.rows[0].n >= 5) {
    const oldest = await state.db.query(
      'SELECT min(window_start) AS s FROM rate_limits WHERE bucket = $1 AND window_start > $2',
      [clientAddress, windowStart]
    );
    const oldestAt = oldest.rows[0].s ? new Date(oldest.rows[0].s).getTime() : now;
    const retryAfter = Math.max(1, Math.ceil((oldestAt + windowSeconds * 1000 - now) / 1000));
    throw new ApiError('rate_limited', { retryAfterSeconds: retryAfter });
  }
  await state.db.query('INSERT INTO rate_limits (bucket, window_start, count) VALUES ($1, $2, 1)', [clientAddress, new Date(now)]);
}

export async function publicDropPayload(state: { db: import('./db.js').Db }, dropId: string): Promise<Record<string, unknown>> {
  const db = state.db;
  const dropRes = await db.query('SELECT * FROM drops WHERE id = $1', [dropId]);
  const row = dropRes.rows[0];
  const looksRes = await db.query('SELECT * FROM looks WHERE drop_id = $1 ORDER BY position', [dropId]);
  const storyRes = await db.query('SELECT published_html FROM stories WHERE drop_id = $1', [dropId]);
  const markets = await Promise.all(MARKET_ORDER.map(async m => {
    const dm = await db.query('SELECT * FROM drop_markets WHERE drop_id = $1 AND market = $2', [dropId, m]);
    const { claimed, held } = await countPieces(db, dropId, m);
    const storePieces = dm.rows[0]?.store_pieces ?? 0;
    const goLive = dm.rows[0]?.go_live_at ? new Date(dm.rows[0].go_live_at) : null;
    return {
      market: m,
      city: MARKETS.find(x => x.market === m)!.city,
      goLiveAt: goLive ? toInstantString(goLive) : null,
      status: marketStatus(row.status, goLive, storePieces, claimed),
      piecesLeft: Math.max(0, storePieces - claimed - held)
    };
  }));
  const overall = publicStatusOf(markets.map(m => String(m.status)));
  return {
    slug: row.slug,
    name: row.name,
    brand: row.brand,
    type: row.type,
    status: overall,
    palette: parsePalette(row.palette),
    storyHtml: storyRes.rows[0]?.published_html ?? null,
    looks: looksRes.rows.map((l: Record<string, unknown>) => ({
      id: l.id, position: l.position, title: l.title, altText: l.alt_text,
      imageUrl: `/api/public/drops/${row.slug}/looks/${l.id}/image`,
      width: l.width, height: l.height
    })),
    markets
  };
}


