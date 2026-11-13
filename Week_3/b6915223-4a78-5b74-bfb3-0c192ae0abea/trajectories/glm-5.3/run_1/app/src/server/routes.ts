import * as pg from 'pg';
import type { BroadcastHub } from './hub';
import { ApiError, forbidden, notFound, unauthenticated, validationError, rulesBrokenError, shapeRulesBrokenError } from './errors';
import type { RequestContext } from './httpKernel';
import { requireManager } from './httpKernel';
import {
  applyAutosubs,
  checkSquadRules,
  checkShapeRules,
  defaultLineup,
  freeTransfersUsedFor,
  hitPointsFor,
  pairsOf,
  seasonHalfOf,
  sellingPriceTenths,
} from './rules';
import { CLUBS } from './seed';
import { buildSquadView, buildSquadViewWithClient, rawPointsFromEvents } from './squadView';
import {
  fetchEventsForGameweek,
  fetchMeta,
  fetchPick,
  fetchPlayedChips,
  fetchSquadPlayers,
  insertLedgerEntry,
  bankFromLedger,
  fetchActiveChip,
  fetchGameweek,
  fetchFixtureRow,
} from './store';
import { lockGameweek, readStatus, writeSnapshotsForGameweek, snapshotKey } from './gameweeks';
import { buildPreview, loadPreviewContext, validateIds } from './transfers';
import { queueNotices } from './noticeOutbox';
import { StorageObjectMissing, StorageUnavailable } from './storage';
import type { StorageClient } from './storage';
import type { PocketBaseClient } from './pocketbase';
import { OPERATOR_EMAIL } from './accounts';
import { eventPoints } from './rules';
import {
  BENCH_SIZE,
  ELEVEN_SIZE,
  GAMEWEEK_COUNT,
  OPENING_BUDGET_TENTHS,
  CHIP_CODES,
  EVENT_TYPES,
  PRICE_MOVES_PER_GAMEWEEK,
  type ChipCode,
  type EventType,
  type Position,
} from '../shared/domain';
import { formatDeadline, formatMillions } from '../shared/format';
import { toLeagueTime, randomId, randomJoinCode } from './util';

export interface ServerServices {
  pool: pg.Pool;
  hub: BroadcastHub;
  storage: StorageClient;
  pocketbase: PocketBaseClient;
}

type Handler = (
  ctx: RequestContext,
  services: ServerServices,
  params: Record<string, string>,
) => Promise<RouteResult>;

export type RouteResult = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  raw?: { bytes: string; filename: string };
};

const routes = new Map<string, Handler>();

function route(method: string, path: string, handler: Handler): void {
  routes.set(`${method} ${path}`, handler);
}

const routePatterns: { method: string; pattern: string; parts: string[]; handler: Handler }[] = [];

export function findRoute(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
  const exact = routes.get(`${method} ${pathname}`);
  if (exact !== undefined) return { handler: exact, params: {} };
  for (const entry of routePatterns) {
    if (entry.method !== method) continue;
    if (entry.parts.length !== pathname.split('/').length) continue;
    const pathParts = pathname.split('/');
    const params: Record<string, string> = {};
    let match = true;
    for (let i = 0; i < entry.parts.length; i += 1) {
      const part = entry.parts[i];
      if (part.startsWith('{') && part.endsWith('}')) {
        params[part.slice(1, -1)] = pathParts[i];
        continue;
      }
      if (part !== pathParts[i]) {
        match = false;
        break;
      }
    }
    if (match) return { handler: entry.handler, params };
  }
  return null;
}

function registerPattern(method: string, pattern: string, handler: Handler): void {
  routePatterns.push({ method, pattern, parts: pattern.split('/'), handler });
}

async function requireOperator(ctx: RequestContext): Promise<void> {
  const manager = await requireManager(ctx);
  if (manager.role !== 'operator') throw forbidden();
}

async function requireNonOperator(ctx: RequestContext): Promise<{ id: string; pocketbase_id: string; team_name: string }> {
  const manager = await requireManager(ctx);
  if (manager.role === 'operator') throw forbidden();
  return manager;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw validationError({ body: 'Send a JSON object.' });
  }
  return value as Record<string, unknown>;
}

function asIdList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw validationError({ [field]: 'Send a list of player ids.' });
  return value.map((entry) => {
    if (typeof entry !== 'string') throw validationError({ [field]: 'Send a list of player ids.' });
    return entry;
  });
}

function asIntInRange(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw validationError({ [field]: `Send a whole number between ${min} and ${max}.` });
  }
  return value;
}

function currentStatusGuard(status: string, gameweek: number): void {
  if (status === 'locked' || status === 'live' || status === 'closed') {
    throw new ApiError(409, 'gameweek_locked', `Deadline passed. Gameweek ${gameweek} is locked, so this change was not saved.`);
  }
  if (status === 'upcoming') {
    throw new ApiError(409, 'gameweek_not_open', `Gameweek ${gameweek} is not open yet.`);
  }
}

// ---------- Auth and catalogue ----------

route('GET', '/api/health', async () => ({ status: 200, body: { status: 'ok' } }));

route('POST', '/api/auth/signup', async () => ({ status: 201, body: null }));
route('POST', '/api/auth/signin', async () => ({ status: 200, body: null }));
route('POST', '/api/auth/signout', async () => ({ status: 204, body: undefined }));

route('GET', '/api/clubs', async (ctx, services) => {
  await requireManager(ctx);
  return { status: 200, body: { clubs: CLUBS.map((club) => ({ code: club.code, name: club.name })) } };
});

