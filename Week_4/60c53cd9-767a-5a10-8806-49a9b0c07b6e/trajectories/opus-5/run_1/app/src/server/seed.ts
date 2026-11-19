/** Seeds an empty database once, idempotently and safely alongside other instances. */

import { randomUUID } from 'node:crypto';
import { advisoryLock, query, queryOne, withTransaction } from './db';
import { now, plusSeconds } from './clock';
import { config } from './config';
import { findAccountByEmail, hashPassword } from './domain/accounts';
import { queueIndexUpdate } from './search/pending';
import { buildFloorPlate, bearingsFromPlate } from './assets/glb';
import { viewPhotographKey } from './assets/views';
import { facingForBearing } from '../shared/derived';
import {
  FLOOR_BANDS,
  allUnitPositions,
  bandForFloor,
  seedPrice,
  stackSpec,
  viewTagFor,
  type BandId,
  type StackLetter,
} from '../shared/units';

const SEED_ACCOUNTS = [
  {
    name: 'Mira Castell',
    email: 'mira.castell@orrinvale.example',
    password: 'Highwater-Console-26',
    role: 'coordinator' as const,
  },
  { name: 'Ana Ferreira', email: 'ana.ferreira@example.com', password: 'Window-Seat-2026', role: 'buyer' as const },
  { name: 'Tom Okafor', email: 'tom.okafor@example.com', password: 'Harbour-Line-2026', role: 'buyer' as const },
];

const UNRELEASED_BAND: BandId = '36-38';
const WITHDRAWN_CODE = '5D';
const RESERVED_CODE = '12C';
const HELD_CODE = '31F';

/** Bearings for every band, read from that band's floor-plate model. */
async function bearingsByBand(): Promise<Map<BandId, Map<StackLetter, number>>> {
  const byBand = new Map<BandId, Map<StackLetter, number>>();
  for (const band of FLOOR_BANDS) {
    byBand.set(band.id, bearingsFromPlate(await buildFloorPlate(band.id)));
  }
  return byBand;
}

export async function seedIfEmpty(): Promise<void> {
  const bearings = await bearingsByBand();
  const accountHashes = await Promise.all(SEED_ACCOUNTS.map((account) => hashPassword(account.password)));

  await withTransaction(async (client) => {
    await advisoryLock(client, 'highwater-seed');
    const existing = await queryOne<{ count: string }>(client, 'select count(*)::text as count from units');
    if (existing && Number(existing.count) > 0) return;

    const seededAt = now();
    for (const [index, account] of SEED_ACCOUNTS.entries()) {
      await query(
        client,
        `insert into accounts (id, email, name, password_hash, role, created_at)
         values ($1, $2, $3, $4, $5, $6) on conflict (email) do nothing`,
        [randomUUID(), account.email, account.name, accountHashes[index], account.role, seededAt],
      );
    }
    const coordinator = await findAccountByEmail(client, SEED_ACCOUNTS[0].email);
    const ana = await findAccountByEmail(client, SEED_ACCOUNTS[1].email);
    const tom = await findAccountByEmail(client, SEED_ACCOUNTS[2].email);
    if (!coordinator || !ana || !tom) throw new Error('seed accounts missing');

    for (const band of FLOOR_BANDS) {
      await query(
        client,
        `insert into floor_bands (id, low_floor, high_floor, released) values ($1, $2, $3, $4)
         on conflict (id) do nothing`,
        [band.id, band.low, band.high, band.id !== UNRELEASED_BAND],
      );
    }

    for (const position of allUnitPositions()) {
      const band = bandForFloor(position.floor);
      const spec = stackSpec(position.stack);
      const bearing = bearings.get(band)?.get(position.stack);
      if (bearing === undefined) throw new Error(`no window node for stack ${position.stack}`);
      const price = seedPrice(position.stack, position.floor);
      const released = band !== UNRELEASED_BAND;
      const status =
        position.code === WITHDRAWN_CODE
          ? 'withdrawn'
          : position.code === RESERVED_CODE
            ? 'reserved'
            : position.code === HELD_CODE
              ? 'held'
              : released
                ? 'available'
                : 'unreleased';
      const seedPhotoKey =
        released && !(band === '30-35' && position.stack === 'H') ? viewPhotographKey(band, position.stack) : null;
      await query(
        client,
        `insert into units (
           code, floor, stack, band, bedrooms, area_m2, bearing, facing, view_tag,
           price, price_version, status, view_photographed, seed_photo_key
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,false,$12)`,
        [
          position.code,
          position.floor,
          position.stack,
          band,
          spec.bedrooms,
          spec.areaM2,
          bearing,
          facingForBearing(bearing),
          viewTagFor(position.stack, position.floor),
          price,
          status,
          seedPhotoKey,
        ],
      );
      await query(
        client,
        'insert into price_versions (unit_code, version, price, set_by, set_at) values ($1, 1, $2, $3, $4)',
        [position.code, price, coordinator.id, seededAt],
      );
      if (status !== 'unreleased' && status !== 'withdrawn') await queueIndexUpdate(client, position.code, 'upsert');
    }

    const heldPrice = seedPrice('F', 31);
    await query(
      client,
      `insert into holds (id, unit_code, account_id, status, quoted_price, price_version, created_at, ends_at)
       values ($1, $2, $3, 'active', $4, 1, $5, $6)`,
      [randomUUID(), HELD_CODE, tom.id, heldPrice, seededAt, plusSeconds(seededAt, config.holdSeconds)],
    );
    await query(
      client,
      `insert into holds (
         id, unit_code, account_id, status, ended_by, quoted_price, price_version, created_at, ends_at, ended_at
       ) values ($1, $2, $3, 'converted', 'conversion', $4, 1, $5, $6, $5)`,
      [
        randomUUID(),
        RESERVED_CODE,
        ana.id,
        seedPrice('C', 12),
        seededAt,
        plusSeconds(seededAt, config.holdSeconds),
      ],
    );
  });
}
