/**
 * Clients, and the one place a client's state moves.
 */
import { F } from '../../shared/feedback.ts';
import { LANGUAGES, type Language } from '../../shared/language.ts';
import { TOWNS, type Town } from '../domain/time.ts';
import { TOWN_CURRENCY } from '../domain/money.ts';
import { fail } from '../http/errors.ts';
import { Check, LIMITS } from '../http/validate.ts';
import type { Route } from '../http/context.ts';
import { findClientAnyState, resolveClient, client as resolved } from './lookup.ts';
import { presentClient, type Row } from '../present.ts';
import { clientEntry, entryId, putEntries, removeEntries } from '../features/indexing.ts';
import { SearchUnavailable } from '../services/search.ts';

/** A client's language starts as the town's. */
const TOWN_LANGUAGE: Record<Town, Language> = {
  Turin: 'it',
  London: 'en',
  'New York': 'en',
  Kyoto: 'ja',
  Dubai: 'ar',
};

export { TOWN_LANGUAGE, TOWN_CURRENCY };

export const clientRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/clients',
    auth: 'required',
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const rows = await ctx.app.db.query<Row>(
        `SELECT * FROM clients WHERE desk_id = $1 AND state <> 'erasing' ORDER BY name`,
        [desk.id],
      );
      ctx.json(200, { clients: rows.map(presentClient) });
    },
  },

  {
    method: 'POST',
    pattern: '/api/clients',
    auth: 'required',
    body: 'json',
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const check = new Check(ctx.body);
      const name = check.text('name', LIMITS.clientName);
      const town = check.choice('town', TOWNS) as Town | null;
      const language = check.choice('language', LANGUAGES, false) as Language | null | undefined;
      const email = check.email('email', false) as string | null | undefined;
      check.done();

      const row = await ctx.app.db.one<Row>(
        `INSERT INTO clients (desk_id, name, town, language, email) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [desk.id, name, town, language ?? TOWN_LANGUAGE[town!], email ?? null],
      );
      await indexQuietly(ctx.app, desk.id, String(row!.id), String(row!.name));
      ctx.json(201, { client: presentClient(row!) });
    },
  },

  {
    method: 'GET',
    pattern: '/api/clients/:id',
    auth: 'required',
    resolve: resolveClient,
    async handle(ctx) {
      ctx.json(200, { client: presentClient(resolved(ctx)) });
    },
  },

  {
    method: 'PATCH',
    pattern: '/api/clients/:id',
    auth: 'required',
    body: 'json',
    resolve: resolveClient,
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const row = resolved(ctx);
      const check = new Check(ctx.body);
      const name = check.has('name') ? check.text('name', LIMITS.clientName) : undefined;
      const town = check.has('town') ? (check.choice('town', TOWNS) as Town | null) : undefined;
      const language = check.has('language')
        ? (check.choice('language', LANGUAGES) as Language | null)
        : undefined;
      const email = check.has('email') ? (check.email('email', false) as string | null) : undefined;
      check.done();

      const updated = await ctx.app.db.one<Row>(
        `UPDATE clients SET name = COALESCE($2, name), town = COALESCE($3, town),
           language = COALESCE($4, language),
           email = CASE WHEN $6 THEN $5 ELSE email END
         WHERE id = $1 RETURNING *`,
        [row.id, name ?? null, town ?? null, language ?? null, email ?? null, email !== undefined],
      );
      await indexQuietly(ctx.app, desk.id, String(updated!.id), String(updated!.name));
      ctx.json(200, { client: presentClient(updated!) });
    },
  },

  {
    method: 'DELETE',
    pattern: '/api/clients/:id',
    auth: 'required',
    resolve: resolveClient,
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const row = resolved(ctx);
      const held = await ctx.app.db.one<Row>(`SELECT id FROM pieces WHERE client_id = $1 LIMIT 1`, [
        row.id,
      ]);
      if (held) throw fail.conflict(F.closeInstead);
      await removeQuietly(ctx.app, [entryId(desk.id, 'client', String(row.id))]);
      await ctx.app.db.query(`DELETE FROM clients WHERE id = $1`, [row.id]);
      ctx.noContent();
    },
  },

  {
    method: 'POST',
    pattern: '/api/clients/:id/close',
    auth: 'required',
    body: 'json',
    resolve: resolveClient,
    async handle(ctx) {
      const row = resolved(ctx);
      const closesAt = new Date(ctx.app.now() + ctx.app.config.timers.closureWaitSeconds * 1000);
      const updated = await ctx.app.db.one<Row>(
        `UPDATE clients SET state = 'closing', closes_at = $2 WHERE id = $1 RETURNING *`,
        [row.id, closesAt],
      );
      ctx.json(200, { client: presentClient(updated!) });
    },
  },

  {
    method: 'POST',
    pattern: '/api/clients/:id/bring-back',
    auth: 'required',
    body: 'json',
    async resolve(ctx) {
      ctx.resolved.client = await findClientAnyState(ctx, ctx.param('id'));
    },
    async handle(ctx) {
      const row = resolved(ctx);
      if (row.state !== 'closing') throw fail.conflict(F.noBringBack);
      // The wait is over once `closes_at` has passed, even before the sweep runs.
      if (row.closes_at && new Date(row.closes_at as string).getTime() <= ctx.app.now()) {
        throw fail.conflict(F.noBringBack);
      }
      const updated = await ctx.app.db.one<Row>(
        `UPDATE clients SET state = 'active', closes_at = NULL WHERE id = $1 RETURNING *`,
        [row.id],
      );
      ctx.json(200, { client: presentClient(updated!) });
    },
  },
];

async function indexQuietly(
  app: Parameters<typeof putEntries>[0],
  deskId: string,
  id: string,
  name: string,
): Promise<void> {
  try {
    await putEntries(app, [clientEntry(deskId, id, name)]);
  } catch (error) {
    if (!(error instanceof SearchUnavailable)) throw error;
  }
}

async function removeQuietly(
  app: Parameters<typeof removeEntries>[0],
  ids: readonly string[],
): Promise<void> {
  try {
    await removeEntries(app, ids);
  } catch (error) {
    if (!(error instanceof SearchUnavailable)) throw error;
  }
}
