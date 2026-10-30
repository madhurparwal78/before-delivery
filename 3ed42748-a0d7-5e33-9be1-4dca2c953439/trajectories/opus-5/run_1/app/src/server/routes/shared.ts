import { queryOne } from '../db/pool.js';
import { parseJsonBody } from '../http/boundary.js';
import { fail } from '../http/errors.js';
import { readPublishedBody, type FieldSpec, type JsonObject } from '../domain/requestFields.js';
import { balanceOf } from '../domain/ledger.js';
import { carriedParcelOf } from '../domain/parcels.js';
import { satchelsOwned, type CourierRow } from '../domain/couriers.js';
import type { Handled } from '../http/app.js';
import type { Actor } from '../domain/sessions.js';

export function actorOf(context: Handled): Actor {
  if (context.actor === null) throw fail('unauthenticated');
  return context.actor;
}

export function published(context: Handled, spec: FieldSpec): JsonObject {
  return readPublishedBody(parseJsonBody(context.body), spec);
}

export function rawJson(context: Handled): JsonObject {
  const parsed = parseJsonBody(context.body);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw fail('validation', { fields: { body: 'invalid' } });
  }
  return parsed as JsonObject;
}

export async function satchelColour(satchelId: string): Promise<string> {
  const row = await queryOne<{ colour: string }>(
    'select colour from satchels where satchel_id = $1',
    [satchelId],
  );
  if (row === null) throw fail('internal');
  return row.colour;
}

/** The caller's own save: their stamps, satchels and open parcel. */
export async function meBody(courier: CourierRow, now: Date): Promise<unknown> {
  return {
    role: courier.role,
    display_name: courier.display_name,
    satchel_colour: await satchelColour(courier.worn_satchel_id),
    balance: await balanceOf(courier.courier_id),
    email: courier.email,
    name_locked: courier.name_locked,
    muted: courier.muted,
    satchels_owned: await satchelsOwned(courier.courier_id),
    open_parcel: await carriedParcelOf(courier.courier_id, now),
  };
}

export function readHeader(context: Handled, name: string): string | undefined {
  const raw = context.request.headers[name.toLowerCase()];
  return Array.isArray(raw) ? raw[0] : raw;
}
