import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../domain/errors.js';
import { MESSAGES } from '../domain/copy.js';
import { MARKETS, MARKET_ORDER, ZONES, type Market } from '../domain/markets.js';
import { toInstantString, parseInstant, isoWeekOf, cphDateOf, marketTimeWords, parseDate, dateWords } from '../domain/dates.js';
import { resolveGoLive, parseLocalDateTime, GapTimeError, CPH, localToInstant } from '../domain/dates.js';
import { isCphGap, nextRestockInstants, weekdayOf } from '../domain/restock.js';
import { requireStaff, requireRole } from './auth.js';
import { Validator, isEmail, requiredString, graphemeLimit, normaliseName } from './validate.js';
import { id, token } from './startup.js';
import { memberOut, queueMail } from './routes-auth.js';
import { withTransaction } from './db.js';
import { largestRemainderSplit } from '../domain/split.js';
import { graphemeCount } from '../domain/danish.js';
import type { LocalDateTime } from '@js-joda/core';

function parsePaletteValue(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value === 'string') { try { const p = JSON.parse(value); return Array.isArray(p) ? p : value.split(','); } catch { return value.split(','); } }
  return [];
}

export interface DropRow {
  id: string; workspace_id: string; slug: string; name: string; brand: string; type: string; status: string;
  hold_seconds: number; palette: string; internal_note: string; go_live_at: Date | null; earliest_go_live_at: Date | null;
  copenhagen_go_live: string | null; local_go_live: string | null; created_at: Date; withdrawn_at: Date | null;
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'drop';
}

export function dropMarketRows(db: import('./db.js').Db, dropId: string): Promise<{ market: string; go_live_at: Date | null; store_pieces: number }[]> {
  return db.query('SELECT market, go_live_at, store_pieces FROM drop_markets WHERE drop_id = $1', [dropId]).then(r => r.rows);
}

export async function countPieces(db: import('./db.js').Db, dropId: string, market: string): Promise<{ claimed: number; held: number }> {
  const claims = await db.query("SELECT count(*)::int AS n FROM claims WHERE drop_id = $1 AND market = $2", [dropId, market]);
  const holds = await db.query("SELECT count(*)::int AS n FROM holds WHERE drop_id = $1 AND market = $2 AND status = 'offered' AND expires_at > now()", [dropId, market]);
  return { claimed: claims.rows[0].n, held: holds.rows[0].n };
}

export function marketStatus(dropStatus: string, goLiveAt: Date | null, storePieces: number, claimed: number, now = new Date()): 'upcoming' | 'live' | 'sold_out' {
  if (goLiveAt === null) return 'upcoming';
  if (claimed >= storePieces) return 'sold_out';
  if (goLiveAt.getTime() <= now.getTime()) return 'live';
  return 'upcoming';
}

export async function staffDropOut(db: import('./db.js').Db, row: DropRow, buyer: boolean): Promise<Record<string, unknown>> {
  const marketRows = await dropMarketRows(db, row.id);
  const styleRows = await db.query('SELECT * FROM styles WHERE drop_id = $1 ORDER BY position', [row.id]);
  if (buyer) {
    const markets = MARKET_ORDER.map(m => {
      const dm = marketRows.find(r => r.market === m)!;
      return { market: m, city: MARKETS.find(x => x.market === m)!.city, goLiveAt: dm.go_live_at ? toInstantString(dm.go_live_at) : null, storePieces: dm.store_pieces };
    });
    void markets;
    return {
      id: row.id, name: row.name, status: row.status,
      styles: styleRows.rows.map((s: { style_number: string; name: string; colour: string }) => ({ styleNumber: s.style_number, name: s.name, colour: s.colour }))
    };
  }
  const markets = await Promise.all(MARKET_ORDER.map(async m => {
    const dm = marketRows.find(r => r.market === m)!;
    const { claimed, held } = await countPieces(db, row.id, m);
    const piecesLeft = Math.max(0, dm.store_pieces - claimed - held);
    const tz = MARKETS.find(x => x.market === m)!.timeZone;
    return {
      market: m,
      city: MARKETS.find(x => x.market === m)!.city,
      goLiveAt: dm.go_live_at ? toInstantString(dm.go_live_at) : null,
      storePieces: dm.store_pieces,
      claimed,
      held,
      piecesLeft,
      status: marketStatus(row.status, dm.go_live_at, dm.store_pieces, claimed)
    };
  }));
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    type: row.type,
    status: row.status,
    holdSeconds: row.hold_seconds,
    palette: parsePaletteValue(row.palette),
    internalNote: row.internal_note,
    goLiveAt: row.earliest_go_live_at ? toInstantString(row.earliest_go_live_at) : null,
    copenhagenGoLive: row.type === 'simultaneous' && row.copenhagen_go_live ? row.copenhagen_go_live : null,
    localGoLive: row.type === 'rolling' && row.local_go_live ? row.local_go_live : null,
    markets,
    styles: styleRows.rows.map((s: { style_number: string; name: string; colour: string; wholesale_edition: number; rrp_dkk_minor: string }) => ({
      styleNumber: s.style_number, name: s.name, colour: s.colour, wholesaleEdition: s.wholesale_edition, rrpDkkMinor: Number(s.rrp_dkk_minor)
    })),
    createdAt: toInstantString(row.created_at),
    withdrawnAt: row.withdrawn_at ? toInstantString(row.withdrawn_at) : null
  };
}

