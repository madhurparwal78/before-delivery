import { ApiError } from '../domain/errors.ts';
import { optionalPeriod } from '../domain/period.ts';
import type { Role } from '../domain/routes.ts';
import { formatInstant } from '../domain/time.ts';
import { formatMl } from '../domain/decimal.ts';
import {
  createSession,
  endSession,
  requireRole,
  SESSION_COOKIE,
  type SignedInUser,
  verifyPassword,
} from './auth.ts';
import { isSchemaReady, pool } from './db.ts';
import { type Ctx, route, type Route } from './http.ts';
import {
  allocationBody,
  allocationOf,
  cardRows,
  channelFlows,
  orderRow,
  orderRows,
  serverNow,
  windowRow,
  windowRows,
} from './reads.ts';
import { cardRecord, orderRecord, packRecord, windowRecord, type PackRow } from './records.ts';
import { capacityBody, createWindow, restoreRevision, saveCapacityTable } from './service/capacity.ts';
import { removeHolder, strokeCard } from './service/cards.ts';
import { contractorList, eraseContractor } from './service/contractors.ts';
import { cancelOrder, closeOrder, placeOrder, quoteOrder, reopenOrder, scheduleOrder } from './service/orders.ts';
import {
  packDocumentBytes,
  packList,
  packRow,
  previewPack,
  submitPack,
  withdrawPack,
} from './service/packs.ts';
import { rationWindow } from './service/ration.ts';
import { publishRestriction, restrictionBody } from './service/restrictions.ts';
import { searchSuggestions } from './service/search.ts';
import { totalsBody } from './service/totals.ts';
import { kickWorker } from './worker.ts';

/** Every endpoint of the one API. */

const ALL_ROLES: readonly Role[] = ['grower', 'operator', 'dispatcher', 'clerk', 'reviewer'];

function signedIn(ctx: Ctx): SignedInUser {
  if (ctx.user === null) throw new ApiError('not_signed_in');
  return ctx.user;
}

function text(input: string | null): string | null {
  return input === null || input === '' ? null : input;
}

