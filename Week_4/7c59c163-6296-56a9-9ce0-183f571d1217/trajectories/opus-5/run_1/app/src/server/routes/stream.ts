import { pool } from '../db/pool.js';
import { notFound } from '../http/errors.js';
import { memberRoute } from '../http/router.js';
import { bookOf, marketView } from '../domain/views.js';
import { subscribeMarket, subscribeMember } from '../providers/valkey.js';
import { isUuid } from '../domain/validate.js';
import { marketById } from './common.js';
import { marketWithClose } from './markets.js';
import type { Reply, Route } from '../http/router.js';
import type { Venue } from '../domain/types.js';

const KEEPALIVE_MS = 15_000;

export const streamRoutes: Route[] = [
  memberRoute('GET', '/api/stream', { venue: true }, async ({ actor, url, request, response }) => {
    const venue = actor.venue as Venue;
    const marketId = url.searchParams.get('market_id');
    if (marketId !== null && !isUuid(marketId)) throw notFound();
    const market = marketId === null ? null : await marketById(marketId, venue.id);
    if (marketId !== null && market === null) throw notFound();

    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    response.flushHeaders();

    const send = (event: string, data: unknown): void => {
      if (response.writableEnded) return;
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const unsubscribes: (() => void)[] = [
      await subscribeMember(actor.member.id, (message) => send(message.event, message.data)),
    ];
    if (market !== null) {
      unsubscribes.push(
        await subscribeMarket(market.id, (message) => send(message.event, message.data)),
      );
      const current = await marketWithClose(market);
      send('market', await marketView(pool, current, venue));
      send('book', await bookOf(pool, current));
    }

    const keepalive = setInterval(() => {
      if (!response.writableEnded) response.write(': keepalive\n\n');
    }, KEEPALIVE_MS);

    const close = (): void => {
      clearInterval(keepalive);
      for (const unsubscribe of unsubscribes) unsubscribe();
      if (!response.writableEnded) response.end();
    };
    request.on('close', close);
    response.on('close', close);

    return { status: 0 } satisfies Reply;
  }),
];