async function stylesOf(db: import('./db.js').Db, dropId: string): Promise<{ style_number: string; name: string; colour: string; wholesale_edition: number }[]> {
  const res = await db.query('SELECT style_number, name, colour, wholesale_edition FROM styles WHERE drop_id = $1 ORDER BY position', [dropId]);
  return res.rows;
}

function parseMarketsBody(v: Validator, body: Record<string, unknown>, partial: boolean): Record<string, number> | null {
  const raw = body.markets;
  if (raw === undefined) return partial ? null : undefined as unknown as null;
  if (typeof raw !== 'object' || raw === null) { v.add('markets', 'Choose piece counts for every market.'); return null; }
  const out: Record<string, number> = {};
  for (const m of MARKET_ORDER) {
    const value = (raw as Record<string, unknown>)[m];
    if (value === undefined) { v.add(`markets.${m}`, MESSAGES.wholeRange(0, 100000)); continue; }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100000) {
      v.add(`markets.${m}`, MESSAGES.wholeRange(0, 100000));
      continue;
    }
    out[m] = value;
  }
  return out;
}

function validateDropBody(v: Validator, body: Record<string, unknown>, opts: { partial: boolean; checkName: boolean; checkStyles: boolean; checkType: boolean }): void {
  let name: string | null = null;
  if (opts.checkName) {
    name = requiredString(body.name);
    if (!name) v.add('name', MESSAGES.required);
    else if (!graphemeLimit(name, 80)) v.add('name', MESSAGES.tooLong(80));
  }
  if (opts.checkType && body.type !== undefined) {
    if (body.type !== 'simultaneous' && body.type !== 'rolling') v.add('type', 'Choose a drop type.');
  }
  if (body.holdSeconds !== undefined && body.type !== undefined) {
    if (typeof body.holdSeconds !== 'number' || !Number.isInteger(body.holdSeconds) || body.holdSeconds < 10 || body.holdSeconds > 86400) {
      v.add('holdSeconds', MESSAGES.wholeRange(10, 86400));
    }
  }
  if (body.status !== undefined && body.status !== 'draft' && body.status !== 'scheduled') {
    v.add('status', 'Choose draft or scheduled.');
  }
  const type = (body.type as string) ?? 'simultaneous';
  if (body.goLiveAt !== undefined && body.goLiveAt !== null) {
    if (typeof body.goLiveAt !== 'string' || !parseInstant(body.goLiveAt)) v.add('goLiveAt', MESSAGES.instant);
  }
  if (body.copenhagenGoLive !== undefined && body.copenhagenGoLive !== null) {
    if (typeof body.copenhagenGoLive !== 'string' || !parseLocalDateTime(body.copenhagenGoLive)) v.add('copenhagenGoLive', MESSAGES.instant);
  }
  if (body.localGoLive !== undefined && body.localGoLive !== null) {
    if (typeof body.localGoLive !== 'string' || !parseLocalDateTime(body.localGoLive)) v.add('localGoLive', 'Enter a date-time as YYYY-MM-DDTHH:MM.');
  }
  if (type === 'simultaneous' && body.goLiveAt !== undefined && body.copenhagenGoLive !== undefined) {
    v.add('goLiveAt', 'Give exactly one go-live time.');
  }
  if (opts.checkStyles) {
    if (!Array.isArray(body.styles) || body.styles.length < 1 || body.styles.length > 50) {
      v.add('styles', 'Add 1 to 50 styles.');
    } else {
      const seen = new Set<string>();
      body.styles.forEach((s, i) => {
        if (typeof s !== 'object' || s === null) { v.add(`styles.${i}`, MESSAGES.required); return; }
        const sn = requiredString((s as Record<string, unknown>).styleNumber);
        if (!sn) v.add(`styles.${i}.styleNumber`, MESSAGES.required);
        else {
          const key = sn.toLowerCase();
          if (seen.has(key)) v.add(`styles.${i}.styleNumber`, `Style numbers must be unique on the drop.`);
          seen.add(key);
        }
      });
    }
  }
}