const handlers: Route[] = [
  route('GET', '/api/health', async () => {
    if (!isSchemaReady()) throw new ApiError('database_unavailable');
    return { json: { status: 'ok' } };
  }),

  route('POST', '/api/session', async (ctx) => {
    const email = typeof ctx.body.email === 'string' ? ctx.body.email.trim().toLowerCase() : '';
    const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    const found = await pool.query<{
      id: number;
      name: string | null;
      email: string;
      role: Role;
      operator_code: string | null;
      password_hash: string | null;
    }>('select id, name, email, role, operator_code, password_hash from users where lower(email) = $1 and erased = false', [
      email,
    ]);
    const user = found.rows[0];
    if (user === undefined || !verifyPassword(password, user.password_hash)) {
      throw new ApiError('bad_credentials');
    }
    const token = await createSession(pool, user.id);
    ctx.setCookie(`${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`);
    return {
      json: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          operator_code: user.operator_code,
        },
      },
    };
  }),

  route('DELETE', '/api/session', async (ctx) => {
    signedIn(ctx);
    const token = ctx.cookies[SESSION_COOKIE];
    if (token !== undefined) await endSession(token);
    ctx.setCookie(`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return { status: 204 };
  }),

  route('GET', '/api/me', async (ctx) => {
    const user = signedIn(ctx);
    return {
      json: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          operator_code: user.operatorCode,
        },
      },
    };
  }),

  route('GET', '/api/me/allocation', async (ctx) => {
    const user = requireRole(ctx.user, ['grower']);
    return { json: allocationBody(await allocationOf(user.id)) };
  }),

  route('GET', '/api/channels', async (ctx) => {
    requireRole(ctx.user, ALL_ROLES);
    const found = await pool.query<{ id: string; name: string; capacity_revision: number }>(
      'select id, name, capacity_revision from channels order by rail_order',
    );
    return { json: { channels: found.rows } };
  }),

  route('GET', '/api/windows', async (ctx) => {
    requireRole(ctx.user, ALL_ROLES);
    const channel = text(ctx.query.get('channel'));
    const now = serverNow();
    const flows = await channelFlows();
    const rows = await windowRows(channel === null ? {} : { channelId: channel });
    return {
      json: {
        server_time: formatInstant(now),
        windows: rows.map((row) => windowRecord(row, now, flows)),
      },
    };
  }),

  route('GET', '/api/windows/:id', async (ctx) => {
    requireRole(ctx.user, ALL_ROLES);
    const row = await windowRow(ctx.params.id as string);
    if (row === null) throw new ApiError('not_found');
    const now = serverNow();
    return { json: { server_time: formatInstant(now), window: windowRecord(row, now, await channelFlows()) } };
  }),

  route('POST', '/api/channels/:id/windows', async (ctx) => {
    const user = requireRole(ctx.user, ['dispatcher']);
    return {
      status: 201,
      json: await createWindow(ctx.params.id as string, user.name as string, {
        opensAt: ctx.body.opens_at,
        closesAt: ctx.body.closes_at,
        capMlDay: ctx.body.cap_ml_day,
        rosteredOperator: ctx.body.rostered_operator,
      }),
    };
  }),

  route('GET', '/api/windows/:id/notices', async (ctx) => {
    requireRole(ctx.user, ['dispatcher', 'clerk']);
    const window = await windowRow(ctx.params.id as string);
    if (window === null) throw new ApiError('not_found');
    const found = await pool.query<{
      kind: string;
      grower_id: number;
      grower_name: string;
      subject: string;
      state: string;
      created_at: Date;
    }>(
      `select n.kind, n.grower_id, u.name as grower_name, n.subject, n.state, n.created_at
         from notices n join users u on u.id = n.grower_id
        where n.window_id = $1 order by n.id`,
      [window.id],
    );
    return {
      json: {
        notices: found.rows.map((row) => ({
          kind: row.kind,
          grower_id: row.grower_id,
          grower_name: row.grower_name,
          subject: row.subject,
          state: row.state,
          created_at: formatInstant(row.created_at),
        })),
      },
    };
  }),

  route('GET', '/api/turnouts', async (ctx) => {
    const user = requireRole(ctx.user, ['grower', 'dispatcher', 'clerk']);
    const own = user.role === 'grower';
    const found = await pool.query<{
      code: string;
      channel_id: string;
      grower_id: number;
      max_rate_ml_day: string;
    }>(
      `select t.code, t.channel_id, t.grower_id, t.max_rate_ml_day
         from turnouts t join channels c on c.id = t.channel_id
        ${own ? 'where t.grower_id = $1' : ''}
        order by c.rail_order, t.code`,
      own ? [user.id] : [],
    );
    return {
      json: {
        turnouts: found.rows.map((row) => ({
          code: row.code,
          channel_id: row.channel_id,
          grower_id: row.grower_id,
          max_rate_ml_day: formatMl(BigInt(row.max_rate_ml_day)),
        })),
      },
    };
  }),

  route('GET', '/api/operators', async (ctx) => {
    requireRole(ctx.user, ['grower', 'operator', 'dispatcher', 'clerk']);
    const found = await pool.query<{ code: string; kind: 'district' | 'contractor'; name: string | null }>(
      `select operator_code as code, operator_kind as kind, name from users
        where role = 'operator' and erased = false order by operator_code`,
    );
    return { json: { operators: found.rows } };
  }),

  route('GET', '/api/orders/quote', async (ctx) => {
    const user = requireRole(ctx.user, ['grower']);
    return {
      json: await quoteOrder(user, {
        windowId: text(ctx.query.get('window')),
        volumeMl: text(ctx.query.get('volume_ml')),
        turnout: text(ctx.query.get('turnout')),
      }),
    };
  }),

  route('POST', '/api/orders', async (ctx) => {
    const user = requireRole(ctx.user, ['grower']);
    const body = await placeOrder(user, {
      turnout: ctx.body.turnout,
      windowId: ctx.body.window_id,
      volumeMl: ctx.body.volume_ml,
      operatorCode: ctx.body.operator_code,
      standbyCode: ctx.body.standby_code ?? null,
    });
    return { status: 201, json: body };
  }),

  route('GET', '/api/orders', async (ctx) => {
    const user = requireRole(ctx.user, ['grower', 'dispatcher', 'clerk']);
    const windowId = text(ctx.query.get('window'));
    const rows = await orderRows({
      ...(windowId === null ? {} : { windowId }),
      ...(user.role === 'grower' ? { growerId: user.id } : {}),
    });
    return { json: { orders: rows.map(orderRecord) } };
  }),

  route('GET', '/api/orders/:number', async (ctx) => {
    const user = requireRole(ctx.user, ['grower', 'dispatcher', 'clerk']);
    const row = await orderRow(ctx.params.number as string);
    if (row === null || (user.role === 'grower' && row.grower_id !== user.id)) throw new ApiError('not_found');
    return { json: { order: orderRecord(row) } };
  }),

  route('POST', '/api/orders/:number/cancel', async (ctx) => {
    const user = requireRole(ctx.user, ['grower']);
    return { json: await cancelOrder(user, ctx.params.number as string) };
  }),

  route('POST', '/api/orders/:number/schedule', async (ctx) => {
    requireRole(ctx.user, ['dispatcher']);
    return { json: await scheduleOrder(ctx.params.number as string) };
  }),

  route('POST', '/api/orders/:number/close', async (ctx) => {
    requireRole(ctx.user, ['dispatcher']);
    return { json: await closeOrder(ctx.params.number as string) };
  }),

  route('POST', '/api/orders/:number/reopen', async (ctx) => {
    requireRole(ctx.user, ['dispatcher']);
    return { json: await reopenOrder(ctx.params.number as string) };
  }),

  route('POST', '/api/windows/:id/ration', async (ctx) => {
    requireRole(ctx.user, ['dispatcher']);
    const body = await rationWindow(ctx.params.id as string);
    kickWorker();
    return { json: body };
  }),

  route('GET', '/api/gate-cards', async (ctx) => {
    const user = requireRole(ctx.user, ['operator', 'dispatcher']);
    const windowId = text(ctx.query.get('window'));
    const now = serverNow();
    const rows = await cardRows({
      ...(windowId === null ? {} : { windowId }),
      ...(user.role === 'operator' ? { holderCode: user.operatorCode as string } : {}),
    });
    const visible =
      user.role === 'dispatcher'
        ? rows
        : rows.filter(
            (row) =>
              row.state !== 'spent' ||
              (row.confirmed_at !== null && now.getTime() - row.confirmed_at.getTime() <= 86_400_000),
          );
    return { json: { cards: visible.map((row) => cardRecord(row, now)) } };
  }),

  route('POST', '/api/gate-cards/:id/stroke', async (ctx) => {
    const user = requireRole(ctx.user, ['operator']);
    const outcome = await strokeCard(user, ctx.params.id as string);
    return { status: outcome.status, json: outcome.body };
  }),

  route('POST', '/api/gate-cards/:id/remove-holder', async (ctx) => {
    requireRole(ctx.user, ['dispatcher']);
    return { json: await removeHolder(ctx.params.id as string) };
  }),

  route('POST', '/api/windows/:id/restrictions', async (ctx) => {
    requireRole(ctx.user, ['dispatcher']);
    const body = await publishRestriction(ctx.params.id as string, {
      capMlDay: ctx.body.cap_ml_day,
      reason: ctx.body.reason,
    });
    kickWorker();
    return { status: 201, json: body };
  }),

  route('GET', '/api/restrictions/:id', async (ctx) => {
    requireRole(ctx.user, ['dispatcher', 'clerk', 'reviewer']);
    return { json: await restrictionBody(ctx.params.id as string) };
  }),

  route('GET', '/api/channels/:id/capacity', async (ctx) => {
    requireRole(ctx.user, ['dispatcher', 'clerk', 'reviewer']);
    return { json: await capacityBody(ctx.params.id as string) };
  }),

  route('PUT', '/api/channels/:id/capacity', async (ctx) => {
    const user = requireRole(ctx.user, ['dispatcher']);
    const outcome = await saveCapacityTable(ctx.params.id as string, user.name as string, {
      baseRevision: ctx.body.base_revision,
      cells: ctx.body.cells,
    });
    return { status: outcome.status, json: outcome.body };
  }),

  route('POST', '/api/channels/:id/capacity/revisions/:revision/restore', async (ctx) => {
    const user = requireRole(ctx.user, ['dispatcher']);
    const revision = Number(ctx.params.revision);
    if (!Number.isInteger(revision)) throw new ApiError('not_found');
    return {
      status: 201,
      json: await restoreRevision(ctx.params.id as string, revision, user.name as string),
    };
  }),

  route('GET', '/api/search', async (ctx) => {
    const user = requireRole(ctx.user, ALL_ROLES);
    return { json: { suggestions: await searchSuggestions(user, text(ctx.query.get('q'))) } };
  }),

  route('GET', '/api/totals', async (ctx) => {
    requireRole(ctx.user, ['dispatcher', 'clerk', 'reviewer']);
    const period = optionalPeriod(text(ctx.query.get('from')), text(ctx.query.get('to')));
    return { json: await totalsBody(period) };
  }),

  route('GET', '/api/packs/preview', async (ctx) => {
    requireRole(ctx.user, ['clerk']);
    const document = await previewPack(
      text(ctx.query.get('from')),
      text(ctx.query.get('to')),
      ctx.query.get('signatory'),
    );
    return { text: document, headers: { 'content-type': 'text/plain; charset=utf-8' } };
  }),

  route('POST', '/api/packs', async (ctx) => {
    const user = requireRole(ctx.user, ['clerk']);
    const body = await submitPack(user, ctx.body);
    kickWorker();
    return { status: 202, json: body };
  }),

  route('GET', '/api/packs', async (ctx) => {
    const user = requireRole(ctx.user, ['clerk', 'reviewer']);
    return { json: { packs: await packList(user.role === 'reviewer') } };
  }),

  route('GET', '/api/packs/:id', async (ctx) => {
    const user = requireRole(ctx.user, ['clerk', 'reviewer']);
    const pack = await visiblePack(ctx.params.id as string, user.role);
    return { json: { pack: packRecord(pack) } };
  }),

  route('GET', '/api/packs/:id/document', async (ctx) => {
    const user = requireRole(ctx.user, ['clerk', 'reviewer']);
    const pack = await visiblePack(ctx.params.id as string, user.role);
    if (pack.state !== 'stored' && pack.state !== 'mailed') throw new ApiError('not_stored');
    const bytes = await packDocumentBytes(pack.number);
    return {
      bytes,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': `attachment; filename="${pack.number}.txt"`,
      },
    };
  }),

  route('DELETE', '/api/packs/:id', async (ctx) => {
    requireRole(ctx.user, ['clerk']);
    const body = await withdrawPack(ctx.params.id as string);
    kickWorker();
    return { json: body };
  }),

  route('GET', '/api/contractors', async (ctx) => {
    requireRole(ctx.user, ['dispatcher', 'clerk']);
    return { json: { contractors: await contractorList() } };
  }),

  route('DELETE', '/api/contractors/:code', async (ctx) => {
    requireRole(ctx.user, ['clerk']);
    return { json: await eraseContractor(ctx.params.code as string) };
  }),
];

async function visiblePack(number: string, role: Role): Promise<PackRow> {
  const pack = await packRow(number);
  if (pack === null) throw new ApiError('not_found');
  if (role === 'reviewer' && pack.state !== 'mailed') throw new ApiError('not_found');
  return pack;
}

export const apiRoutes: readonly Route[] = handlers;
