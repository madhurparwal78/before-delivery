import { now } from '../clock.ts';
import { first, pool, rows, transaction } from '../db/pool.ts';
import { publish } from '../events.ts';
import { ValidationBag } from '../http/errors.ts';
import { V } from '../http/messages.ts';
import { newId } from '../security.ts';
import { studioToday } from '../views.ts';
import type { Route, RouteResult } from '../http/context.ts';
import { Ctx } from '../http/context.ts';

interface StudioSettingsRow {
  readonly name: string;
  readonly slug: string;
  readonly time_zone: string;
  readonly pickup_window_days: number;
  readonly storage_fee_cents: number;
}

async function studioBody(studioId: string): Promise<Record<string, unknown>> {
  const row = (await first<StudioSettingsRow>(
    pool,
    'select name, slug, time_zone, pickup_window_days, storage_fee_cents from studios where id = $1',
    [studioId],
  )) as StudioSettingsRow;
  return {
    name: row.name,
    slug: row.slug,
    time_zone: row.time_zone,
    today: studioToday(row.time_zone),
    pickup_window_days: row.pickup_window_days,
    storage_fee_cents: row.storage_fee_cents,
  };
}

function wholeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

async function saveSettings(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const bag = new ValidationBag();
  const hasWindow = 'pickup_window_days' in ctx.json;
  const hasFee = 'storage_fee_cents' in ctx.json;
  const windowDays = hasWindow ? wholeNumber(ctx.json['pickup_window_days']) : null;
  const feeCents = hasFee ? wholeNumber(ctx.json['storage_fee_cents']) : null;
  if (hasWindow && (windowDays === null || windowDays < 3 || windowDays > 60)) {
    bag.add('pickup_window_days', V.pickupWindow);
  }
  if (hasFee && (feeCents === null || feeCents < 0 || feeCents > 500)) {
    bag.add('storage_fee_cents', V.storageFee);
  }
  bag.throwIfAny();

  await transaction(async (client) => {
    if (hasWindow) {
      await client.query('update studios set pickup_window_days = $2 where id = $1', [
        actor.studio.id,
        windowDays,
      ]);
    }
    if (hasFee) {
      await client.query('update studios set storage_fee_cents = $2 where id = $1', [
        actor.studio.id,
        feeCents,
      ]);
      await client.query(
        'insert into storage_fee_history (id, studio_id, from_instant, fee_cents) values ($1,$2,$3,$4)',
        [newId(), actor.studio.id, now(), feeCents],
      );
    }
    await publish(client, { kind: 'studio', id: actor.studio.id, studio_id: actor.studio.id });
  });
  return { status: 200, body: await studioBody(actor.studio.id) };
}

export const studioRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/studio',
    role: 'signed_in',
    handle: async (ctx) => ({ status: 200, body: await studioBody(ctx.actorOrFail.studio.id) }),
  },
  { method: 'PUT', pattern: '/api/studio/settings', role: 'owner', handle: saveSettings },
  {
    method: 'GET',
    pattern: '/api/clay-bodies',
    role: 'signed_in',
    handle: async (ctx) => ({
      status: 200,
      body: await rows(
        pool,
        'select id, name from clay_bodies where studio_id = $1 order by sort',
        [ctx.actorOrFail.studio.id],
      ),
    }),
  },
  {
    method: 'GET',
    pattern: '/api/kilns',
    role: 'staff',
    handle: async (ctx) => {
      const found = await rows<{
        id: string;
        name: string;
        stack_height_eighths: number;
        shelf_area_tenths: number;
      }>(
        pool,
        'select id, name, stack_height_eighths, shelf_area_tenths from kilns where studio_id = $1 order by sort',
        [ctx.actorOrFail.studio.id],
      );
      return {
        status: 200,
        body: found.map((kiln) => ({
          id: kiln.id,
          name: kiln.name,
          stack_height_in: kiln.stack_height_eighths / 8,
          shelf_area_sq_in: kiln.shelf_area_tenths / 10,
        })),
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/credit-packs',
    role: 'signed_in',
    handle: async (ctx) => ({
      status: 200,
      body: await rows(
        pool,
        'select id, name, amount_cents from credit_packs where studio_id = $1 order by sort',
        [ctx.actorOrFail.studio.id],
      ),
    }),
  },
];
