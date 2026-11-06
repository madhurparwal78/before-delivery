import { query, withClient } from '../db.js';
import { json, route, type Ctx } from '../http.js';
import { HORSE_COLUMNS, horseJson, visibleHorse, type HorseRow } from './shared.js';
import { loadVisit, visitBody } from './visits.js';

/** Horses, with the next-due date and status each one carries. */
export function registerHorseRoutes(): void {
  route({
    method: 'GET',
    path: '/api/horses',
    roles: ['farrier', 'apprentice', 'owner'],
    tokenAccess: 'read_only',
    handler: async (ctx: Ctx) => {
      const rows = await withClient(async (db) => {
        const horses = await query<HorseRow>(
          db,
          `SELECT ${HORSE_COLUMNS} FROM horses h
           JOIN barns b ON b.id = h.barn_id JOIN users o ON o.id = h.owner_id
           WHERE ($1::text IS NULL OR h.owner_id = $1)
           ORDER BY h.name`,
          [ctx.caller.role === 'owner' ? ctx.caller.userId : null],
        );
        const bodies: Record<string, unknown>[] = [];
        for (const horse of horses) {
          bodies.push(await horseJson(db, horse, ctx.caller.role === 'farrier'));
        }
        return bodies;
      });
      return json(200, rows);
    },
  });

  route({
    method: 'GET',
    path: '/api/horses/:id',
    roles: ['farrier', 'apprentice', 'owner'],
    tokenAccess: 'read_only',
    handler: async (ctx: Ctx) => {
      const body = await withClient(async (db) => {
        const horse = await visibleHorse(db, ctx.caller, ctx.params.id as string);
        return await horseJson(db, horse, ctx.caller.role === 'farrier');
      });
      return json(200, body);
    },
  });

  route({
    method: 'GET',
    path: '/api/horses/:id/visits',
    roles: ['farrier', 'apprentice', 'owner'],
    tokenAccess: 'read_only',
    handler: async (ctx: Ctx) => {
      const rows = await withClient(async (db) => {
        const horse = await visibleHorse(db, ctx.caller, ctx.params.id as string);
        const visits = await query<{ id: string }>(
          db,
          `SELECT id FROM visits WHERE horse_id = $1 AND ($2 OR status <> 'open')
           ORDER BY business_date DESC, created_at DESC`,
          [horse.id, ctx.caller.role !== 'owner'],
        );
        const bodies: Record<string, unknown>[] = [];
        for (const row of visits) {
          const visit = await loadVisit(db, row.id);
          if (visit !== null) bodies.push(await visitBody(db, visit, ctx.caller));
        }
        return bodies;
      });
      return json(200, rows);
    },
  });
}
