import { now } from '../clock.js';
import { query, queryOne, withClient, withTransaction } from '../db.js';
import { empty, json, route, type Ctx } from '../http.js';
import { newId } from '../util.js';
import { ValidationError, conflict, fieldMessages, notFound } from '../errors.js';
import { callerActor, mintApiToken } from '../auth.js';
import { writeAudit } from '../audit.js';
import { allPriceLists, WORK_CODES } from '../domain/prices.js';
import { practice } from '../domain/practice.js';
import { formatInstant, parseBusinessDate } from '../domain/time.js';
import { readInteger, readText } from './shared.js';

/** Price lists are immutable and effective-dated; API tokens are stored only as a hash. */
export function registerPriceRoutes(): void {
  route({
    method: 'GET',
    path: '/api/price-lists',
    roles: ['farrier'],
    tokenAccess: 'read_only',
    handler: async () => {
      const lists = await withClient((db) => allPriceLists(db));
      return json(
        200,
        lists.map((list) => ({
          id: list.id,
          effective_from: list.effectiveFrom,
          deposit_cents: list.depositCents,
          prices: list.prices,
        })),
      );
    },
  });

  route({
    method: 'POST',
    path: '/api/price-lists',
    roles: ['farrier'],
    bodyKind: 'json',
    handler: async (ctx: Ctx) => {
      const body = ctx.body<{ effective_from?: unknown; deposit_cents?: unknown; prices?: unknown }>();
      const result = await withTransaction(async (db) => {
        const at = now();
        const errors: Record<string, string> = {};
        const effectiveFrom = typeof body.effective_from === 'string' ? body.effective_from : '';
        if (parseBusinessDate(effectiveFrom) === null) errors.effective_from = fieldMessages.required;

        const depositCents = (() => {
          try {
            return readInteger(body.deposit_cents, 'deposit_cents', 0, 100000);
          } catch (error) {
            if (error instanceof ValidationError) Object.assign(errors, error.errors);
            return 0;
          }
        })();

        const rawPrices =
          typeof body.prices === 'object' && body.prices !== null
            ? (body.prices as Record<string, unknown>)
            : {};
        const prices: Record<string, number> = {};
        for (const code of WORK_CODES) {
          try {
            prices[code] = readInteger(rawPrices[code], `prices.${code}`, 1, 10000000);
          } catch (error) {
            if (error instanceof ValidationError) Object.assign(errors, error.errors);
          }
        }
        if (Object.keys(errors).length > 0) throw new ValidationError(errors);

        const clash = await queryOne<{ id: string }>(
          db,
          'SELECT id FROM price_lists WHERE effective_from = $1::date',
          [effectiveFrom],
        );
        if (clash !== null) throw conflict('price_list_exists');

        const id = newId();
        await query(
          db,
          `INSERT INTO price_lists (id, effective_from, deposit_cents, trim_cents, front_reset_cents,
                                    full_reset_cents, front_new_cents, full_new_cents, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id,
            effectiveFrom,
            depositCents,
            prices.trim,
            prices.front_reset,
            prices.full_reset,
            prices.front_new,
            prices.full_new,
          ],
        );
        await writeAudit(db, {
          actor: callerActor(ctx.caller),
          action: 'create',
          entityType: 'price_list',
          entityId: id,
          at,
          requestId: ctx.requestId,
        });
        return {
          id,
          effective_from: effectiveFrom,
          deposit_cents: depositCents,
          prices,
        };
      });
      return json(201, result);
    },
  });

  route({
    method: 'POST',
    path: '/api/tokens',
    roles: ['farrier'],
    bodyKind: 'json',
    handler: async (ctx: Ctx) => {
      const body = ctx.body<{ name?: unknown; scope?: unknown }>();
      const name = readText(body.name, 'name', 80);
      const scope = body.scope;
      if (scope !== 'read_only' && scope !== 'billing') {
        throw new ValidationError({ scope: fieldMessages.required });
      }
      const result = await withTransaction(async (db) => {
        const at = now();
        const { timeZone } = await practice(db);
        const minted = mintApiToken();
        await query(
          db,
          `INSERT INTO api_tokens (id, name, scope, token_hash, user_id, created_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [minted.id, name, scope, minted.tokenHash, ctx.caller.userId, at],
        );
        await writeAudit(db, {
          actor: callerActor(ctx.caller),
          action: 'create',
          entityType: 'api_token',
          entityId: minted.id,
          at,
          requestId: ctx.requestId,
        });
        return {
          id: minted.id,
          name,
          scope,
          token: minted.token,
          created_at: formatInstant(at, timeZone),
        };
      });
      return json(201, result);
    },
  });

  route({
    method: 'GET',
    path: '/api/tokens',
    roles: ['farrier'],
    handler: async () => {
      const rows = await withClient(async (db) => {
        const { timeZone } = await practice(db);
        const tokens = await query<{ id: string; name: string; scope: string; created_at: Date }>(
          db,
          'SELECT id, name, scope, created_at FROM api_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC',
        );
        return tokens.map((token) => ({
          id: token.id,
          name: token.name,
          scope: token.scope,
          created_at: formatInstant(token.created_at, timeZone),
        }));
      });
      return json(200, rows);
    },
  });

  route({
    method: 'DELETE',
    path: '/api/tokens/:id',
    roles: ['farrier'],
    handler: async (ctx: Ctx) => {
      await withTransaction(async (db) => {
        const at = now();
        const token = await queryOne<{ id: string }>(
          db,
          'SELECT id FROM api_tokens WHERE id = $1 AND revoked_at IS NULL',
          [ctx.params.id as string],
        );
        if (token === null) throw notFound();
        await query(db, 'UPDATE api_tokens SET revoked_at = $2 WHERE id = $1', [token.id, at]);
        await writeAudit(db, {
          actor: callerActor(ctx.caller),
          action: 'revoke',
          entityType: 'api_token',
          entityId: token.id,
          at,
          requestId: ctx.requestId,
        });
      });
      return empty(204);
    },
  });
}

