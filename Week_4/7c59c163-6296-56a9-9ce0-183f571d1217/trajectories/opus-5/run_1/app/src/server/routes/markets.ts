import { randomUUID } from 'node:crypto';
import { inTransaction, pool } from '../db/pool.js';
import { ApiError, ValidationError } from '../http/errors.js';
import { json, memberRoute } from '../http/router.js';
import { applyClose, newEffects, runMaintenance } from '../domain/engine.js';
import { nextMarketStatus } from '../domain/transitions.js';
import { bookOf, iso, marketView, openInterest } from '../domain/views.js';
import { publishEffects, recordSettlementOutgoing } from '../publish.js';
import { RANGES, asObject, onlyFields, readEnum, readString } from '../domain/validate.js';
import { startOfToday } from '../domain/time.js';
import { marketOfVenue } from './common.js';
import { scheduleMarketClose, scheduleSettlement } from '../workers/timers.js';
import type { MarketKind, MarketRow, Venue } from '../domain/types.js';
import type { Route } from '../http/router.js';

const MARKET_COLUMNS =
  'id, venue_id, kind, symbol, title, status, closes_at, outcome, last_price, book_sequence, resolved_at, settled_at';

const SYMBOL = /^[A-Z0-9]{2,12}$/;

/** Reads a market with the server-decided close already applied. */
export async function marketWithClose(market: MarketRow): Promise<MarketRow> {
  if (market.kind !== 'event' || market.closes_at === null) return market;
  if (market.status !== 'trading' && market.status !== 'halted') return market;
  if (market.closes_at.getTime() > Date.now()) return market;
  const effects = newEffects();
  const closed = await inTransaction(async (client) => {
    const locked = await client.query<MarketRow>(
      `select ${MARKET_COLUMNS} from markets where id = $1 for update`,
      [market.id],
    );
    const row = locked.rows[0];
    return row === undefined ? market : applyClose(client, row, effects);
  });
  await publishEffects(effects);
  return closed;
}

async function transition(
  market: MarketRow,
  action: 'open' | 'halt' | 'resume',
): Promise<MarketRow> {
  const current = await marketWithClose(market);
  if (action !== 'halt' && current.kind === 'event' && current.closes_at !== null) {
    if (current.closes_at.getTime() <= Date.now()) {
      throw new ApiError(409, 'invalid_transition', { from: current.status, to: 'trading' });
    }
  }
  const status = nextMarketStatus(current.kind, current.status, action);
  const effects = newEffects();
  const updated = await inTransaction(async (client) => {
    const locked = await client.query<MarketRow>(
      `select ${MARKET_COLUMNS} from markets where id = $1 for update`,
      [current.id],
    );
    const row = locked.rows[0] as MarketRow;
    nextMarketStatus(row.kind, row.status, action);
    const result = await client.query<MarketRow>(
      `update markets set status = $2, book_sequence = book_sequence + 1 where id = $1
       returning ${MARKET_COLUMNS}`,
      [row.id, status],
    );
    return result.rows[0] as MarketRow;
  });
  effects.markets.add(updated.id);
  effects.books.add(updated.id);
  await publishEffects(effects);
  if (updated.status === 'trading') scheduleMarketClose(updated);
  return updated;
}

