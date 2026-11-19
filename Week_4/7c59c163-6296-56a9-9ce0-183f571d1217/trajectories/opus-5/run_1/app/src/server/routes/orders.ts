import { inTransaction, pool } from '../db/pool.js';
import { notFound } from '../http/errors.js';
import { json, memberRoute } from '../http/router.js';
import { cancelOrder, loadOrder, newEffects, placeOrder } from '../domain/engine.js';
import { equityFor, maintenanceFor } from '../domain/holds.js';
import { balanceOf, fillById, fillsOfMember, orderView } from '../domain/views.js';
import { publishEffects, recordOutgoing } from '../publish.js';
import { withIdempotency } from '../idempotency.js';
import { asObject, isUuid, onlyFields, readEnum, readInteger, readString } from '../domain/validate.js';
import { scheduleMaintenance } from '../workers/timers.js';
import { TRADING_ROLES, marketById, ownFill, ownOrder } from './common.js';
import type { OrderMode, OrderRow, OrderSide, Outcome, Venue } from '../domain/types.js';
import type { Route } from '../http/router.js';

const PAIR_FIELDS = ['market_id', 'mode', 'side', 'price', 'quantity'];
const EVENT_FIELDS = ['market_id', 'outcome', 'price', 'quantity'];

export const orderRoutes: Route[] = [
  memberRoute(
    'POST',
    '/api/orders',
    { apiKey: true, venue: true, roles: TRADING_ROLES },
    async ({ actor, body, request }) => {
      const key = request.headers['idempotency-key'];
      const fields = asObject(body);
      return withIdempotency(
        actor.member.id,
        'POST /api/orders',
        typeof key === 'string' ? key : undefined,
        fields,
        async () => {
          const venue = actor.venue as Venue;
          const marketId = readString(fields, 'market_id');
          if (!isUuid(marketId)) throw notFound();
          const market = await marketById(marketId, venue.id);
          if (market === null) throw notFound();

          let mode: OrderMode | null = null;
          let side: OrderSide = 'buy';
          let outcome: Outcome | null = null;
          if (market.kind === 'event') {
            onlyFields(fields, EVENT_FIELDS);
            outcome = readEnum<Outcome>(fields, 'outcome', ['yes', 'no']);
          } else {
            onlyFields(fields, PAIR_FIELDS);
            mode = readEnum<OrderMode>(fields, 'mode', ['spot', 'margin']);
            side = readEnum<OrderSide>(fields, 'side', ['buy', 'sell']);
          }
          const price = readInteger(fields, 'price');
          const quantity = readInteger(fields, 'quantity');

          const effects = newEffects();
          const result = await inTransaction(async (client) => {
            const placed = await placeOrder(
              client,
              { market, venue, memberId: actor.member.id, mode, side, outcome, price, quantity },
              effects,
            );
            await recordOutgoing(client, effects);
            return placed;
          });
          await publishEffects(effects);
          for (const pairId of effects.pairFills) scheduleMaintenance(pairId);
          return json(201, await orderView(pool, result.order));
        },
      );
    },
  ),

  memberRoute('GET', '/api/orders', { apiKey: true, venue: true }, async ({ actor, url }) => {
    const status = url.searchParams.get('status') ?? 'all';
    const marketId = url.searchParams.get('market_id');
    if (marketId !== null && !isUuid(marketId)) throw notFound();
    const result = await pool.query<OrderRow>(
      `select id, venue_id, market_id, member_id, mode, side, outcome, price, quantity, filled_quantity,
              status, hold_cents, reserved_units, taker_fee_bps, maker_fee_bps, book_side, book_price,
              sequence, created_at
         from orders
        where member_id = $1
          and ($2::uuid is null or market_id = $2)
          and ($3 = 'all' or status in ('resting','partially_filled'))
        order by created_at desc, sequence desc limit 200`,
      [actor.member.id, marketId, status === 'open' ? 'open' : 'all'],
    );
    const orders = [];
    for (const row of result.rows) orders.push(await orderView(pool, row));
    return json(200, { orders });
  }),

  memberRoute(
    'GET',
    '/api/orders/:id',
    { apiKey: true, resource: ownOrder },
    async ({ resource }) => json(200, await orderView(pool, resource)),
  ),

  memberRoute(
    'DELETE',
    '/api/orders/:id',
    { apiKey: true, resource: ownOrder },
    async ({ resource }) => {
      const effects = newEffects();
      await inTransaction(async (client) => {
        const order = await loadOrder(client, resource.id);
        if (order === null) throw notFound();
        await cancelOrder(client, order, effects);
      });
      await publishEffects(effects);
      const order = (await pool.query<OrderRow>(
        `select id, venue_id, market_id, member_id, mode, side, outcome, price, quantity, filled_quantity,
                status, hold_cents, reserved_units, taker_fee_bps, maker_fee_bps, book_side, book_price,
                sequence, created_at from orders where id = $1`,
        [resource.id],
      )).rows[0] as OrderRow;
      return json(200, await orderView(pool, order));
    },
  ),

  memberRoute('GET', '/api/fills', { apiKey: true, venue: true }, async ({ actor, url }) => {
    const marketId = url.searchParams.get('market_id');
    if (marketId !== null && !isUuid(marketId)) throw notFound();
    return json(200, { fills: await fillsOfMember(pool, actor.member.id, marketId) });
  }),

  memberRoute('GET', '/api/fills/:id', { apiKey: true, resource: ownFill }, async ({ actor, resource }) => {
    const fill = await fillById(pool, resource.id, actor.member.id);
    if (fill === null) throw notFound();
    return json(200, fill);
  }),

  memberRoute('GET', '/api/balance', { apiKey: true, venue: true }, async ({ actor }) =>
    json(200, await balanceOf(pool, actor.member.id)),
  ),

  memberRoute('GET', '/api/positions', { apiKey: true, venue: true }, async ({ actor }) => {
    const spot = await pool.query<{ market_id: string; quantity: number; reserved: number }>(
      'select market_id, quantity, reserved from spot_holdings where member_id = $1 and quantity > 0',
      [actor.member.id],
    );
    const margin = await pool.query<{
      id: string;
      market_id: string;
      side: 'long' | 'short';
      quantity: number;
      cost_cents: number;
      collateral_cents: number;
      status: 'open' | 'closed' | 'liquidated';
      last_price: number | null;
    }>(
      `select p.id, p.market_id, p.side, p.quantity, p.cost_cents, p.collateral_cents, p.status,
              m.last_price
         from margin_positions p join markets m on m.id = p.market_id
        where p.member_id = $1 order by p.created_at desc`,
      [actor.member.id],
    );
    const event = await pool.query<{ market_id: string; outcome: string; quantity: number }>(
      'select market_id, outcome, quantity from event_positions where member_id = $1 and quantity > 0',
      [actor.member.id],
    );
    return json(200, {
      spot: spot.rows,
      margin: margin.rows.map((row) => {
        const mark = row.last_price ?? 0;
        return {
          id: row.id,
          market_id: row.market_id,
          side: row.side,
          quantity: row.quantity,
          cost_cents: row.cost_cents,
          collateral_cents: row.collateral_cents,
          status: row.status,
          equity_cents: equityFor(row.side, row.quantity, row.cost_cents, row.collateral_cents, mark),
          maintenance_cents: maintenanceFor(row.quantity, mark),
        };
      }),
      event: event.rows,
    });
  }),
];