type TimingResult = { instants: { market: string; goLiveAt: Date }[]; cphLocal: string | null; localGoLive: string | null } | null;

async function resolveTiming(body: Record<string, unknown>, type: string): Promise<TimingResult | ApiError> {
  const resolved = resolveGoLive({
    type: type as 'simultaneous' | 'rolling',
    goLiveAt: body.goLiveAt as string | undefined,
    copenhagenGoLive: body.copenhagenGoLive as string | undefined,
    localGoLive: body.localGoLive as string | undefined
  }, ZONES);
  if (resolved instanceof GapTimeError) {
    const dateStr = resolved.date;
    const d = parseDate(dateStr);
    const words = d ? dateWords(dateStr) : dateStr;
    return new ApiError('validation_failed', { fields: { copenhagenGoLive: MESSAGES.gap(words) } });
  }
  if (resolved === null) return null;
  const instants = resolved as { market: string; goLiveAt: Date }[];
  const cphLocal = type === 'simultaneous' && body.copenhagenGoLive ? (body.copenhagenGoLive as string) : null;
  const localGoLive = type === 'rolling' && body.localGoLive ? (body.localGoLive as string) : null;
  return { instants, cphLocal, localGoLive };
}

export function registerDropRoutes(app: FastifyInstance): void {
  app.get('/api/drops', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireStaff(req);
    const state = req.appState;
    const res = await state.db.query('SELECT * FROM drops WHERE workspace_id = $1 ORDER BY created_at DESC', [auth.workspaceId]);
    const buyer = auth.member.role === 'stockist_buyer';
    const items = await Promise.all(res.rows.filter((r: DropRow) => buyer ? r.status !== 'draft' : true).map((r: DropRow) => staffDropOut(state.db, r, buyer)));
    reply.code(200).send({ items });
  });

  app.get('/api/drops/:dropId', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireStaff(req);
    const state = req.appState;
    const { dropId } = req.params as { dropId: string };
    const res = await state.db.query('SELECT * FROM drops WHERE id = $1 AND workspace_id = $2', [dropId, auth.workspaceId]);
    if (!res.rows[0]) throw new ApiError('not_found');
    const buyer = auth.member.role === 'stockist_buyer';
    if (buyer && res.rows[0].status === 'draft') throw new ApiError('not_found');
    reply.code(200).send(await staffDropOut(state.db, res.rows[0], buyer));
  });

  app.post('/api/drops', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['launch_producer']);
    const state = req.appState;
    const body = req.body as Record<string, unknown>;
    const v = new Validator();
    validateDropBody(v, body, { partial: false, checkName: true, checkStyles: true, checkType: true });
    const type = (body.type as string) ?? 'simultaneous';
    const markets = parseMarketsBody(v, body, false);
    const hasTiming = body.goLiveAt !== undefined || body.copenhagenGoLive !== undefined || body.localGoLive !== undefined;
    let timing: TimingResult | null = null;
    const status = (body.status as string) ?? 'draft';
    if (hasTiming && v.fields.goLiveAt === undefined) {
      const t = await resolveTiming(body, type);
      if (t instanceof ApiError) {
        for (const [k, msg] of Object.entries(t.fields ?? {})) v.add(k, msg);
        timing = null;
      } else {
        timing = t;
        if (timing && status === 'scheduled') {
          const earliest = Math.min(...timing.instants.map(i => i.goLiveAt.getTime()));
          if (earliest <= Date.now()) v.add('goLiveAt', MESSAGES.notLaterThanNow);
        }
      }
    }
    v.throwIfAny();
    const did = id('drop');
    const name = String(body.name).trim();
    const slug = await uniqueSlug(state.db, auth.workspaceId, slugify(name));
    await withTransaction(state.db, async client => {
      await client.query(
        `INSERT INTO drops (id, workspace_id, slug, name, brand, type, status, hold_seconds, palette, internal_note,
          go_live_at, earliest_go_live_at, copenhagen_go_live, local_go_live)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [did, auth.workspaceId, slug, name, auth.workspaceName, type, status,
          typeof body.holdSeconds === 'number' ? body.holdSeconds : 900,
          JSON.stringify(body.palette ?? ['ink', 'vermilion', 'sand']), String(body.internalNote ?? ''),
          timing ? timing.instants[0].goLiveAt : null, timing ? new Date(Math.min(...timing.instants.map(i => i.goLiveAt.getTime()))) : null,
          timing?.cphLocal ?? null, timing?.localGoLive ?? null]
      );
      for (const m of MARKET_ORDER) {
        const gl = timing ? timing.instants.find(i => i.market === m)?.goLiveAt ?? null : null;
        await client.query('INSERT INTO drop_markets (drop_id, market, go_live_at, store_pieces) VALUES ($1,$2,$3,$4)',
          [did, m, gl, markets?.[m] ?? 0]);
      }
      let pos = 0;
      for (const s of (body.styles as { styleNumber: string; name?: string; colour?: string; wholesaleEdition?: number; rrpDkkMinor?: number }[])) {
        pos += 1;
        await client.query(
          'INSERT INTO styles (id, drop_id, style_number, name, colour, wholesale_edition, rrp_dkk_minor, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [id('sty'), did, String(s.styleNumber).trim(), String(s.name ?? ''), String(s.colour ?? ''), Number(s.wholesaleEdition ?? 0) || 0, Number(s.rrpDkkMinor ?? 0) || 0, pos]
        );
      }
      await client.query('INSERT INTO stories (drop_id) VALUES ($1) ON CONFLICT DO NOTHING', [did]);
    });
    const res = await state.db.query('SELECT * FROM drops WHERE id = $1', [did]);
    reply.code(201).send(await staffDropOut(state.db, res.rows[0], false));
  });

  app.post('/api/drops/checks', async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req, ['launch_producer']);
    const body = req.body as Record<string, unknown>;
    const v = new Validator();
    validateDropBody(v, body, { partial: true, checkName: body.name !== undefined, checkStyles: body.styles !== undefined, checkType: body.type !== undefined });
    if (body.markets !== undefined) parseMarketsBody(v, body, false);
    v.throwIfAny();
    reply.code(204).send();
  });

  app.patch('/api/drops/:dropId', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['launch_producer']);
    const state = req.appState;
    const { dropId } = req.params as { dropId: string };
    const body = req.body as Record<string, unknown>;
    const drop = await state.db.query('SELECT * FROM drops WHERE id = $1 AND workspace_id = $2', [dropId, auth.workspaceId]);
    if (!drop.rows[0]) throw new ApiError('not_found');
    const row = drop.rows[0] as DropRow;
    if (row.status === 'live' || row.status === 'sold_out' || row.status === 'withdrawn') throw new ApiError('drop_locked');
    const v = new Validator();
    validateDropBody(v, body, { partial: true, checkName: body.name !== undefined, checkStyles: false, checkType: body.type !== undefined });
    let timing: TimingResult | null = null;
    if (body.goLiveAt !== undefined || body.copenhagenGoLive !== undefined || body.localGoLive !== undefined) {
      const t = await resolveTiming(body, (body.type as string) ?? row.type);
      if (t instanceof ApiError) {
        for (const [k, msg] of Object.entries(t.fields ?? {})) v.add(k, msg);
        timing = null;
      } else timing = t;
    }
    const markets = parseMarketsBody(v, body, true);
    v.throwIfAny();
    await withTransaction(state.db, async client => {
      const sets: string[] = [];
      const params: unknown[] = [];
      const push = (col: string, value: unknown) => { params.push(value); sets.push(`${col} = $${params.length}`); };
      if (body.name !== undefined) push('name', String(body.name).trim());
      if (body.type !== undefined) push('type', body.type);
      if (body.holdSeconds !== undefined) push('hold_seconds', body.holdSeconds);
      if (body.palette !== undefined) push('palette', JSON.stringify(body.palette));
      if (body.internalNote !== undefined) push('internal_note', String(body.internalNote));
      if (timing) {
        const earliest = new Date(Math.min(...timing.instants.map(i => i.goLiveAt.getTime())));
        push('go_live_at', timing.instants[0].goLiveAt);
        push('earliest_go_live_at', earliest);
        push('copenhagen_go_live', timing.cphLocal);
        push('local_go_live', timing.localGoLive);
      }
      if (sets.length > 0) {
        params.push(dropId);
        await client.query(`UPDATE drops SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
      }
      if (markets) {
        for (const m of MARKET_ORDER) {
          const gl = timing ? timing.instants.find(i => i.market === m)?.goLiveAt ?? null : null;
          await client.query('UPDATE drop_markets SET store_pieces = $1, go_live_at = COALESCE($2, go_live_at) WHERE drop_id = $3 AND market = $4',
            [markets[m] ?? 0, gl, dropId, m]);
        }
      }
    });
    const res = await state.db.query('SELECT * FROM drops WHERE id = $1', [dropId]);
    reply.code(200).send(await staffDropOut(state.db, res.rows[0], false));
  });

  app.post('/api/drops/:dropId/schedule', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['launch_producer']);
    const state = req.appState;
    const { dropId } = req.params as { dropId: string };
    const drop = await state.db.query('SELECT * FROM drops WHERE id = $1 AND workspace_id = $2', [dropId, auth.workspaceId]);
    if (!drop.rows[0]) throw new ApiError('not_found');
    const row = drop.rows[0] as DropRow;
    if (row.status !== 'draft' && row.status !== 'scheduled') throw new ApiError('drop_locked');
    if (row.status === 'scheduled') throw new ApiError('drop_not_draft');
    if (!row.earliest_go_live_at) throw new ApiError('validation_failed', { fields: { goLiveAt: MESSAGES.required } });
    if (new Date(row.earliest_go_live_at).getTime() <= Date.now()) throw new ApiError('validation_failed', { fields: { goLiveAt: MESSAGES.notLaterThanNow } });
    await state.db.query('UPDATE drops SET status = $1 WHERE id = $2', ['scheduled', dropId]);
    const res = await state.db.query('SELECT * FROM drops WHERE id = $1', [dropId]);
    reply.code(200).send(await staffDropOut(state.db, res.rows[0], false));
  });

  app.post('/api/drops/:dropId/withdraw', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['launch_producer']);
    const state = req.appState;
    const { dropId } = req.params as { dropId: string };
    const body = req.body as Record<string, unknown> | undefined;
    const drop = await state.db.query('SELECT * FROM drops WHERE id = $1 AND workspace_id = $2', [dropId, auth.workspaceId]);
    if (!drop.rows[0]) throw new ApiError('not_found');
    const row = drop.rows[0] as DropRow;
    if (row.status === 'draft') throw new ApiError('drop_not_public');
    if (row.status === 'withdrawn') throw new ApiError('drop_withdrawn_already');
    await withTransaction(state.db, async client => {
      await client.query('UPDATE drops SET status = $1, withdrawn_at = now() WHERE id = $2', ['withdrawn', dropId]);
      await client.query("UPDATE holds SET status = 'void' WHERE drop_id = $1 AND status = 'offered'", [dropId]);
      await client.query("UPDATE jobs SET claimed_at = now(), claimed_by = 'withdrawn' WHERE kind = 'mail' AND (payload->>'dropId') = $1 AND claimed_at IS NULL", [dropId]);
    });
    const res = await state.db.query('SELECT * FROM drops WHERE id = $1', [dropId]);
    reply.code(200).send(await staffDropOut(state.db, res.rows[0], false));
  });

  // Restocks
  app.get('/api/drops/:dropId/restocks', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['launch_producer']);
    const state = req.appState;
    const { dropId } = req.params as { dropId: string };
    const drop = await state.db.query('SELECT * FROM drops WHERE id = $1 AND workspace_id = $2', [dropId, auth.workspaceId]);
    if (!drop.rows[0]) throw new ApiError('not_found');
    const series = await state.db.query('SELECT * FROM restock_series WHERE drop_id = $1', [dropId]);
    const items = [];
    for (const s of series.rows) {
      const pieces = await state.db.query('SELECT market, pieces FROM restock_pieces WHERE series_id = $1', [s.id]);
      const instants = nextRestockInstants(s.first_restock, 8, new Date());
      items.push({
        id: s.id, weekday: weekdayOf(s.first_restock.slice(0, 10)), copenhagenTime: s.first_restock.slice(11, 16),
        pieces: Object.fromEntries(pieces.rows.map((p: { market: string; pieces: number }) => [p.market, p.pieces])),
        nextInstants: instants.map(toInstantString)
      });
    }
    reply.code(200).send({ items });
  });

  app.post('/api/drops/:dropId/restocks', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['launch_producer']);
    const state = req.appState;
    const { dropId } = req.params as { dropId: string };
    const body = req.body as Record<string, unknown>;
    const drop = await state.db.query('SELECT * FROM drops WHERE id = $1 AND workspace_id = $2', [dropId, auth.workspaceId]);
    if (!drop.rows[0]) throw new ApiError('not_found');
    const row = drop.rows[0] as DropRow;
    if (row.status === 'withdrawn') throw new ApiError('drop_withdrawn_already');
    const v = new Validator();
    const firstRestock = typeof body.firstRestock === 'string' ? body.firstRestock : '';
    const local = parseLocalDateTime(firstRestock);
    if (!local) v.add('firstRestock', 'Enter a date-time as YYYY-MM-DDTHH:MM.');
    else {
      if (isCphGap(local)) v.add('firstRestock', MESSAGES.gap(weekdayOf(firstRestock.slice(0, 10))));
      else {
        const inst = resolveCphLocalInstant(local);
        if (inst.getTime() <= Date.now()) v.add('firstRestock', MESSAGES.notLaterThanNow);
      }
    }
    const pieces: Record<string, number> = {};
    if (typeof body.pieces === 'object' && body.pieces !== null) {
      for (const m of MARKET_ORDER) {
        const value = (body.pieces as Record<string, unknown>)[m];
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100000) {
          v.add(`pieces.${m}`, MESSAGES.wholeRange(0, 100000));
        } else pieces[m] = value;
      }
    } else v.add('pieces', MESSAGES.required);
    v.throwIfAny();
    const seriesId = id('restock');
    await withTransaction(state.db, async client => {
      await client.query('DELETE FROM restock_series WHERE drop_id = $1', [dropId]);
      await client.query('INSERT INTO restock_series (id, drop_id, weekday, copenhagen_time, first_restock) VALUES ($1,$2,$3,$4,$5)',
        [seriesId, dropId, local ? local.dayOfWeek().value() : 1, local ? local.toString() : firstRestock, firstRestock]);
      for (const m of MARKET_ORDER) {
        await client.query('INSERT INTO restock_pieces (series_id, market, pieces) VALUES ($1,$2,$3)', [seriesId, m, pieces[m] ?? 0]);
      }
    });
    const instants = nextRestockInstants(firstRestock, 8, new Date());
    reply.code(201).send({
      id: seriesId, weekday: weekdayOf(firstRestock.slice(0, 10)), copenhagenTime: firstRestock.slice(11, 16),
      pieces, nextInstants: instants.map(toInstantString)
    });
  });

  app.get('/api/drops/:dropId/waitlist', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['launch_producer']);
    const state = req.appState;
    const { dropId } = req.params as { dropId: string };
    const drop = await state.db.query('SELECT * FROM drops WHERE id = $1 AND workspace_id = $2', [dropId, auth.workspaceId]);
    if (!drop.rows[0]) throw new ApiError('not_found');
    const res = await state.db.query(
      `SELECT w.*, h.status AS hold_status, h.offered_at AS hold_offered_at, h.expires_at AS hold_expires_at
       FROM waitlist w LEFT JOIN holds h ON h.waitlist_id = w.id
       WHERE w.drop_id = $1 ORDER BY w.market, w.position`, [dropId]
    );
    const items = res.rows.map((r: Record<string, unknown>) => ({
      id: r.id, name: r.name, email: r.email, market: r.market, status: r.status,
      joinedAt: toInstantString(new Date(r.joined_at as Date)), position: r.position,
      hold: r.hold_status ? {
        status: r.hold_status,
        offeredAt: toInstantString(new Date(r.hold_offered_at as Date)),
        expiresAt: toInstantString(new Date(r.hold_expires_at as Date))
      } : null
    }));
    reply.code(200).send({ items });
  });

  app.post('/api/drops/:dropId/waitlist/vip', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['launch_producer']);
    const state = req.appState;
    const { dropId } = req.params as { dropId: string };
    const body = req.body as Record<string, unknown>;
    const drop = await state.db.query('SELECT * FROM drops WHERE id = $1 AND workspace_id = $2', [dropId, auth.workspaceId]);
    if (!drop.rows[0]) throw new ApiError('not_found');
    const v = new Validator();
    const market = typeof body.market === 'string' ? body.market : '';
    if (!MARKET_ORDER.includes(market as Market)) v.add('market', MESSAGES.unknownMarket);
    const membersIn = Array.isArray(body.members) ? body.members : [];
    if (membersIn.length < 1 || membersIn.length > 200) v.add('members', 'Add 1 to 200 VIP members.');
    const parsed: { name: string; email: string }[] = [];
    membersIn.forEach((m, i) => {
      if (typeof m !== 'object' || m === null) { v.add(`members.${i}`, MESSAGES.required); return; }
      const name = normaliseName(String((m as Record<string, unknown>).name ?? ''));
      const email = String((m as Record<string, unknown>).email ?? '').trim().toLowerCase();
      if (!name) v.add(`members.${i}.name`, MESSAGES.required);
      else if (graphemeCount(name) > 60) v.add(`members.${i}.name`, MESSAGES.tooLong(60));
      if (!email) v.add(`members.${i}.email`, MESSAGES.required);
      else if (!isEmail(email)) v.add(`members.${i}.email`, MESSAGES.email);
      parsed.push({ name, email });
    });
    v.throwIfAny();
    const out = await withTransaction(state.db, async client => {
      const created: Record<string, unknown>[] = [];
      for (const m of parsed) {
        const existing = await client.query('SELECT * FROM waitlist WHERE drop_id = $1 AND market = $2 AND lower(email) = lower($3)', [dropId, market, m.email]);
        if (existing.rows[0]) {
          await client.query('UPDATE waitlist SET status = $1, name = $2 WHERE id = $3', ['confirmed', m.name, existing.rows[0].id]);
          continue;
        }
        const pos = await client.query('SELECT coalesce(max(position), 0) + 1 AS p FROM waitlist WHERE drop_id = $1 AND market = $2', [dropId, market]);
        const wid = id('wl');
        await client.query(
          'INSERT INTO waitlist (id, drop_id, market, name, email, status, position) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [wid, dropId, market, m.name, m.email, 'confirmed', pos.rows[0].p]
        );
        created.push({ id: wid, name: m.name, email: m.email, market, status: 'confirmed', joinedAt: toInstantString(new Date()), position: pos.rows[0].p });
      }
      return created;
    });
    reply.code(201).send({ items: out });
  });
}

function resolveCphLocalInstant(local: LocalDateTime): Date {
  return localToInstant(local, CPH);
}

async function uniqueSlug(db: import('./db.js').Db, workspaceId: string, base: string): Promise<string> {
  let slug = base;
  let n = 1;
  for (;;) {
    const res = await db.query('SELECT id FROM drops WHERE workspace_id = $1 AND slug = $2', [workspaceId, slug]);
    if (res.rowCount === 0) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

export { resolveCphLocalInstant, memberOut, queueMail };