route('GET', '/api/players', async (ctx, services) => {
  await requireManager(ctx);
  const position = ctx.query.get('position');
  const club = ctx.query.get('club');
  const maxPrice = ctx.query.get('max_price');
  const sort = ctx.query.get('sort') ?? 'price_desc';
  const fields: Record<string, string> = {};
  if (position !== null && !['GK', 'DEF', 'MID', 'FWD'].includes(position)) fields.position = 'Send GK, DEF, MID or FWD.';
  if (club !== null && !CLUBS.some((entry) => entry.code === club)) fields.club = 'Send a club code.';
  if (maxPrice !== null && (!/^\d+(\.\d)?$/.test(maxPrice) || Number(maxPrice) > 11.5)) fields.max_price = 'Send millions with one decimal.';
  if (!['price_desc', 'price_asc', 'points_desc', 'name_asc'].includes(sort)) fields.sort = 'Send a published sort order.';
  if (Object.keys(fields).length > 0) throw validationError(fields);

  const client = await services.pool.connect();
  try {
    const events = await liveEvents(client);
    const raw = rawPointsFromEvents(events.events, events.players);
    const { rows } = await client.query<{ id: string; name: string; club: string; position: Position; price_tenths: number }>(
      'SELECT id, name, club, position, price_tenths FROM players',
    );
    const closedTotals = await closedTotalsByPlayer(client);
    const filtered = rows.filter((row) => {
      if (position !== null && row.position !== position) return false;
      if (club !== null && row.club !== club) return false;
      if (maxPrice !== null && row.price_tenths > Math.round(Number(maxPrice) * 10)) return false;
      return true;
    });
    const gameweek = events.gameweek;
    const enriched = filtered.map((row) => ({
      ...row,
      total_points: (closedTotals.get(row.id) ?? 0) + (raw.perPlayer.get(row.id) ?? 0),
      gameweek_points: gameweek,
    }));
    enriched.sort((a, b) => {
      switch (sort) {
        case 'price_asc':
          if (a.price_tenths !== b.price_tenths) return a.price_tenths - b.price_tenths;
          break;
        case 'points_desc':
          if (a.total_points !== b.total_points) return b.total_points - a.total_points;
          break;
        case 'name_asc':
          if (a.name !== b.name) return a.name < b.name ? -1 : 1;
          break;
        default:
          if (a.price_tenths !== b.price_tenths) return b.price_tenths - a.price_tenths;
      }
      if (a.name !== b.name) return a.name < b.name ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
    return { status: 200, body: { players: enriched.map(({ id, name, club: rowClub, position: rowPosition, price_tenths, total_points, gameweek_points }) => ({ id, name, club: rowClub, position: rowPosition, price_tenths, total_points, gameweek_points })) } };
  } finally {
    client.release();
  }
});

async function liveEvents(client: pg.PoolClient): Promise<{ events: { event_id: string; player_id: string; type: string; value: number | null; voided: boolean; fixture_id: string }[]; players: Map<string, { position: Position }>; gameweek: number }> {
  const gw = await client.query<{ number: number; status: string }>(
    `SELECT number, status FROM gameweeks WHERE status IN ('open','locked','live') ORDER BY number LIMIT 1`,
  );
  const playersRows = await client.query<{ id: string; position: Position }>('SELECT id, position FROM players');
  const players = new Map(playersRows.rows.map((row) => [row.id, { position: row.position }]));
  const number = gw.rows[0]?.number ?? 1;
  if (gw.rows[0]?.status !== 'live') {
    return { events: [], players, gameweek: 0 };
  }
  const events = await client.query<{ event_id: string; player_id: string; type: string; value: number | null; voided: boolean; fixture_id: string }>(
    'SELECT event_id, player_id, type, value, voided, fixture_id FROM events WHERE gameweek = $1',
    [number],
  );
  return { events: events.rows, players, gameweek: number };
}

async function closedTotalsByPlayer(client: pg.PoolClient): Promise<Map<string, number>> {
  const { rows } = await client.query<{ player_id: string; total: number }>(
    `SELECT e.player_id, SUM(e.points_delta)::int AS total
       FROM events e JOIN gameweeks g ON g.number = e.gameweek
      WHERE e.voided = false AND g.status = 'closed'
      GROUP BY e.player_id`,
  );
  return new Map(rows.map((row) => [row.player_id, row.total]));
}

route('GET', '/api/gameweeks', async (ctx, services) => {
  await requireManager(ctx);
  const { rows } = await services.pool.query<{ number: number; status: string; deadline: Date | null }>(
    'SELECT number, status, deadline FROM gameweeks ORDER BY number',
  );
  return {
    status: 200,
    body: {
      gameweeks: rows.map((row) => ({
        number: row.number,
        status: row.status,
        deadline: row.deadline === null ? null : row.deadline.toISOString(),
      })),
    },
  };
});

route('GET', '/api/gameweeks/current', async (ctx, services) => {
  await requireManager(ctx);
  const current = await fetchGameweekLive(services.pool);
  const fixtures = current === null ? [] : await fetchFixtureRow(services.pool, current.number);
  return {
    status: 200,
    body: {
      number: current?.number ?? 1,
      status: current?.status ?? 'upcoming',
      deadline: current?.deadline === null || current === null ? null : current.deadline.toISOString(),
      deadline_local: current?.deadline === null || current === null ? null : formatDeadline(toLeagueTime(current.deadline)),
      first_kickoff: fixtures.length === 0 ? null : fixtures[0].kickoff.toISOString(),
      fixtures: fixtures.map((fixture) => ({
        id: fixture.id,
        home: fixture.home,
        away: fixture.away,
        kickoff: fixture.kickoff.toISOString(),
      })),
      server_time: new Date().toISOString(),
    },
  };
});

export async function fetchGameweekLive(pool: pg.Pool): Promise<{ number: number; status: 'upcoming' | 'open' | 'locked' | 'live' | 'closed'; deadline: Date | null } | null> {
  const { rows } = await pool.query<{ number: number; status: 'upcoming' | 'open' | 'locked' | 'live' | 'closed'; deadline: Date | null }>(
    `SELECT number, status, deadline FROM gameweeks WHERE status IN ('open','locked','live') ORDER BY number LIMIT 1`,
  );
  if (rows.length > 0) return rows[0];
  const closed = await pool.query<{ number: number; status: 'upcoming' | 'open' | 'locked' | 'live' | 'closed'; deadline: Date | null }>(
    `SELECT number, status, deadline FROM gameweeks WHERE status = 'closed' ORDER BY number DESC LIMIT 1`,
  );
  return closed.rows[0] ?? null;
}

route('GET', '/api/me', async (ctx) => {
  const manager = await requireManager(ctx);
  return {
    status: 200,
    body: { id: manager.id, email: manager.pocketbase_id, team_name: manager.team_name, role: manager.role },
  };
});

// ---------- Transfers and drafts ----------

route('POST', '/api/transfers/preview', async (ctx, services) => {
  const manager = await requireNonOperator(ctx);
  const body = asRecord(ctx.body);
  const gameweek = asIntInRange(body.gameweek, 'gameweek', 1, GAMEWEEK_COUNT);
  const out = asIdList(body.out, 'out');
  const into = asIdList(body.in, 'in');
  const client = await services.pool.connect();
  try {
    const gw = await client.query<{ status: string }>('SELECT status FROM gameweeks WHERE number = $1', [gameweek]);
    if (gw.rows.length === 0) throw new ApiError(404, 'not_found', 'No such gameweek.');
    const context = await loadPreviewContext(client, manager.id, gameweek, true);
    const { catalogue } = validateIds({ out, into }, context, false);
    const catalogueRows = await client.query<{ id: string; position: Position; club: string; price_tenths: number }>(
      'SELECT id, position, club, price_tenths FROM players',
    );
    const fullCatalogue = new Map(catalogueRows.rows.map((row) => [row.id, row]));
    const ownedInto = new Map(context.squad.map((player) => [player.id, player]));
    for (const [id, row] of fullCatalogue) {
      if (!ownedInto.has(id)) ownedInto.set(id, { id, club: row.club, position: row.position, purchase_price_tenths: row.price_tenths, price_tenths: row.price_tenths });
    }
    void catalogue;
    const { preview } = buildPreview({ out, into }, context, ownedInto);
    return { status: 200, body: preview };
  } finally {
    client.release();
  }
});

route('POST', '/api/transfers', async (ctx, services) => {
  const manager = await requireNonOperator(ctx);
  const idempotencyKey = ctx.req.headers['idempotency-key'];
  if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(idempotencyKey)) {
    throw validationError({ idempotency_key: 'Send 1 to 64 letters, digits, - or _.' });
  }
  const body = asRecord(ctx.body);
  const gameweek = asIntInRange(body.gameweek, 'gameweek', 1, GAMEWEEK_COUNT);
  const out = asIdList(body.out, 'out');
  const into = asIdList(body.in, 'in');
  const hitPoints = asIntInRange(body.hit_points, 'hit_points', 0, 999);

  const existingKey = await services.pool.query<{ status: number; body: { body: unknown; request: unknown } }>(
    'SELECT status, body FROM idempotency_keys WHERE manager_id = $1 AND key = $2',
    [manager.id, idempotencyKey],
  );
  if (existingKey.rows.length > 0) {
    const stored = existingKey.rows[0];
    const storedRequest = stored.body.request as Record<string, unknown>;
    const sameBody =
      storedRequest.gameweek === gameweek &&
      JSON.stringify(storedRequest.out) === JSON.stringify(out) &&
      JSON.stringify(storedRequest.in) === JSON.stringify(into) &&
      storedRequest.hit_points === hitPoints;
    if (!sameBody) throw new ApiError(422, 'idempotency_key_reused', 'That key was used for a different request.');
    return { status: stored.status, body: stored.body.body, headers: { 'Idempotent-Replayed': 'true' } };
  }

  const client = await services.pool.connect();
  try {
    await client.query('BEGIN');
    const gw = await client.query<{ status: string; deadline: Date | null }>(
      'SELECT status, deadline FROM gameweeks WHERE number = $1 FOR UPDATE',
      [gameweek],
    );
    if (gw.rows.length === 0) throw new ApiError(404, 'not_found', 'No such gameweek.');
    if (gw.rows[0].status === 'upcoming') {
      await client.query('ROLLBACK');
      throw new ApiError(409, 'gameweek_not_open', `Gameweek ${gameweek} is not open yet.`);
    }
    if (gw.rows[0].status !== 'open' || (gw.rows[0].deadline !== null && Date.now() >= gw.rows[0].deadline.getTime())) {
      await queueNotices(client, [{
        manager_id: manager.id,
        pocketbase_user_id: manager.pocketbase_id,
        kind: 'transfer_refused',
        gameweek,
        message: `Your change for gameweek ${gameweek} arrived after the deadline and was not saved.`,
      }]);
      await client.query(
        `UPDATE drafts SET state = 'clean', out_players = '{}', in_players = '{}', refusal = NULL WHERE manager_id = $1 AND gameweek = $2`,
        [manager.id, gameweek],
      );
      await client.query('COMMIT');
      throw lockedRefusal(gameweek);
    }

    const context = await loadPreviewContext(client, manager.id, gameweek, false);
    validateIds({ out, into }, context, true);
    const catalogueRows = await client.query<{ id: string; position: Position; club: string; price_tenths: number }>(
      'SELECT id, position, club, price_tenths FROM players',
    );
    const fullCatalogue = new Map(catalogueRows.rows.map((row) => [row.id, row]));
    const combined = new Map(context.squad.map((player) => [player.id, player]));
    for (const [id, row] of fullCatalogue) {
      if (!combined.has(id)) combined.set(id, { id, club: row.club, position: row.position, purchase_price_tenths: row.price_tenths, price_tenths: row.price_tenths });
    }
    const { preview, pairs } = buildPreview({ out, into }, context, combined);
    if (preview.rules.length > 0) {
      await refuseTransfer(client, manager.id, gameweek, preview.rules.map((rule) => ({ code: rule.code as never, message: rule.message })));
      throw rulesBrokenError(preview.rules.map((rule) => ({ code: rule.code as never, message: rule.message })));
    }
    if (preview.hit_points !== hitPoints) {
      await refuseTransfer(client, manager.id, gameweek, undefined);
      const error = new ApiError(409, 'hit_changed', 'The hit is now different. Check it and confirm again.');
      error.body.hit_points = preview.hit_points;
      throw error;
    }

    const transferRows: { id: string; out: string; in: string; sell_price_tenths: number; price_tenths: number }[] = [];
    let bank = context.bankTenths;
    const pick = await client.query<{ starting: string[]; bench: string[]; captain: string | null; vice_captain: string | null }>(
      'SELECT starting, bench, captain, vice_captain FROM picks WHERE manager_id = $1 AND gameweek = $2',
      [manager.id, gameweek],
    );
    let starting = [...(pick.rows[0]?.starting ?? [])];
    let bench = [...(pick.rows[0]?.bench ?? [])];
    let captain = pick.rows[0]?.captain ?? null;
    let viceCaptain = pick.rows[0]?.vice_captain ?? null;

    for (const pair of pairs) {
      const outInfo = context.squad.find((player) => player.id === pair.out)!;
      const inInfo = combined.get(pair.in)!;
      const sell = sellingPriceTenths(outInfo.purchase_price_tenths, outInfo.price_tenths);
      const transferId = `t_${randomId(16)}`;
      transferRows.push({ id: transferId, out: pair.out, in: pair.in, sell_price_tenths: sell, price_tenths: inInfo.price_tenths });

      await client.query(
        'INSERT INTO transfers (id, manager_id, gameweek, out_player, in_player, sell_price_tenths, price_tenths, free_hit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [transferId, manager.id, gameweek, pair.out, pair.in, sell, inInfo.price_tenths, context.activeChip === 'free_hit'],
      );
      await insertLedgerEntry(client, { manager_id: manager.id, kind: 'sale', amount_tenths: sell, player_id: pair.out, transfer_id: transferId, reverses: null, gameweek });
      await insertLedgerEntry(client, { manager_id: manager.id, kind: 'purchase', amount_tenths: -inInfo.price_tenths, player_id: pair.in, transfer_id: transferId, reverses: null, gameweek });
      await client.query('DELETE FROM squad_players WHERE manager_id = $1 AND player_id = $2', [manager.id, pair.out]);
      await client.query(
        'INSERT INTO squad_players (manager_id, player_id, purchase_price_tenths) VALUES ($1, $2, $3)',
        [manager.id, pair.in, inInfo.price_tenths],
      );
      bank += sell - inInfo.price_tenths;

      const outIndex = starting.indexOf(pair.out);
      if (outIndex >= 0) {
        const replacementIndex = starting.length;
        starting[outIndex] = pair.in;
        if (captain === pair.out) captain = pair.in;
        if (viceCaptain === pair.out) viceCaptain = pair.in;
        starting = regroupEleven(starting, (id) => combined.get(id)?.position ?? 'GK');
        void replacementIndex;
      }
      const benchIndex = bench.indexOf(pair.out);
      if (benchIndex >= 0) {
        bench[benchIndex] = pair.in;
      }
    }

    await client.query(
      'UPDATE squad_meta SET bank_tenths = $1, free_transfers = $2, transfers_made = transfers_made + $3 WHERE manager_id = $4',
      [bank, Math.max(0, context.freeTransfers - preview.free_transfers_used), pairs.length, manager.id],
    );
    const totalHit = await client.query<{ hit_points: number }>(
      'SELECT hit_points FROM hits WHERE manager_id = $1 AND gameweek = $2',
      [manager.id, gameweek],
    );
    const newHit = (totalHit.rows[0]?.hit_points ?? 0) + preview.hit_points;
    await client.query(
      `INSERT INTO hits (manager_id, gameweek, hit_points) VALUES ($1, $2, $3)
       ON CONFLICT (manager_id, gameweek) DO UPDATE SET hit_points = EXCLUDED.hit_points`,
      [manager.id, gameweek, newHit],
    );
    if (pick.rows.length > 0) {
      await client.query(
        'UPDATE picks SET starting = $1, bench = $2, captain = $3, vice_captain = $4 WHERE manager_id = $5 AND gameweek = $6',
        [starting, bench, captain, viceCaptain, manager.id, gameweek],
      );
    }
    await client.query(
      `UPDATE drafts SET state = 'confirmed', out_players = '{}', in_players = '{}', refusal = NULL WHERE manager_id = $1 AND gameweek = $2`,
      [manager.id, gameweek],
    );

    const response = {
      transfers: transferRows,
      hit_points: preview.hit_points,
      gameweek_hit_points: newHit,
      bank_tenths: bank,
      free_transfers: Math.max(0, context.freeTransfers - preview.free_transfers_used),
    };
    await client.query(
      'INSERT INTO idempotency_keys (manager_id, key, status, body) VALUES ($1, $2, 201, $3)',
      [manager.id, idempotencyKey, JSON.stringify({ body: response, request: { gameweek, out, in: into, hit_points: hitPoints } })],
    );
    await client.query('COMMIT');
    services.hub.broadcastToManagers({ squadUpdate: { manager_id: manager.id } });
    return { status: 201, body: response };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
});

async function refuseTransfer(
  client: pg.PoolClient,
  managerId: string,
  gameweek: number,
  rules?: { code: string; message: string }[],
): Promise<void> {
  const refusalBody = rules === undefined
    ? { error: 'hit_changed', message: 'The hit is now different. Check it and confirm again.' }
    : { error: 'rules_broken', message: 'The squad breaks some rules.', rules };
  await client.query(
    `UPDATE drafts SET state = 'refused', refusal = $3 WHERE manager_id = $1 AND gameweek = $2`,
    [managerId, gameweek, JSON.stringify(refusalBody)],
  );
}

route('GET', '/api/transfers/draft', async (ctx, services) => {
  const manager = await requireNonOperator(ctx);
  return { status: 200, body: await draftView(services.pool, manager.id) };
});

route('PUT', '/api/transfers/draft', async (ctx, services) => {
  const manager = await requireNonOperator(ctx);
  const body = asRecord(ctx.body);
  const gameweek = asIntInRange(body.gameweek, 'gameweek', 1, GAMEWEEK_COUNT);
  const out = asIdList(body.out, 'out');
  const into = asIdList(body.in, 'in');
  if (into.length > out.length) throw validationError({ in: 'Send no more players in than out.' });
  const client = await services.pool.connect();
  try {
    const gw = await client.query<{ status: string }>('SELECT status FROM gameweeks WHERE number = $1', [gameweek]);
    if (gw.rows.length === 0) throw new ApiError(404, 'not_found', 'No such gameweek.');
    currentStatusGuard(gw.rows[0].status, gameweek);
    const context = await loadPreviewContext(client, manager.id, gameweek, true);
    validateIds({ out, into }, context, false);
    const catalogueRows = await client.query<{ id: string; position: Position; club: string; price_tenths: number }>(
      'SELECT id, position, club, price_tenths FROM players',
    );
    const combined = new Map(context.squad.map((player) => [player.id, player]));
    for (const row of catalogueRows.rows) {
      if (!combined.has(row.id)) combined.set(row.id, { id: row.id, club: row.club, position: row.position, purchase_price_tenths: row.price_tenths, price_tenths: row.price_tenths });
    }
    const { preview } = buildPreview({ out, into }, context, combined);
    const state = out.length === 0 && into.length === 0 ? 'clean' : 'drafting';
    await client.query(
      `INSERT INTO drafts (manager_id, gameweek, state, out_players, in_players, refusal)
       VALUES ($1, $2, $3, $4, $5, NULL)
       ON CONFLICT (manager_id, gameweek)
       DO UPDATE SET state = EXCLUDED.state, out_players = EXCLUDED.out_players, in_players = EXCLUDED.in_players, refusal = NULL`,
      [manager.id, gameweek, state, out, into],
    );
    return { status: 200, body: await draftView(services.pool, manager.id) };
  } finally {
    client.release();
  }
});

route('DELETE', '/api/transfers/draft', async (ctx, services) => {
  const manager = await requireNonOperator(ctx);
  const view = await draftView(services.pool, manager.id);
  const client = await services.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE drafts SET state = 'clean', out_players = '{}', in_players = '{}', refusal = NULL WHERE manager_id = $1 AND gameweek = $2`,
      [manager.id, view.gameweek],
    );
    await client.query('COMMIT');
  } finally {
    client.release();
  }
  return { status: 200, body: await draftView(services.pool, manager.id) };
});

async function draftView(pool: pg.Pool, managerId: string): Promise<DraftPayload> {
  const current = await fetchGameweekLive(pool);
  const gameweek = current?.number ?? 1;
  const client = await pool.connect();
  try {
    const rows = await client.query<{ state: string; out_players: string[]; in_players: string[]; refusal: unknown }>(
      'SELECT state, out_players, in_players, refusal FROM drafts WHERE manager_id = $1 AND gameweek = $2',
      [managerId, gameweek],
    );
    const row = rows.rows[0];
    const out = row?.out_players ?? [];
    const into = row?.in_players ?? [];
    const state = (row?.state ?? 'clean') as DraftPayload['state'];
    if (state === 'clean') {
      return { gameweek, state, out: [], in: [], preview: null, refusal: null };
    }
    const context = await loadPreviewContext(client, managerId, gameweek, true);
    const catalogueRows = await client.query<{ id: string; position: Position; club: string; price_tenths: number }>(
      'SELECT id, position, club, price_tenths FROM players',
    );
    const combined = new Map(context.squad.map((player) => [player.id, player]));
    for (const row2 of catalogueRows.rows) {
      if (!combined.has(row2.id)) combined.set(row2.id, { id: row2.id, club: row2.club, position: row2.position, purchase_price_tenths: row2.price_tenths, price_tenths: row2.price_tenths });
    }
    const { preview } = buildPreview({ out, into }, context, combined);
    return { gameweek, state, out, in: into, preview, refusal: row?.refusal ?? null };
  } finally {
    client.release();
  }
}

interface DraftPayload {
  gameweek: number;
  state: 'clean' | 'drafting' | 'confirmed' | 'refused';
  out: string[];
  in: string[];
  preview: { count: number; free_transfers_used: number; hit_points: number; bank_after_tenths: number; rules: { code: string; message: string }[] } | null;
  refusal: unknown;
}

// ---------- History and snapshots ----------

async function historyViewFor(pool: pg.Pool, managerId: string): Promise<HistoryPayload> {
  const manager = await pool.query<{ team_name: string }>('SELECT team_name FROM managers WHERE id = $1', [managerId]);
  const locked = await pool.query<{ gameweek: number; status: string; captain: string | null; vice_captain: string | null; receipt: string; chip: string | null }>(
    `SELECT lt.gameweek, g.status, lt.captain, lt.vice_captain, lt.receipt, lt.chip
       FROM locked_teams lt JOIN gameweeks g ON g.number = lt.gameweek
      WHERE lt.manager_id = $1
      ORDER BY lt.gameweek`,
    [managerId],
  );
  const scores = await pool.query<{ gameweek: number; points: number; hit_points: number; net_points: number; captain: string | null; vice_captain: string | null }>(
    'SELECT gameweek, points, hit_points, net_points, captain, vice_captain FROM gameweek_scores WHERE manager_id = $1 ORDER BY gameweek',
    [managerId],
  );
  const transfers = await pool.query<{ gameweek: number; count: string }>(
    'SELECT gameweek, count(*)::text AS count FROM transfers WHERE manager_id = $1 GROUP BY gameweek',
    [managerId],
  );
  const transferCount = new Map(transfers.rows.map((row) => [row.gameweek, Number(row.count)]));

  const rows: HistoryPayload['rows'] = [];
  let running = 0;
  for (const score of scores.rows) {
    running += score.net_points;
    const lockedRow = locked.rows.find((row) => row.gameweek === score.gameweek);
    rows.push({
      gameweek: score.gameweek,
      status: 'closed',
      points: score.points,
      hit_points: score.hit_points,
      net_points: score.net_points,
      running_total: running,
      chip: (lockedRow?.chip ?? null) as ChipCode | null,
      captain: score.captain,
      vice_captain: score.vice_captain,
      transfers_made: transferCount.get(score.gameweek) ?? 0,
      receipt: (lockedRow?.receipt ?? 'pending') as 'stored' | 'pending',
    });
  }
  for (const row of locked.rows) {
    if (scores.rows.some((score) => score.gameweek === row.gameweek)) continue;
    rows.push({
      gameweek: row.gameweek,
      status: row.status,
      points: 0,
      hit_points: 0,
      net_points: 0,
      running_total: null,
      chip: row.chip as ChipCode | null,
      captain: row.captain,
      vice_captain: row.vice_captain,
      transfers_made: transferCount.get(row.gameweek) ?? 0,
      receipt: row.receipt as 'stored' | 'pending',
    });
  }
  rows.sort((a, b) => a.gameweek - b.gameweek);
  return {
    manager_id: managerId,
    team_name: manager.rows[0]?.team_name ?? '',
    season_total: running,
    rows,
  };
}

interface HistoryPayload {
  manager_id: string;
  team_name: string;
  season_total: number;
  rows: {
    gameweek: number;
    status: string;
    points: number;
    hit_points: number;
    net_points: number;
    running_total: number | null;
    chip: ChipCode | null;
    captain: string | null;
    vice_captain: string | null;
    transfers_made: number;
    receipt: 'stored' | 'pending';
  }[];
}

route('GET', '/api/history', async (ctx, services) => {
  const manager = await requireNonOperator(ctx);
  return { status: 200, body: await historyViewFor(services.pool, manager.id) };
});

route('GET', '/api/history/transfers', async (ctx, services) => {
  const manager = await requireNonOperator(ctx);
  const { rows } = await services.pool.query<{
    id: string; gameweek: number; made_at: Date; out_player: string; in_player: string;
    sell_price_tenths: number; price_tenths: number; free_hit: boolean;
    out_name: string; in_name: string;
  }>(
    `SELECT t.id, t.gameweek, t.made_at, t.out_player, t.in_player, t.sell_price_tenths, t.price_tenths, t.free_hit,
            po.name AS out_name, pi.name AS in_name
       FROM transfers t JOIN players po ON po.id = t.out_player JOIN players pi ON pi.id = t.in_player
      WHERE t.manager_id = $1
      ORDER BY t.made_at, t.id`,
    [manager.id],
  );
  return {
    status: 200,
    body: {
      transfers: rows.map((row) => ({
        id: row.id,
        gameweek: row.gameweek,
        made_at: row.made_at.toISOString(),
        out: { player_id: row.out_player, name: row.out_name, sell_price_tenths: row.sell_price_tenths },
        in: { player_id: row.in_player, name: row.in_name, price_tenths: row.price_tenths },
        free_hit: row.free_hit,
      })),
    },
  };
});

route('GET', '/api/history/ledger', async (ctx, services) => {
  const manager = await requireNonOperator(ctx);
  const client = await services.pool.connect();
  try {
    const entries = await client.query<{ id: string; kind: string; amount_tenths: number; player_id: string | null; transfer_id: string | null; reverses: string | null; gameweek: number; created_at: Date }>(
      'SELECT id, kind, amount_tenths, player_id, transfer_id, reverses, gameweek, created_at FROM ledger_entries WHERE manager_id = $1 ORDER BY created_at, id',
      [manager.id],
    );
    const squadRows = await client.query<{ purchase_price_tenths: number; price_tenths: number }>(
      `SELECT sp.purchase_price_tenths, p.price_tenths
         FROM squad_players sp JOIN players p ON p.id = sp.player_id
        WHERE sp.manager_id = $1`,
      [manager.id],
    );
    const squadSelling = squadRows.rows.reduce((sum, row) => sum + sellingPriceTenths(row.purchase_price_tenths, row.price_tenths), 0);
    const bank = await bankFromLedger(client, manager.id);
    return {
      status: 200,
      body: {
        bank_tenths: bank,
        squad_selling_value_tenths: squadSelling,
        entries: entries.rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          amount_tenths: row.amount_tenths,
          player_id: row.player_id,
          transfer_id: row.transfer_id,
          reverses: row.reverses,
          gameweek: row.gameweek,
          created_at: row.created_at.toISOString(),
        })),
      },
    };
  } finally {
    client.release();
  }
});

registerPattern('GET', '/api/history/{gameweek}/snapshot', async (ctx, services, params) => {
  const manager = await requireNonOperator(ctx);
  const gameweek = asIntInRange(Number(params.gameweek), 'gameweek', 1, GAMEWEEK_COUNT);
  return snapshotResult(services, manager.id, gameweek);
});

async function snapshotResult(services: ServerServices, managerId: string, gameweek: number): Promise<RouteResult> {
  const { rows } = await services.pool.query<{ receipt: string }>(
    'SELECT receipt FROM locked_teams WHERE manager_id = $1 AND gameweek = $2',
    [managerId, gameweek],
  );
  if (rows.length === 0) throw notFound();
  if (rows[0].receipt === 'pending') {
    throw new ApiError(409, 'receipt_pending', 'The receipt is still pending. Try again when it shows as stored.');
  }
  let bytes: string;
  try {
    bytes = await services.storage.get(snapshotKey(gameweek, managerId));
  } catch (error) {
    if (error instanceof StorageObjectMissing) throw notFound();
    throw new ApiError(503, 'storage_unavailable', 'Storage is unreachable. Try the download again in a minute.');
  }
  return {
    status: 200,
    raw: { bytes, filename: `elevens-gw${String(gameweek).padStart(2, '0')}-${managerId}.json` },
    headers: { 'Content-Type': 'application/json' },
  };
}

// ---------- Mini leagues ----------

route('POST', '/api/leagues', async (ctx, services) => {
  const manager = await requireNonOperator(ctx);
  const body = asRecord(ctx.body);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 3 || name.length > 40) throw validationError({ name: 'Send a league name of 3 to 40 characters.' });
  const client = await services.pool.connect();
  try {
    await client.query('BEGIN');
    const id = `lg_${randomId(10)}`;
    let code = randomJoinCode();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const taken = await client.query('SELECT 1 FROM leagues WHERE code = $1', [code]);
      if (taken.rows.length === 0) break;
      code = randomJoinCode();
    }
    await client.query(
      'INSERT INTO leagues (id, name, code, admin_manager_id) VALUES ($1, $2, $3, $4)',
      [id, name, code, manager.id],
    );
    await client.query('INSERT INTO league_members (league_id, manager_id) VALUES ($1, $2)', [id, manager.id]);
    await client.query('COMMIT');
    return { status: 201, body: { id, name, code, admin_manager_id: manager.id, is_admin: true } };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
});

route('POST', '/api/leagues/join', async (ctx, services) => {
  const manager = await requireNonOperator(ctx);
  const body = asRecord(ctx.body);
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  const client = await services.pool.connect();
  try {
    await client.query('BEGIN');
    const league = await client.query<{ id: string; name: string; admin_manager_id: string }>(
      'SELECT id, name, admin_manager_id FROM leagues WHERE code = $1 FOR UPDATE',
      [code],
    );
    if (league.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new ApiError(404, 'league_not_found', 'No league uses that code.');
    }
    const member = await client.query('SELECT 1 FROM league_members WHERE league_id = $1 AND manager_id = $2', [league.rows[0].id, manager.id]);
    if (member.rows.length > 0) {
      await client.query('ROLLBACK');
      throw new ApiError(409, 'already_member', 'You are already in this league.');
    }
    await client.query('INSERT INTO league_members (league_id, manager_id) VALUES ($1, $2)', [league.rows[0].id, manager.id]);
    await client.query('COMMIT');
    services.hub.broadcastToManagers({ standings: { league_id: league.rows[0].id } });
    return { status: 200, body: { id: league.rows[0].id, name: league.rows[0].name, code: null, admin_manager_id: league.rows[0].admin_manager_id, is_admin: false } };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
});

route('GET', '/api/leagues', async (ctx, services) => {
  const manager = await requireNonOperator(ctx);
  const { rows } = await services.pool.query<{ id: string; name: string; is_admin: boolean; joined_at: Date }>(
    `SELECT l.id, l.name, (l.admin_manager_id = $1) AS is_admin, lm.joined_at
       FROM league_members lm JOIN leagues l ON l.id = lm.league_id
      WHERE lm.manager_id = $1
      ORDER BY lm.joined_at`,
    [manager.id],
  );
  const leagues = [];
  for (const row of rows) {
    const members = await services.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM league_members WHERE league_id = $1',
      [row.id],
    );
    const standings = await standingsFor(services.pool, row.id);
    const mine = standings.find((entry) => entry.manager_id === manager.id);
    leagues.push({ id: row.id, name: row.name, is_admin: row.is_admin, rank: mine?.rank ?? 0, members: Number(members.rows[0].count) });
  }
  return { status: 200, body: { leagues } };
});

async function standingsFor(pool: pg.Pool, leagueId: string): Promise<StandingEntry[]> {
  const members = await pool.query<{ manager_id: string; team_name: string }>(
    `SELECT lm.manager_id, m.team_name
       FROM league_members lm JOIN managers m ON m.id = lm.manager_id
      WHERE lm.league_id = $1`,
    [leagueId],
  );
  const current = await fetchGameweekLive(pool);
  const totals = await pool.query<{ manager_id: string; net_points: number; gameweek: number }>(
    'SELECT manager_id, net_points, gameweek FROM gameweek_scores',
  );
  const closedByManager = new Map<string, number>();
  const lastClosed = await pool.query<{ gameweek: number }>(
    "SELECT number AS gameweek FROM gameweeks WHERE status = 'closed' ORDER BY number DESC LIMIT 1",
  );
  const lastClosedNumber = lastClosed.rows[0]?.gameweek ?? null;
  const lastByManager = new Map<string, number>();
  const liveByManager = new Map<string, number>();
  for (const row of totals.rows) {
    closedByManager.set(row.manager_id, (closedByManager.get(row.manager_id) ?? 0) + row.net_points);
    if (lastClosedNumber !== null && row.gameweek === lastClosedNumber) {
      lastByManager.set(row.manager_id, row.net_points);
    }
    if (current !== null && current.status === 'live' && row.gameweek === current.number) {
      liveByManager.set(row.manager_id, row.net_points);
    }
  }
  const liveExtra = current !== null && current.status === 'live' ? await liveNetByManager(pool, current.number) : new Map<string, number>();

  const entries: StandingEntry[] = members.rows.map((member) => {
    const closedTotal = closedByManager.get(member.manager_id) ?? 0;
    const lastGwPoints = lastByManager.get(member.manager_id) ?? 0;
    const livePoints = liveExtra.get(member.manager_id) ?? 0;
    const lastTotal = closedTotal - (current !== null && current.status === 'live' ? livePoints - (liveByManager.get(member.manager_id) ?? 0) : 0);
    void lastGwPoints;
    return {
      manager_id: member.manager_id,
      team_name: member.team_name,
      season_total: closedTotal + livePoints,
      last_total: lastClosedNumber === null ? null : closedTotal - livePoints,
      gameweek_points: current !== null && current.status === 'live' ? livePoints : lastGwPoints,
    };
  });
  entries.sort((a, b) => {
    if (b.season_total !== a.season_total) return b.season_total - a.season_total;
    const nameA = a.team_name.toLowerCase();
    const nameB = b.team_name.toLowerCase();
    if (nameA !== nameB) return nameA < nameB ? -1 : 1;
    return a.manager_id < b.manager_id ? -1 : 1;
  });
  const lastSorted = entries
    .slice()
    .sort((a, b) => {
      if ((b.last_total ?? -Infinity) !== (a.last_total ?? -Infinity)) return (b.last_total ?? -Infinity) - (a.last_total ?? -Infinity);
      const nameA = a.team_name.toLowerCase();
      const nameB = b.team_name.toLowerCase();
      if (nameA !== nameB) return nameA < nameB ? -1 : 1;
      return a.manager_id < b.manager_id ? -1 : 1;
    });
  const lastRankOf = new Map<string, number | null>();
  lastSorted.forEach((entry, index) => {
    lastRankOf.set(entry.manager_id, entry.last_total === null ? null : index + 1);
  });
  return entries.map((entry, index) => ({ ...entry, rank: index + 1, last_rank: lastRankOf.get(entry.manager_id) ?? null }));
}

interface StandingEntry {
  manager_id: string;
  team_name: string;
  season_total: number;
  last_total: number | null;
  gameweek_points: number;
  rank?: number;
  last_rank?: number | null;
}

async function liveNetByManager(pool: pg.Pool, gameweek: number): Promise<Map<string, number>> {
  const { rows } = await pool.query<{ manager_id: string; team_points: number; hit_points: number }>(
    `SELECT gs.manager_id, gs.points AS team_points, gs.hit_points FROM gameweek_scores gs
      WHERE gs.gameweek = $1`,
    [gameweek],
  );
  return new Map(rows.map((row) => [row.manager_id, row.team_points - row.hit_points]));
}

registerPattern('GET', '/api/leagues/{id}', async (ctx, services, params) => {
  const manager = await requireNonOperator(ctx);
  const league = await services.pool.query<{ id: string; name: string; code: string; admin_manager_id: string }>(
    'SELECT id, name, code, admin_manager_id FROM leagues WHERE id = $1',
    [params.id],
  );
  if (league.rows.length === 0) throw notFound();
  const member = await services.pool.query('SELECT 1 FROM league_members WHERE league_id = $1 AND manager_id = $2', [params.id, manager.id]);
  if (member.rows.length === 0) throw notFound();
  const current = await fetchGameweekLive(services.pool);
  const standings = await standingsFor(services.pool, params.id);
  return {
    status: 200,
    body: {
      id: league.rows[0].id,
      name: league.rows[0].name,
      code: league.rows[0].admin_manager_id === manager.id ? league.rows[0].code : null,
      gameweek: current?.number ?? 1,
      standings: standings.map((entry) => ({
        rank: entry.rank ?? 0,
        last_rank: entry.last_rank ?? null,
        manager_id: entry.manager_id,
        team_name: entry.team_name,
        gameweek_points: entry.gameweek_points,
        season_total: entry.season_total,
      })),
    },
  };
});

registerPattern('POST', '/api/leagues/{id}/code', async (ctx, services, params) => {
  const manager = await requireNonOperator(ctx);
  const league = await services.pool.query<{ id: string; admin_manager_id: string }>(
    'SELECT id, admin_manager_id FROM leagues WHERE id = $1 FOR UPDATE',
    [params.id],
  );
  if (league.rows.length === 0) throw notFound();
  const member = await services.pool.query('SELECT 1 FROM league_members WHERE league_id = $1 AND manager_id = $2', [params.id, manager.id]);
  if (member.rows.length === 0) throw notFound();
  if (league.rows[0].admin_manager_id !== manager.id) throw forbidden();
  const code = randomJoinCode();
  await services.pool.query('UPDATE leagues SET code = $1 WHERE id = $2', [code, params.id]);
  return { status: 200, body: { code } };
});

registerPattern('GET', '/api/leagues/{id}/members/{managerId}/history', async (ctx, services, params) => {
  const caller = await requireNonOperator(ctx);
  const member = await services.pool.query('SELECT 1 FROM league_members WHERE league_id = $1 AND manager_id = $2', [params.id, caller.id]);
  if (member.rows.length === 0) throw notFound();
  const target = await services.pool.query('SELECT 1 FROM league_members WHERE league_id = $1 AND manager_id = $2', [params.id, params.managerId]);
  if (target.rows.length === 0) throw notFound();
  return { status: 200, body: await historyViewFor(services.pool, params.managerId) };
});

registerPattern('GET', '/api/leagues/{id}/members/{managerId}/snapshots/{gameweek}', async (ctx, services, params) => {
  const caller = await requireNonOperator(ctx);
  const member = await services.pool.query('SELECT 1 FROM league_members WHERE league_id = $1 AND manager_id = $2', [params.id, caller.id]);
  if (member.rows.length === 0) throw notFound();
  const target = await services.pool.query('SELECT 1 FROM league_members WHERE league_id = $1 AND manager_id = $2', [params.id, params.managerId]);
  if (target.rows.length === 0) throw notFound();
  const gameweek = asIntInRange(Number(params.gameweek), 'gameweek', 1, GAMEWEEK_COUNT);
  return snapshotResult(services, params.managerId, gameweek);
});

// ---------- Notices ----------

route('GET', '/api/notices', async (ctx, services) => {
  const manager = await requireManager(ctx);
  try {
    const rows = await services.pocketbase.listNotices(manager.pocketbase_id);
    const notices = rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      gameweek: row.gameweek,
      message: row.message,
      read: row.read,
      created: row.created,
    }));
    return { status: 200, body: { unread: notices.filter((notice) => !notice.read).length, notices } };
  } catch {
    throw new ApiError(503, 'inbox_unavailable', 'Notices are unavailable right now.');
  }
});

route('POST', '/api/notices/read-all', async (ctx, services) => {
  const manager = await requireManager(ctx);
  try {
    await services.pocketbase.markAllRead(manager.pocketbase_id);
  } catch {
    throw new ApiError(503, 'inbox_unavailable', 'Notices are unavailable right now.');
  }
  return { status: 204, body: undefined };
});

// ---------- Operator ----------

registerPattern('PUT', '/api/operator/gameweeks/{n}/fixtures', async (ctx, services, params) => {
  await requireOperator(ctx);
  const gameweek = asIntInRange(Number(params.n), 'gameweek', 1, GAMEWEEK_COUNT);
  const body = asRecord(ctx.body);
  if (!Array.isArray(body.fixtures)) throw validationError({ fixtures: 'Send exactly five fixtures.' });
  const fixtures = body.fixtures as unknown[];
  const fields: Record<string, string> = {};
  if (fixtures.length !== 5) fields.fixtures = 'Send exactly five fixtures.';
  const parsed: { home: string; away: string; kickoff: Date }[] = [];
  fixtures.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      fields.fixtures = 'Send exactly five fixtures.';
      return;
    }
    const record = entry as Record<string, unknown>;
    const home = typeof record.home === 'string' ? record.home : '';
    const away = typeof record.away === 'string' ? record.away : '';
    const kickoff = typeof record.kickoff === 'string' ? new Date(record.kickoff) : null;
    if (!CLUBS.some((club) => club.code === home)) fields.fixtures = 'Every fixture needs a home club code.';
    if (!CLUBS.some((club) => club.code === away)) fields.fixtures = 'Every fixture needs an away club code.';
    if (home === away) fields.fixtures = 'A club cannot play itself.';
    if (kickoff === null || Number.isNaN(kickoff.getTime())) fields.fixtures = 'Every kickoff needs an ISO 8601 time with an offset.';
    else parsed.push({ home, away, kickoff });
  });
  const clubUse = new Map<string, number>();
  for (const fixture of parsed) {
    clubUse.set(fixture.home, (clubUse.get(fixture.home) ?? 0) + 1);
    clubUse.set(fixture.away, (clubUse.get(fixture.away) ?? 0) + 1);
  }
  for (const [club, count] of clubUse) {
    if (count !== 1) fields.fixtures = 'Every club must appear exactly once.';
  }
  if (Object.keys(fields).length > 0) throw validationError(fields);

  const client = await services.pool.connect();
  try {
    await client.query('BEGIN');
    const gw = await client.query<{ status: string }>('SELECT status FROM gameweeks WHERE number = $1 FOR UPDATE', [gameweek]);
    if (gw.rows.length === 0) {
      await client.query('ROLLBACK');
      throw notFound();
    }
    if (gw.rows[0].status !== 'open') {
      await client.query('ROLLBACK');
      throw new ApiError(409, 'gameweek_not_open', `Gameweek ${gameweek} is not open.`);
    }
    const firstKickoff = parsed.reduce((earliest, fixture) => (fixture.kickoff < earliest ? fixture.kickoff : earliest), parsed[0].kickoff);
    if (firstKickoff.getTime() <= Date.now()) {
      await client.query('ROLLBACK');
      throw validationError({ fixtures: 'The deadline must be in the future.' });
    }
    const deadline = new Date(firstKickoff.getTime() - 90 * 60000);
    await client.query('DELETE FROM fixtures WHERE gameweek = $1', [gameweek]);
    for (const fixture of parsed) {
      const id = `gw${String(gameweek).padStart(2, '0')}-${fixture.home}-${fixture.away}`;
      await client.query(
        'INSERT INTO fixtures (id, gameweek, home, away, kickoff) VALUES ($1, $2, $3, $4, $5)',
        [id, gameweek, fixture.home, fixture.away, fixture.kickoff],
      );
    }
    await client.query('UPDATE gameweeks SET deadline = $1 WHERE number = $2', [deadline, gameweek]);
    await client.query('COMMIT');
    services.hub.broadcastToManagers({ gameweekStatus: await readStatus(services.pool, gameweek) });
    return { status: 200, body: await currentPayload(services.pool) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
});

async function currentPayload(pool: pg.Pool): Promise<unknown> {
  const current = await fetchGameweekLive(pool);
  const fixtures = current === null ? [] : await fetchFixtureRow(pool, current.number);
  return {
    number: current?.number ?? 1,
    status: current?.status ?? 'upcoming',
    deadline: current?.deadline === null || current === null ? null : current.deadline.toISOString(),
    deadline_local: current?.deadline === null || current === null ? null : formatDeadline(toLeagueTime(current.deadline)),
    first_kickoff: fixtures.length === 0 ? null : fixtures[0].kickoff.toISOString(),
    fixtures: fixtures.map((fixture) => ({ id: fixture.id, home: fixture.home, away: fixture.away, kickoff: fixture.kickoff.toISOString() })),
    server_time: new Date().toISOString(),
  };
}

registerPattern('POST', '/api/operator/gameweeks/{n}/start', async (ctx, services, params) => {
  await requireOperator(ctx);
  const gameweek = asIntInRange(Number(params.n), 'gameweek', 1, GAMEWEEK_COUNT);
  const client = await services.pool.connect();
  try {
    await client.query('BEGIN');
    const gw = await client.query<{ status: string }>('SELECT status FROM gameweeks WHERE number = $1 FOR UPDATE', [gameweek]);
    if (gw.rows.length === 0) {
      await client.query('ROLLBACK');
      throw notFound();
    }
    if (gw.rows[0].status !== 'locked') {
      await client.query('ROLLBACK');
      throw new ApiError(409, 'gameweek_not_locked', `Gameweek ${gameweek} is not locked.`);
    }
    await client.query(`UPDATE gameweeks SET status = 'live' WHERE number = $1`, [gameweek]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  services.hub.broadcastToManagers({ gameweekStatus: await readStatus(services.pool, gameweek) });
  return { status: 200, body: { number: gameweek, status: 'live' } };
});

route('POST', '/api/operator/events', async (ctx, services) => {
  await requireOperator(ctx);
  const body = asRecord(ctx.body);
  const eventId = typeof body.event_id === 'string' ? body.event_id : '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(eventId)) throw validationError({ event_id: 'Send 1 to 64 letters, digits, - or _.' });
  const fixtureId = typeof body.fixture_id === 'string' ? body.fixture_id : '';
  const playerId = typeof body.player_id === 'string' ? body.player_id : '';
  const type = typeof body.type === 'string' ? body.type : '';
  if (!EVENT_TYPES.includes(type as EventType)) throw validationError({ type: 'Send a published event type.' });
  const value = body.value;

  const client = await services.pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query<{ gameweek: number; fixture_id: string; player_id: string; type: string; value: number | null; points_delta: number; voided: boolean; recorded_at: Date }>(
      'SELECT gameweek, fixture_id, player_id, type, value, points_delta, voided, recorded_at FROM events WHERE event_id = $1',
      [eventId],
    );
    const requestedBody = { event_id: eventId, fixture_id: fixtureId, player_id: playerId, type, value: value === undefined ? null : value };
    if (existing.rows.length > 0) {
      const stored = existing.rows[0];
      const storedBody = { event_id: eventId, fixture_id: stored.fixture_id, player_id: stored.player_id, type: stored.type, value: stored.value };
      const sameBody = JSON.stringify(storedBody) === JSON.stringify(requestedBody);
      await client.query('ROLLBACK');
      if (!sameBody) {
        throw new ApiError(409, 'event_id_conflict', 'That event id was already used for a different event.');
      }
      return {
        status: 201,
        body: {
          event_id: eventId,
          gameweek: stored.gameweek,
          fixture_id: stored.fixture_id,
          player_id: stored.player_id,
          type: stored.type,
          value: stored.value,
          points_delta: stored.points_delta,
          voided: stored.voided,
          recorded_at: stored.recorded_at.toISOString(),
        },
        headers: { 'Idempotent-Replayed': 'true' },
      };
    }

    const fixture = await client.query<{ gameweek: number; home: string; away: string }>(
      'SELECT gameweek, home, away FROM fixtures WHERE id = $1',
      [fixtureId],
    );
    if (fixture.rows.length === 0) throw validationError({ fixture_id: 'Unknown fixture.' });
    const gameweek = fixture.rows[0].gameweek;
    const gw = await client.query<{ status: string }>('SELECT status FROM gameweeks WHERE number = $1', [gameweek]);
    if (gw.rows[0].status !== 'live') {
      await client.query('ROLLBACK');
      throw new ApiError(409, 'gameweek_not_live', `Gameweek ${gameweek} is not live.`);
    }
    const player = await client.query<{ club: string; position: Position }>('SELECT club, position FROM players WHERE id = $1', [playerId]);
    if (player.rows.length === 0) throw validationError({ player_id: 'Unknown player.' });
    if (player.rows[0].club !== fixture.rows[0].home && player.rows[0].club !== fixture.rows[0].away) {
      throw validationError({ player_id: 'That player is not in this fixture.' });
    }
    if ((type === 'minutes' || type === 'bonus') && (typeof value !== 'number' || !Number.isInteger(value))) {
      throw validationError({ value: 'Send a whole number.' });
    }
    const numericValue = typeof value === 'number' ? value : null;
    if (type === 'minutes' && (numericValue === null || numericValue < 1 || numericValue > 120)) throw validationError({ value: 'Send minutes between 1 and 120.' });
    if (type === 'bonus' && (numericValue === null || numericValue < 1 || numericValue > 3)) throw validationError({ value: 'Send a bonus of 1 to 3.' });
    if (type !== 'minutes' && type !== 'bonus' && value !== undefined) {
      throw validationError({ value: 'Send no value for this event type.' });
    }

    let pointsDelta = eventPoints(type as EventType, player.rows[0].position, numericValue);
    if (type === 'minutes') {
      const previous = await client.query<{ value: number | null }>(
        "SELECT value FROM events WHERE player_id = $1 AND fixture_id = $2 AND type = 'minutes' AND voided = false",
        [playerId, fixtureId],
      );
      let best = 0;
      for (const row of previous.rows) best = Math.max(best, row.value ?? 0);
      const appearance = eventPoints('minutes', player.rows[0].position, numericValue);
      const previousAppearance = eventPoints('minutes', player.rows[0].position, best);
      pointsDelta = appearance - previousAppearance;
    }

    await client.query(
      'INSERT INTO events (event_id, gameweek, fixture_id, player_id, type, value, points_delta) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [eventId, gameweek, fixtureId, playerId, type, type === 'minutes' || type === 'bonus' ? value : null, pointsDelta],
    );
    await client.query('COMMIT');
    await broadcastPoints(services, gameweek);
    return {
      status: 201,
      body: {
        event_id: eventId,
        gameweek,
        fixture_id: fixtureId,
        player_id: playerId,
        type,
        value: numericValue,
        points_delta: pointsDelta,
        voided: false,
        recorded_at: new Date().toISOString(),
      },
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
});

async function broadcastPoints(services: ServerServices, gameweek: number): Promise<void> {
  const squads = await services.pool.query<{ manager_id: string; pocketbase_id: string; team_name: string }>(
    `SELECT sm.manager_id, m.pocketbase_id, m.team_name
       FROM squad_meta sm JOIN managers m ON m.id = sm.manager_id`,
  );
  for (const squad of squads.rows) {
    const view = await buildSquadView(services.pool, squad.manager_id);
    if (view === null) continue;
    services.hub.broadcastToManagers({
      points: {
        perPlayer: view.players.map((player) => ({
          player_id: player.id,
          delta: player.team_points,
          team_points: player.team_points,
        })),
        gameweek_total: view.gameweek_total,
      },
    });
  }
}

registerPattern('POST', '/api/operator/events/{eventId}/void', async (ctx, services, params) => {
  await requireOperator(ctx);
  const client = await services.pool.connect();
  try {
    await client.query('BEGIN');
    const event = await client.query<{ gameweek: number; fixture_id: string; player_id: string; type: string; value: number | null; points_delta: number; voided: boolean; recorded_at: Date }>(
      'SELECT gameweek, fixture_id, player_id, type, value, points_delta, voided, recorded_at FROM events WHERE event_id = $1 FOR UPDATE',
      [params.eventId],
    );
    if (event.rows.length === 0) {
      await client.query('ROLLBACK');
      throw notFound();
    }
    const stored = event.rows[0];
    const gw = await client.query<{ status: string }>('SELECT status FROM gameweeks WHERE number = $1', [stored.gameweek]);
    if (gw.rows[0].status !== 'live') {
      await client.query('ROLLBACK');
      throw new ApiError(409, 'gameweek_not_live', `Gameweek ${stored.gameweek} is not live.`);
    }
    if (!stored.voided) {
      await client.query('UPDATE events SET voided = true WHERE event_id = $1', [params.eventId]);
    }
    await client.query('COMMIT');
    await broadcastPoints(services, stored.gameweek);
    return {
      status: 200,
      body: {
        event_id: params.eventId,
        gameweek: stored.gameweek,
        fixture_id: stored.fixture_id,
        player_id: stored.player_id,
        type: stored.type,
        value: stored.value,
        points_delta: stored.points_delta,
        voided: true,
        recorded_at: stored.recorded_at.toISOString(),
      },
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
});

registerPattern('GET', '/api/operator/gameweeks/{n}/events', async (ctx, services, params) => {
  await requireOperator(ctx);
  const gameweek = asIntInRange(Number(params.n), 'gameweek', 1, GAMEWEEK_COUNT);
  const { rows } = await services.pool.query<{
    event_id: string; gameweek: number; fixture_id: string; player_id: string; type: string;
    value: number | null; points_delta: number; voided: boolean; recorded_at: Date;
  }>(
    'SELECT event_id, gameweek, fixture_id, player_id, type, value, points_delta, voided, recorded_at FROM events WHERE gameweek = $1 ORDER BY recorded_at, event_id',
    [gameweek],
  );
  return {
    status: 200,
    body: {
      events: rows.map((row) => ({
        event_id: row.event_id,
        gameweek: row.gameweek,
        fixture_id: row.fixture_id,
        player_id: row.player_id,
        type: row.type,
        value: row.value,
        points_delta: row.points_delta,
        voided: row.voided,
        recorded_at: row.recorded_at.toISOString(),
      })),
    },
  };
});

registerPattern('POST', '/api/operator/gameweeks/{n}/close', async (ctx, services, params) => {
  await requireOperator(ctx);
  const gameweek = asIntInRange(Number(params.n), 'gameweek', 1, GAMEWEEK_COUNT);
  const { closeGameweek } = await import('./close');
  const result = await closeGameweek(services.pool, services.storage, services.hub, gameweek);
  return { status: 200, body: result };
});

route('POST', '/api/operator/price-runs', async (ctx, services) => {
  await requireOperator(ctx);
  const body = asRecord(ctx.body);
  const runDate = typeof body.run_date === 'string' ? body.run_date : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate) || Number.isNaN(new Date(`${runDate}T00:00:00Z`).getTime())) {
    throw validationError({ run_date: 'Send a date as year-month-day.' });
  }
  if (!Array.isArray(body.moves) || body.moves.length < 1 || body.moves.length > 200) {
    throw validationError({ moves: 'Send 1 to 200 moves.' });
  }
  const seen = new Set<string>();
  const parsed: { player_id: string; delta_tenths: number }[] = [];
  for (const move of body.moves as unknown[]) {
    if (typeof move !== 'object' || move === null) throw validationError({ moves: 'Send player_id and delta_tenths.' });
    const record = move as Record<string, unknown>;
    const playerId = typeof record.player_id === 'string' ? record.player_id : '';
    const delta = record.delta_tenths;
    if (typeof playerId !== 'string' || playerId === '' || seen.has(playerId)) {
      throw validationError({ moves: 'No player may appear twice.' });
    }
    if (delta !== 1 && delta !== -1) throw validationError({ moves: 'Each move changes the price by one tenth.' });
    seen.add(playerId);
    parsed.push({ player_id: playerId, delta_tenths: delta as number });
  }

  const client = await services.pool.connect();
  try {
    await client.query('BEGIN');
    const statuses = await client.query<{ status: string }>(
      "SELECT status FROM gameweeks WHERE status IN ('locked', 'live') LIMIT 1",
    );
    if (statuses.rows.length > 0) {
      await client.query('ROLLBACK');
      throw new ApiError(409, 'prices_frozen', 'Prices are frozen until the gameweek closes.');
    }
    const used = await client.query('SELECT 1 FROM price_runs WHERE run_date = $1 FOR UPDATE', [runDate]);
    if (used.rows.length > 0) {
      await client.query('ROLLBACK');
      throw new ApiError(409, 'run_date_used', `A price change already ran for ${runDate}.`);
    }

    const current = await fetchGameweekLive(services.pool);
    const gameweek = current?.number ?? 1;
    const applied: { player_id: string; delta_tenths: number; price_tenths: number }[] = [];
    const skipped: { player_id: string; reason: string }[] = [];
    const notices: Parameters<typeof queueNotices>[1] = [];

    for (const move of parsed) {
      const player = await client.query<{ price_tenths: number; name: string }>(
        'SELECT price_tenths, name FROM players WHERE id = $1',
        [move.player_id],
      );
      if (player.rows.length === 0) {
        await client.query('ROLLBACK');
        throw validationError({ moves: 'Unknown player id.' });
      }
      const moveCount = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM price_moves_log WHERE player_id = $1 AND created_at > (SELECT COALESCE(MAX(locked_at), to_timestamp(0)) FROM gameweeks WHERE status IN ($2, $3, $4))',
        [move.player_id, 'open', 'locked', 'live'],
      );
      const movesSinceOpen = Number(moveCount.rows[0].count);
      if (movesSinceOpen >= PRICE_MOVES_PER_GAMEWEEK) {
        skipped.push({ player_id: move.player_id, reason: 'gameweek_cap' });
        continue;
      }
      const newPrice = Math.max(0, player.rows[0].price_tenths + move.delta_tenths);
      await client.query('UPDATE players SET price_tenths = $1 WHERE id = $2', [newPrice, move.player_id]);
      await client.query(
        'INSERT INTO price_moves_log (id, player_id, run_date, delta_tenths) VALUES ($1, $2, $3, $4)',
        [`pm_${randomId(14)}`, move.player_id, runDate, move.delta_tenths],
      );
      applied.push({ player_id: move.player_id, delta_tenths: move.delta_tenths, price_tenths: newPrice });

      const owners = await client.query<{ manager_id: string; pocketbase_id: string }>(
        `SELECT sm.manager_id, m.pocketbase_id
           FROM squad_players sp JOIN squad_meta sm ON sm.manager_id = sp.manager_id JOIN managers m ON m.id = sp.manager_id
          WHERE sp.player_id = $1`,
        [move.player_id],
      );
      const label = move.delta_tenths > 0 ? 'rose' : 'fell';
      const priceLabel = formatMillions(newPrice);
      for (const owner of owners.rows) {
        notices.push({
          manager_id: owner.manager_id,
          pocketbase_user_id: owner.pocketbase_id,
          kind: 'price_change',
          gameweek,
          message: `${player.rows[0].name} ${label} to ${priceLabel}m.`,
        });
      }
    }

    await queueNotices(client, notices);
    await client.query(
      'INSERT INTO price_runs (run_date, applied, skipped) VALUES ($1, $2, $3)',
      [runDate, JSON.stringify(applied), JSON.stringify(skipped)],
    );
    await client.query('COMMIT');
    for (const item of applied) {
      services.hub.broadcastToManagers({ price: { player_id: item.player_id, price_tenths: item.price_tenths } });
    }
    return { status: 201, body: { run_date: runDate, applied, skipped } };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
});

route('POST', '/api/squad', async (ctx, services) => {
  const manager = await requireNonOperator(ctx);
  const body = asRecord(ctx.body);
  const players = asIdList(body.players, 'players');
  const current = await fetchGameweekLive(services.pool);
  if (current === null) throw new ApiError(409, 'gameweek_not_open', 'No gameweek is open.');
  currentStatusGuard(current.status, current.number);
  if (current.deadline !== null && Date.now() >= current.deadline.getTime()) {
    throw lockedRefusal(current.number);
  }

  const client = await services.pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT 1 FROM squads WHERE manager_id = $1', [manager.id]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      throw new ApiError(409, 'squad_exists', 'You already have a squad this season.');
    }
    const catalogue = await client.query<{ id: string; name: string; club: string; position: Position; price_tenths: number }>(
      'SELECT id, name, club, position, price_tenths FROM players',
    );
    const catalogueMap = new Map(catalogue.rows.map((row) => [row.id, row]));
    const fields: Record<string, string> = {};
    for (const id of players) {
      if (!catalogueMap.has(id)) fields.players = 'Unknown player id.';
    }
    if (Object.keys(fields).length > 0) {
      await client.query('ROLLBACK');
      throw validationError(fields);
    }
    const squadPlayers = players.map((id) => {
      const info = catalogueMap.get(id)!;
      return { id, name: info.name, club: info.club, position: info.position, purchase_price_tenths: info.price_tenths, price_tenths: info.price_tenths };
    });
    const cost = squadPlayers.reduce((sum, player) => sum + player.price_tenths, 0);
    const violations = checkSquadRules({ players: squadPlayers, moneyAvailableTenths: OPENING_BUDGET_TENTHS, costTenths: cost });
    if (violations.length > 0) {
      await client.query('ROLLBACK');
      throw rulesBrokenError(violations);
    }

    await client.query('INSERT INTO squads (manager_id) VALUES ($1)', [manager.id]);
    for (const player of squadPlayers) {
      await client.query(
        'INSERT INTO squad_players (manager_id, player_id, purchase_price_tenths) VALUES ($1, $2, $3)',
        [manager.id, player.id, player.purchase_price_tenths],
      );
    }
    await client.query(
      'INSERT INTO squad_meta (manager_id, bank_tenths, free_transfers, transfers_made) VALUES ($1, $2, 1, 0)',
      [manager.id, OPENING_BUDGET_TENTHS - cost],
    );
    await insertLedgerEntry(client, {
      manager_id: manager.id,
      kind: 'opening_budget',
      amount_tenths: OPENING_BUDGET_TENTHS,
      player_id: null,
      transfer_id: null,
      reverses: null,
      gameweek: current.number,
    });
    for (const player of squadPlayers) {
      await insertLedgerEntry(client, {
        manager_id: manager.id,
        kind: 'purchase',
        amount_tenths: -player.price_tenths,
        player_id: player.id,
        transfer_id: null,
        reverses: null,
        gameweek: current.number,
      });
    }

    const lineup = defaultLineup(squadPlayers);
    await client.query(
      'INSERT INTO picks (manager_id, gameweek, starting, bench, captain, vice_captain) VALUES ($1, $2, $3, $4, $5, $6)',
      [manager.id, current.number, lineup.starting, lineup.bench, lineup.captain, lineup.vice_captain],
    );
    await client.query('COMMIT');
    const view = await buildSquadView(services.pool, manager.id);
    return { status: 201, body: view };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
});

function lockedRefusal(gameweek: number): ApiError {
  return new ApiError(409, 'gameweek_locked', `Deadline passed. Gameweek ${gameweek} is locked, so this change was not saved.`);
}

route('GET', '/api/squad', async (ctx, services) => {
  const manager = await requireNonOperator(ctx);
  const view = await buildSquadView(services.pool, manager.id);
  if (view === null) throw new ApiError(404, 'no_squad', 'Create your squad first.');
  return { status: 200, body: view };
});

route('PUT', '/api/picks', async (ctx, services) => {
  const manager = await requireNonOperator(ctx);
  const body = asRecord(ctx.body);
  const gameweek = asIntInRange(body.gameweek, 'gameweek', 1, GAMEWEEK_COUNT);
  const starting = asIdList(body.starting, 'starting');
  const bench = asIdList(body.bench, 'bench');
  const captain = typeof body.captain === 'string' ? body.captain : null;
  const viceCaptain = typeof body.vice_captain === 'string' ? body.vice_captain : null;

  const client = await services.pool.connect();
  try {
    await client.query('BEGIN');
    const gw = await client.query<{ status: string }>('SELECT status FROM gameweeks WHERE number = $1', [gameweek]);
    if (gw.rows.length === 0) throw new ApiError(404, 'not_found', 'No such gameweek.');
    currentStatusGuard(gw.rows[0].status, gameweek);
    const current = await fetchGameweekLive(services.pool);
    if (current !== null && current.deadline !== null && Date.now() >= current.deadline.getTime()) {
      await queueNotices(client, [{
        manager_id: manager.id,
        pocketbase_user_id: manager.pocketbase_id,
        kind: 'transfer_refused',
        gameweek,
        message: `Your change for gameweek ${gameweek} arrived after the deadline and was not saved.`,
      }]);
      await client.query('COMMIT');
      throw lockedRefusal(gameweek);
    }

    const squadRows = await client.query<{ player_id: string; position: Position; club: string }>(
      `SELECT sp.player_id, p.position, p.club FROM squad_players sp JOIN players p ON p.id = sp.player_id WHERE sp.manager_id = $1`,
      [manager.id],
    );
    if (squadRows.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new ApiError(404, 'no_squad', 'Create your squad first.');
    }
    const squadMap = new Map(squadRows.rows.map((row) => [row.player_id, row]));
    const idSet = new Set([...starting, ...bench]);
    if (idSet.size !== 15 || starting.length !== ELEVEN_SIZE || bench.length !== BENCH_SIZE) {
      const fields: Record<string, string> = {};
      if (starting.length !== ELEVEN_SIZE || bench.length !== BENCH_SIZE) fields.starting = 'Send eleven starters and four bench players.';
      if (idSet.size !== [...starting, ...bench].length) fields.starting = 'The ids are not exactly the squad.';
      for (const id of [...starting, ...bench]) {
        if (!squadMap.has(id)) fields.starting = 'The ids are not exactly the squad.';
      }
      await client.query('ROLLBACK');
      throw validationError(fields);
    }

    const ordered = regroupEleven(starting, (id) => squadMap.get(id)?.position ?? 'GK');
    const slots = ordered.map((id) => ({ player_id: id, position: squadMap.get(id)?.position ?? 'GK' }));
    const violations = checkShapeRules(slots, bench.length, captain, viceCaptain);
    if (violations.length > 0) {
      await client.query('ROLLBACK');
      throw shapeRulesBrokenError(violations);
    }

    await client.query(
      `INSERT INTO picks (manager_id, gameweek, starting, bench, captain, vice_captain)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (manager_id, gameweek) DO UPDATE SET starting = EXCLUDED.starting, bench = EXCLUDED.bench, captain = EXCLUDED.captain, vice_captain = EXCLUDED.vice_captain`,
      [manager.id, gameweek, ordered, bench, captain, viceCaptain],
    );
    await client.query('COMMIT');
    const view = await buildSquadView(services.pool, manager.id);
    services.hub.broadcastToManagers({ squadUpdate: { manager_id: manager.id } });
    return { status: 200, body: view };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
});

const POSITION_SORT: Record<Position, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

function regroupEleven(starting: string[], positionOf: (id: string) => Position): string[] {
  const byPosition = new Map<Position, string[]>();
  for (const id of starting) {
    const position = positionOf(id);
    const list = byPosition.get(position) ?? [];
    list.push(id);
    byPosition.set(position, list);
  }
  const ordered: string[] = [];
  (['GK', 'DEF', 'MID', 'FWD'] as Position[]).forEach((position) => {
    ordered.push(...(byPosition.get(position) ?? []));
  });
  return ordered;
}

route('POST', '/api/chips', async (ctx, services) => {
  const manager = await requireNonOperator(ctx);
  const body = asRecord(ctx.body);
  const gameweek = asIntInRange(body.gameweek, 'gameweek', 1, GAMEWEEK_COUNT);
  const chip = body.chip;
  if (typeof chip !== 'string' || !CHIP_CODES.includes(chip as ChipCode)) {
    throw validationError({ chip: 'Send wildcard, free_hit, bench_boost or triple_captain.' });
  }
  const chipCode = chip as ChipCode;

  const client = await services.pool.connect();
  try {
    await client.query('BEGIN');
    const gw = await client.query<{ status: string }>('SELECT status FROM gameweeks WHERE number = $1 FOR UPDATE', [gameweek]);
    if (gw.rows.length === 0) throw new ApiError(404, 'not_found', 'No such gameweek.');
    currentStatusGuard(gw.rows[0].status, gameweek);

    const hasSquad = await client.query('SELECT 1 FROM squads WHERE manager_id = $1', [manager.id]);
    if (hasSquad.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new ApiError(404, 'no_squad', 'Create your squad first.');
    }
    const played = await client.query<{ gameweek: number; chip: string }>(
      'SELECT gameweek, chip FROM chips WHERE manager_id = $1 AND cancelled = false',
      [manager.id],
    );
    const thisGw = played.rows.find((row) => row.gameweek === gameweek);
    if (thisGw !== undefined) {
      await client.query('ROLLBACK');
      throw new ApiError(409, 'chip_already_this_gameweek', 'Only one chip can be played in a gameweek.');
    }
    const half = seasonHalfOf(gameweek);
    const usedThisHalf = played.rows.some((row) => row.chip === chipCode && seasonHalfOf(row.gameweek) === half);
    if (usedThisHalf) {
      await client.query('ROLLBACK');
      throw new ApiError(409, 'chip_used', `${chipName(chipCode)} has already been used in this half of the season.`);
    }
    if (chipCode === 'free_hit' && played.rows.some((row) => row.chip === 'free_hit' && row.gameweek === gameweek - 1)) {
      await client.query('ROLLBACK');
      throw new ApiError(409, 'free_hit_back_to_back', 'Free Hit cannot be played in two gameweeks in a row.');
    }
    if ((chipCode === 'wildcard' || chipCode === 'free_hit')) {
      const transfers = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM transfers WHERE manager_id = $1 AND gameweek = $2',
        [manager.id, gameweek],
      );
      if (transfers.rows[0].count !== '0') {
        await client.query('ROLLBACK');
        throw new ApiError(409, 'chip_after_transfers', `${chipName(chipCode)} must be played before making transfers this gameweek.`);
      }
      if (chipCode === 'free_hit') {
        const squadRows = await client.query<{ player_id: string; purchase_price_tenths: number }>(
          'SELECT player_id, purchase_price_tenths FROM squad_players WHERE manager_id = $1',
          [manager.id],
        );
        const pick = await client.query<{ starting: string[]; bench: string[]; captain: string | null; vice_captain: string | null }>(
          'SELECT starting, bench, captain, vice_captain FROM picks WHERE manager_id = $1 AND gameweek = $2',
          [manager.id, gameweek],
        );
        const meta = await client.query<{ bank_tenths: number }>('SELECT bank_tenths FROM squad_meta WHERE manager_id = $1', [manager.id]);
        if (pick.rows.length > 0) {
          await client.query(
            `INSERT INTO free_hit_states (manager_id, gameweek, squad, picks, bank_tenths)
             VALUES ($1, $2, $3, $4, $5) ON CONFLICT (manager_id, gameweek) DO NOTHING`,
            [
              manager.id,
              gameweek,
              JSON.stringify(squadRows.rows.map((row) => ({ player_id: row.player_id, purchase_price_tenths: row.purchase_price_tenths }))),
              JSON.stringify(pick.rows[0]),
              meta.rows[0]?.bank_tenths ?? 0,
            ],
          );
        }
      }
    }
    await client.query(
      'INSERT INTO chips (id, manager_id, gameweek, chip) VALUES ($1, $2, $3, $4)',
      [`c_${randomId(12)}`, manager.id, gameweek, chipCode],
    );
    await client.query('COMMIT');
    const view = await buildSquadView(services.pool, manager.id);
    return { status: 201, body: view };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
});

function chipName(chip: ChipCode): string {
  switch (chip) {
    case 'wildcard':
      return 'Wildcard';
    case 'free_hit':
      return 'Free Hit';
    case 'bench_boost':
      return 'Bench Boost';
    case 'triple_captain':
      return 'Triple Captain';
  }
}

registerPattern('DELETE', '/api/chips/{gameweek}', async (ctx, services, params) => {
  const manager = await requireNonOperator(ctx);
  const gameweek = asIntInRange(Number(params.gameweek), 'gameweek', 1, GAMEWEEK_COUNT);
  const client = await services.pool.connect();
  try {
    await client.query('BEGIN');
    const chip = await client.query<{ chip: string }>(
      'SELECT chip FROM chips WHERE manager_id = $1 AND gameweek = $2 AND cancelled = false FOR UPDATE',
      [manager.id, gameweek],
    );
    if (chip.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new ApiError(404, 'not_found', 'No chip is played for that gameweek.');
    }
    const gw = await client.query<{ status: string }>('SELECT status FROM gameweeks WHERE number = $1', [gameweek]);
    if (gw.rows[0].status !== 'open') {
      await client.query('ROLLBACK');
      throw new ApiError(409, 'gameweek_locked', `Deadline passed. Gameweek ${gameweek} is locked, so this change was not saved.`);
    }
    const chipCode = chip.rows[0].chip as ChipCode;
    if (chipCode === 'wildcard' || chipCode === 'free_hit') {
      await client.query('ROLLBACK');
      throw new ApiError(409, 'chip_locked_in', `${chipName(chipCode)} cannot be cancelled once played.`);
    }
    await client.query('UPDATE chips SET cancelled = true WHERE manager_id = $1 AND gameweek = $2', [manager.id, gameweek]);
    await client.query('COMMIT');
    const view = await buildSquadView(services.pool, manager.id);
    return { status: 200, body: view };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
});
