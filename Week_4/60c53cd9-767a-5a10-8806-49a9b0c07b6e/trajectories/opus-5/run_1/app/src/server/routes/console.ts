/** The sales coordinator's console endpoints. Buyers and visitors are refused. */

import { pool, query } from '../db';
import { ApiError } from '../errors';
import { FIELD_MESSAGES } from '../../shared/errors';
import { applyLapseCheck } from '../domain/lapse';
import { convertHold, withdrawUnit } from '../domain/holds';
import { priceVersions, savePrice } from '../domain/prices';
import { isBandId, releaseBand } from '../domain/bands';
import { storeViewPhoto } from '../domain/photos';
import { requireAccount, requireRole } from '../http/auth';
import { readIntegerField, sendJson, type JsonBody, type Wire } from '../http/wire';
import { detectKind } from '../assets/image';
import type { AccountRecord } from '../domain/accounts';
import type { BandId, StackLetter } from '../../shared/units';
import type { CellStatus, ConsoleHoldRow, ConsoleUnitRow } from '../../shared/types';

async function coordinator(wire: Wire): Promise<AccountRecord> {
  return requireRole(await requireAccount(wire), 'coordinator');
}

interface ConsoleUnitQueryRow {
  code: string;
  floor: number;
  stack: StackLetter;
  band: BandId;
  status: CellStatus;
  price: string;
  price_version: number;
  view_photographed: boolean;
  view_photo_key: string | null;
  view_photo_size: string | null;
  view_photo_checksum: string | null;
  hold_id: string | null;
  buyer_email: string | null;
  quoted_price: string | null;
  hold_created_at: Date | null;
  hold_ends_at: Date | null;
}

export async function listUnits(wire: Wire): Promise<void> {
  await coordinator(wire);
  await applyLapseCheck(pool);
  const rows = await query<ConsoleUnitQueryRow>(
    pool,
    `select u.code, u.floor, u.stack, u.band, u.status, u.price::text as price, u.price_version,
            u.view_photographed, u.view_photo_key, u.view_photo_size::text as view_photo_size,
            u.view_photo_checksum,
            h.id as hold_id, a.email as buyer_email, h.quoted_price::text as quoted_price,
            h.created_at as hold_created_at, h.ends_at as hold_ends_at
       from units u
       left join holds h on h.unit_code = u.code and h.status = 'active'
       left join accounts a on a.id = h.account_id
      order by u.floor, u.stack`,
  );
  const units: ConsoleUnitRow[] = rows.map((row) => ({
    code: row.code,
    floor: row.floor,
    stack: row.stack,
    band: row.band,
    status: row.status,
    price: Number(row.price),
    priceVersion: row.price_version,
    viewPhotographed: row.view_photographed,
    viewPhoto:
      row.view_photographed && row.view_photo_key && row.view_photo_checksum
        ? {
            key: row.view_photo_key,
            size: Number(row.view_photo_size),
            checksum: row.view_photo_checksum,
          }
        : null,
    hold:
      row.hold_id && row.buyer_email && row.hold_created_at && row.hold_ends_at
        ? {
            id: row.hold_id,
            buyerEmail: row.buyer_email,
            quotedPrice: Number(row.quoted_price),
            createdAt: row.hold_created_at.toISOString(),
            endsAt: row.hold_ends_at.toISOString(),
          }
        : null,
  }));
  sendJson(wire, 200, { units });
}

export async function listPriceVersions(wire: Wire, code: string): Promise<void> {
  await coordinator(wire);
  const versions = await priceVersions(pool, code);
  if (versions.length === 0) throw new ApiError('not_found');
  sendJson(wire, 200, { versions });
}

export async function listActiveHolds(wire: Wire): Promise<void> {
  await coordinator(wire);
  await applyLapseCheck(pool);
  const rows = await query<{
    id: string;
    unit_code: string;
    email: string;
    name: string;
    quoted_price: string;
    price_version: number;
    created_at: Date;
    ends_at: Date;
  }>(
    pool,
    `select h.id, h.unit_code, a.email, a.name, h.quoted_price::text as quoted_price, h.price_version,
            h.created_at, h.ends_at
       from holds h join accounts a on a.id = h.account_id
      where h.status = 'active' order by h.created_at desc`,
  );
  const holds: ConsoleHoldRow[] = rows.map((row) => ({
    id: row.id,
    unitCode: row.unit_code,
    buyerEmail: row.email,
    buyerName: row.name,
    quotedPrice: Number(row.quoted_price),
    priceVersion: row.price_version,
    createdAt: row.created_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
  }));
  sendJson(wire, 200, { holds });
}

export async function releaseFloorBand(wire: Wire, band: string): Promise<void> {
  await coordinator(wire);
  if (!isBandId(band)) throw new ApiError('not_found');
  sendJson(wire, 200, await releaseBand(band));
}

export async function setPrice(wire: Wire, code: string, body: JsonBody): Promise<void> {
  const account = await coordinator(wire);
  const versions = await priceVersions(pool, code);
  if (versions.length === 0) throw new ApiError('not_found');
  const price = readIntegerField(body, {
    field: 'price',
    message: FIELD_MESSAGES.price,
    min: 100000,
    max: 20000000,
  });
  const expectedVersion = readIntegerField(body, {
    field: 'expectedVersion',
    message: FIELD_MESSAGES.expectedVersion,
    min: 1,
  });
  sendJson(wire, 200, await savePrice({ code, price, expectedVersion, coordinatorId: account.id }));
}

export async function uploadViewPhoto(wire: Wire, code: string, body: Buffer): Promise<void> {
  await coordinator(wire);
  const kind = detectKind(body);
  if (!kind) throw new ApiError('unsupported_image');
  const stored = await storeViewPhoto(code, body, kind);
  sendJson(wire, 200, { code, viewPhotographed: true, viewPhoto: stored });
}

export async function withdraw(wire: Wire, code: string): Promise<void> {
  await coordinator(wire);
  await withdrawUnit(code);
  sendJson(wire, 200, { code, status: 'withdrawn' });
}

export async function convert(wire: Wire, holdId: string): Promise<void> {
  await coordinator(wire);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(holdId)) {
    throw new ApiError('not_found');
  }
  sendJson(wire, 200, { hold: await convertHold(holdId) });
}