export const marketRoutes: Route[] = [
  memberRoute('GET', '/api/markets', { apiKey: true, venue: true }, async ({ actor }) => {
    const venue = actor.venue as Venue;
    const result = await pool.query<MarketRow>(
      `select ${MARKET_COLUMNS} from markets where venue_id = $1 order by created_at`,
      [venue.id],
    );
    const markets = [];
    for (const row of result.rows) markets.push(await marketView(pool, await marketWithClose(row), venue));
    return json(200, { markets });
  }),

  memberRoute(
    'GET',
    '/api/markets/:id',
    { apiKey: true, venue: true, resource: marketOfVenue },
    async ({ actor, resource }) => {
      const market = await marketWithClose(resource);
      return json(200, {
        ...(await marketView(pool, market, actor.venue as Venue)),
        server_time: iso(new Date()),
      });
    },
  ),

  memberRoute(
    'GET',
    '/api/markets/:id/book',
    { apiKey: true, venue: true, resource: marketOfVenue },
    async ({ resource }) => json(200, await bookOf(pool, await marketWithClose(resource))),
  ),

  memberRoute('GET', '/api/venue/summary', { venue: true }, async ({ actor }) => {
    const venue = actor.venue as Venue;
    const volume = await pool.query<{ total: string | null }>(
      'select sum(price * quantity) as total from trades where venue_id = $1 and at >= $2',
      [venue.id, startOfToday(venue.time_zone)],
    );
    const markets = await pool.query<MarketRow>(
      `select ${MARKET_COLUMNS} from markets where venue_id = $1`,
      [venue.id],
    );
    let contracts = 0;
    for (const market of markets.rows) contracts += await openInterest(pool, market);
    const flagship = markets.rows.find((market) => market.symbol === venue.flagship_symbol);
    return json(200, {
      volume_cents_today: Number(volume.rows[0]?.total ?? 0),
      open_interest_contracts: contracts,
      flagship_market_id: flagship?.id ?? null,
    });
  }),

  memberRoute('POST', '/api/markets', { venue: true, roles: ['market_admin'] }, async ({ actor, body }) => {
    const venue = actor.venue as Venue;
    const fields = asObject(body);
    onlyFields(fields, ['kind', 'symbol', 'title', 'closes_at']);
    const kind = readEnum<MarketKind>(fields, 'kind', ['pair', 'event']);
    const symbol = readString(fields, 'symbol');
    if (!SYMBOL.test(symbol)) throw new ValidationError({ symbol: 'invalid' });
    const title = readString(fields, 'title');
    if (title.length < RANGES.title.min || title.length > RANGES.title.max) {
      throw new ValidationError({ title: 'invalid' });
    }

    let closesAt: Date | null = null;
    if (kind === 'event') {
      const raw = readString(fields, 'closes_at');
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
        throw new ValidationError({ closes_at: 'invalid' });
      }
      closesAt = parsed;
    } else if (fields.closes_at !== undefined) {
      throw new ValidationError({ closes_at: 'invalid' });
    }

    const taken = await pool.query('select 1 from markets where venue_id = $1 and symbol = $2', [
      venue.id,
      symbol,
    ]);
    if (taken.rowCount !== 0) throw new ApiError(409, 'symbol_taken');

    const result = await pool.query<MarketRow>(
      `insert into markets (id, venue_id, kind, symbol, title, status, closes_at)
       values ($1,$2,$3,$4,$5,'listed',$6) returning ${MARKET_COLUMNS}`,
      [randomUUID(), venue.id, kind, symbol, title, closesAt],
    );
    return json(201, await marketView(pool, result.rows[0] as MarketRow, venue));
  }),

  memberRoute(
    'POST',
    '/api/markets/:id/open',
    { venue: true, roles: ['market_admin'], resource: marketOfVenue },
    async ({ actor, resource }) =>
      json(200, await marketView(pool, await transition(resource, 'open'), actor.venue as Venue)),
  ),

  memberRoute(
    'POST',
    '/api/markets/:id/halt',
    { venue: true, roles: ['market_admin'], resource: marketOfVenue },
    async ({ actor, resource }) =>
      json(200, await marketView(pool, await transition(resource, 'halt'), actor.venue as Venue)),
  ),

  memberRoute(
    'POST',
    '/api/markets/:id/resume',
    { venue: true, roles: ['market_admin'], resource: marketOfVenue },
    async ({ actor, resource }) =>
      json(200, await marketView(pool, await transition(resource, 'resume'), actor.venue as Venue)),
  ),

  memberRoute(
    'POST',
    '/api/markets/:id/resolve',
    { venue: true, roles: ['market_admin'], resource: marketOfVenue },
    async ({ actor, resource, body }) => {
      const venue = actor.venue as Venue;
      const fields = asObject(body);
      onlyFields(fields, ['outcome']);
      const outcome = readEnum<'yes' | 'no'>(fields, 'outcome', ['yes', 'no']);
      const current = await marketWithClose(resource);
      const status = nextMarketStatus(current.kind, current.status, 'resolve');

      const resolved = await inTransaction(async (client) => {
        const locked = await client.query<MarketRow>(
          `select ${MARKET_COLUMNS} from markets where id = $1 for update`,
          [current.id],
        );
        const row = locked.rows[0] as MarketRow;
        nextMarketStatus(row.kind, row.status, 'resolve');
        const updated = await client.query<MarketRow>(
          `update markets set status = $2, outcome = $3, resolved_at = now() where id = $1
           returning ${MARKET_COLUMNS}`,
          [row.id, status, outcome],
        );
        const market = updated.rows[0] as MarketRow;
        await recordSettlementOutgoing(client, market, venue.slug);
        return market;
      });
      const effects = newEffects();
      effects.markets.add(resolved.id);
      await publishEffects(effects);
      scheduleSettlement(resolved.id);
      return json(200, await marketView(pool, resolved, venue));
    },
  ),

  memberRoute(
    'POST',
    '/api/markets/:id/liquidations',
    { venue: true, roles: ['market_admin'], resource: marketOfVenue },
    async ({ resource }) => {
      if (resource.kind !== 'pair') throw new ApiError(409, 'not_a_pair');
      const effects = newEffects();
      const result = await inTransaction(async (client) => {
        const locked = await client.query<MarketRow>(
          `select ${MARKET_COLUMNS} from markets where id = $1`,
          [resource.id],
        );
        return runMaintenance(client, locked.rows[0] as MarketRow, effects);
      });
      await publishEffects(effects);
      return json(200, result);
    },
  ),
];
