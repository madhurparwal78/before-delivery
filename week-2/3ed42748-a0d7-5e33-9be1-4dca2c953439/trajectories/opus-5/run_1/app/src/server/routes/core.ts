import { databaseIsConnected, query, withTransaction } from '../db/pool.js';
import { BRAMBLE_RADIUS_M, DEPOT } from '../db/seed.js';
import { sessionCookie } from '../http/boundary.js';
import { fail, validation } from '../http/errors.js';
import { checkDisplayName } from '../../shared/displayNames.js';
import { readDepot } from '../domain/board.js';
import { loadCourier, loadCourierIn } from '../domain/couriers.js';
import { historyPage } from '../domain/ledger.js';
import { outfitterView, satchels } from '../domain/outfitter.js';
import { residents } from '../domain/residents.js';
import { createGuest } from '../domain/sessions.js';
import { darkroom } from '../services/postcardStore.js';
import { postOffice } from '../services/postOffice.js';
import type { AppRoute } from '../http/app.js';
import { actorOf, meBody, published, rawJson } from './shared.js';

export const coreRoutes: AppRoute[] = [
  {
    method: 'GET',
    pattern: '/api/health',
    auth: 'anyone',
    bodyKind: 'none',
    handler: async () =>
      databaseIsConnected()
        ? { status: 200, json: { status: 'ok' } }
        : { status: 503, json: { status: 'waiting_for_database' } },
  },
  {
    method: 'GET',
    pattern: '/api/status',
    auth: 'anyone',
    bodyKind: 'none',
    handler: async () => ({
      status: 200,
      json: {
        darkroom: (await darkroom.isOpen()) ? 'open' : 'closed',
        post_office: (await postOffice.isOpen()) ? 'open' : 'closed',
      },
    }),
  },
  {
    method: 'GET',
    pattern: '/api/world',
    auth: 'anyone',
    bodyKind: 'none',
    handler: async () => ({
      status: 200,
      json: {
        radius_m: BRAMBLE_RADIUS_M,
        depot: DEPOT,
        residents: (await residents()).map((resident) => ({
          resident_id: resident.resident_id,
          name: resident.name,
          home: resident.home,
          door: resident.door,
        })),
      },
    }),
  },
  {
    method: 'POST',
    pattern: '/api/guest',
    auth: 'anyone',
    bodyKind: 'json',
    withActor: true,
    handler: async (context) => {
      published(context, {});
      if (context.actor !== null) {
        return { status: 200, json: await meBody(context.actor.courier, context.now) };
      }
      const { actor, sessionId } = await createGuest();
      return {
        status: 201,
        json: await meBody(actor.courier, context.now),
        setCookie: sessionCookie(sessionId),
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/me',
    auth: 'session',
    bodyKind: 'none',
    handler: async (context) => ({
      status: 200,
      json: await meBody(actorOf(context).courier, context.now),
    }),
  },
  {
    method: 'PATCH',
    pattern: '/api/me',
    auth: 'session',
    bodyKind: 'json',
    handler: async (context) => {
      const actor = actorOf(context);
      const raw = rawJson(context);
      if ('display_name' in raw && actor.courier.name_locked) throw fail('name_locked');

      const seeded = new Map((await satchels()).map((satchel) => [satchel.satchel_id, satchel]));
      const wantedSatchel = raw.satchel_id;
      if (typeof wantedSatchel === 'string' && seeded.has(wantedSatchel)) {
        const owned = await loadOwned(actor.courier.courier_id, wantedSatchel);
        if (!owned) throw fail('not_owned');
      }

      const body = published(context, { display_name: true, satchel_id: true });
      let storedName: string | null = null;
      if ('display_name' in body) {
        const raw2 = body.display_name;
        if (typeof raw2 !== 'string') throw validation({ display_name: 'invalid' });
        const checked = checkDisplayName(raw2);
        if (checked.fault !== null) throw validation({ display_name: checked.fault });
        storedName = checked.stored;
      }
      if ('satchel_id' in body) {
        if (typeof wantedSatchel !== 'string' || !seeded.has(wantedSatchel)) {
          throw validation({ satchel_id: 'invalid' });
        }
      }

      const courier = await withTransaction(async (tx) => {
        if (storedName !== null) {
          await tx.query('update couriers set display_name = $2 where courier_id = $1', [
            actor.courier.courier_id,
            storedName,
          ]);
        }
        if (typeof wantedSatchel === 'string') {
          await tx.query('update couriers set worn_satchel_id = $2 where courier_id = $1', [
            actor.courier.courier_id,
            wantedSatchel,
          ]);
        }
        return loadCourierIn(tx, actor.courier.courier_id);
      });
      return { status: 200, json: await meBody(courier!, context.now) };
    },
  },
  {
    method: 'GET',
    pattern: '/api/me/ledger',
    auth: 'session',
    bodyKind: 'none',
    handler: async (context) => {
      const actor = actorOf(context);
      const rawLimit = context.url.searchParams.get('limit');
      let limit = 20;
      if (rawLimit !== null) {
        const value = Number(rawLimit);
        if (rawLimit.trim() === '' || !Number.isInteger(value)) {
          throw validation({ limit: 'invalid' });
        }
        if (value < 1 || value > 50) throw validation({ limit: 'out_of_range' });
        limit = value;
      }
      const before = context.url.searchParams.get('before') ?? undefined;
      return {
        status: 200,
        json: await historyPage(actor.courier.courier_id, limit, before),
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/depot',
    auth: 'session',
    bodyKind: 'none',
    handler: async (context) => ({
      status: 200,
      json: await readDepot(actorOf(context).courier.courier_id, context.now),
    }),
  },
  {
    method: 'GET',
    pattern: '/api/outfitter',
    auth: 'session',
    bodyKind: 'none',
    handler: async (context) => {
      const actor = actorOf(context);
      const fresh = await loadCourier(actor.courier.courier_id);
      return {
        status: 200,
        json: await outfitterView(fresh!.courier_id, fresh!.worn_satchel_id),
      };
    },
  },
];

async function loadOwned(courierId: string, satchelId: string): Promise<boolean> {
  const rows = await query<{ satchel_id: string }>(
    'select satchel_id from satchels_owned where courier_id = $1 and satchel_id = $2',
    [courierId, satchelId],
  );
  return rows.length > 0;
}
