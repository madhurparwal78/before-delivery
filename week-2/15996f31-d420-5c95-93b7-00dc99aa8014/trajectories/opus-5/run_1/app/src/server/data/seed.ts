import type { PoolClient } from 'pg';
import { int, one, withTransaction } from '../db';
import { SCHEMA_SQL } from '../schema';
import { hashPassword } from './passwords';

const SEED_PASSWORD = 'bloom-desk-2027';
const SCHEMA_LOCK = 795_421_017;

interface SeedUser {
  id: string;
  role: 'broker' | 'beekeeper' | 'grower';
  personName: string;
  businessName: string;
  email: string;
}

const USERS: readonly SeedUser[] = [
  {
    id: 'usr_broker',
    role: 'broker',
    personName: 'Dana Okafor',
    businessName: 'Kettleman Pollination Services',
    email: 'dana@kettleman-pollination.example',
  },
  {
    id: 'bk_coulee',
    role: 'beekeeper',
    personName: 'Sam Delacroix',
    businessName: 'Coulee Gold Bees',
    email: 'sam@couleegold.example',
  },
  {
    id: 'bk_prairie',
    role: 'beekeeper',
    personName: 'Ruth Ammons',
    businessName: 'Prairie Lantern Honey',
    email: 'ruth@prairielantern.example',
  },
  {
    id: 'bk_ridge',
    role: 'beekeeper',
    personName: 'Teo Lindqvist',
    businessName: 'Ridgeback Apiaries',
    email: 'teo@ridgeback-apiaries.example',
  },
  {
    id: 'grw_harlan',
    role: 'grower',
    personName: 'Priya Harlan',
    businessName: 'Harlan Ridge Almonds',
    email: 'priya@harlanridge.example',
  },
  {
    id: 'grw_mendota',
    role: 'grower',
    personName: 'Luis Arreola',
    businessName: 'Mendota Flats Orchards',
    email: 'luis@mendotaflats.example',
  },
];

const RULE_SETS = [
  {
    id: 'rs_2026',
    name: '2026 season',
    effectiveFrom: '2025-11-01',
    thresholds: [60, 80, 100],
    prices: [0, 13_950, 19_950, 21_995],
    commissionBps: 1250,
    depositPerHiveCents: 5000,
  },
  {
    id: 'rs_2027',
    name: '2027 season',
    effectiveFrom: '2026-11-01',
    thresholds: [60, 80, 100],
    prices: [0, 14_875, 21_450, 23_995],
    commissionBps: 1175,
    depositPerHiveCents: 6000,
  },
] as const;

const ORCHARDS = [
  {
    id: 'orc_harlan_north',
    name: 'Harlan North Ranch',
    county: 'Madera',
    growerId: 'grw_harlan',
    blocks: [
      { id: 'blk_hn_1', name: 'Block 1', acresTenths: 200 },
      { id: 'blk_hn_2', name: 'Block 2', acresTenths: 250 },
      { id: 'blk_hn_3', name: 'Block 3', acresTenths: 150 },
      { id: 'blk_hn_4', name: 'Block 4', acresTenths: 300 },
    ],
  },
  {
    id: 'orc_harlan_south',
    name: 'Harlan South Ranch',
    county: 'Madera',
    growerId: 'grw_harlan',
    blocks: [
      { id: 'blk_hs_1', name: 'Block 1', acresTenths: 400 },
      { id: 'blk_hs_2', name: 'Block 2', acresTenths: 400 },
      { id: 'blk_hs_3', name: 'Block 3', acresTenths: 400 },
    ],
  },
  {
    id: 'orc_mendota_west',
    name: 'Mendota Flats West',
    county: 'Fresno',
    growerId: 'grw_mendota',
    blocks: [
      { id: 'blk_mw_a', name: 'Block A', acresTenths: 180 },
      { id: 'blk_mw_b', name: 'Block B', acresTenths: 220 },
    ],
  },
] as const;

const ORDERS = [
  {
    id: 'ord_hn27',
    ref: 'HN-2027',
    orchardId: 'orc_harlan_north',
    status: 'open',
    bloomStart: '2027-02-08',
    bloomEnd: '2027-03-01',
    deliveryDeadline: '2027-02-05',
    ruleSetId: 'rs_2027',
    blocks: [
      { blockId: 'blk_hn_1', hives: 40 },
      { blockId: 'blk_hn_2', hives: 50 },
      { blockId: 'blk_hn_3', hives: 30 },
      { blockId: 'blk_hn_4', hives: 60 },
    ],
  },
  {
    id: 'ord_hs27',
    ref: 'HS-2027',
    orchardId: 'orc_harlan_south',
    status: 'open',
    bloomStart: '2027-02-10',
    bloomEnd: '2027-03-03',
    deliveryDeadline: '2027-02-06',
    ruleSetId: 'rs_2027',
    blocks: [
      { blockId: 'blk_hs_1', hives: 80 },
      { blockId: 'blk_hs_2', hives: 80 },
      { blockId: 'blk_hs_3', hives: 80 },
    ],
  },
  {
    id: 'ord_mw26',
    ref: 'MW-2026',
    orchardId: 'orc_mendota_west',
    status: 'placed',
    bloomStart: '2026-02-12',
    bloomEnd: '2026-03-04',
    deliveryDeadline: '2026-02-09',
    ruleSetId: 'rs_2026',
    blocks: [
      { blockId: 'blk_mw_a', hives: 36 },
      { blockId: 'blk_mw_b', hives: 44 },
    ],
  },
] as const;

const DROPS = [
  {
    id: 'drp_r1',
    orderId: 'ord_hn27',
    beekeeperId: 'bk_ridge',
    yardName: 'Bitterroot Yard',
    hives: 40,
    status: 'committed',
    blockId: null,
    deliveredAt: null,
    deliveredOn: null,
  },
  {
    id: 'drp_p1',
    orderId: 'ord_mw26',
    beekeeperId: 'bk_prairie',
    yardName: 'Sheyenne Yard',
    hives: 36,
    status: 'delivered',
    blockId: 'blk_mw_a',
    deliveredAt: '2026-02-07T20:00:00Z',
    deliveredOn: '2026-02-07',
  },
  {
    id: 'drp_c1',
    orderId: 'ord_mw26',
    beekeeperId: 'bk_coulee',
    yardName: 'Snake River Yard',
    hives: 44,
    status: 'delivered',
    blockId: 'blk_mw_b',
    deliveredAt: '2026-02-08T20:00:00Z',
    deliveredOn: '2026-02-08',
  },
] as const;

async function insertSeed(client: PoolClient): Promise<void> {
  const passwordHash = hashPassword(SEED_PASSWORD);
  for (const user of USERS) {
    await client.query(
      `insert into users (id, role, person_name, business_name, contact_name, email, password_hash)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        user.id,
        user.role,
        user.personName,
        user.businessName,
        user.personName,
        user.email,
        passwordHash,
      ],
    );
  }
  for (const ruleSet of RULE_SETS) {
    await client.query(
      `insert into rule_sets (id, name, effective_from, threshold_reduced_tenths,
         threshold_standard_tenths, threshold_bonus_tenths, price_none_cents, price_reduced_cents,
         price_standard_cents, price_bonus_cents, commission_bps, deposit_per_hive_cents)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        ruleSet.id,
        ruleSet.name,
        ruleSet.effectiveFrom,
        ruleSet.thresholds[0],
        ruleSet.thresholds[1],
        ruleSet.thresholds[2],
        ruleSet.prices[0],
        ruleSet.prices[1],
        ruleSet.prices[2],
        ruleSet.prices[3],
        ruleSet.commissionBps,
        ruleSet.depositPerHiveCents,
      ],
    );
  }
  let orchardPosition = 0;
  for (const orchard of ORCHARDS) {
    await client.query(
      'insert into orchards (id, grower_id, name, county, position) values ($1,$2,$3,$4,$5)',
      [orchard.id, orchard.growerId, orchard.name, orchard.county, orchardPosition],
    );
    orchardPosition += 1;
    let blockPosition = 0;
    for (const block of orchard.blocks) {
      await client.query(
        'insert into blocks (id, orchard_id, name, acres_tenths, position) values ($1,$2,$3,$4,$5)',
        [block.id, orchard.id, block.name, block.acresTenths, blockPosition],
      );
      blockPosition += 1;
    }
  }
  for (const order of ORDERS) {
    await client.query(
      `insert into orders (id, ref, orchard_id, rule_set_id, status, bloom_start, bloom_end,
         delivery_deadline) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        order.id,
        order.ref,
        order.orchardId,
        order.ruleSetId,
        order.status,
        order.bloomStart,
        order.bloomEnd,
        order.deliveryDeadline,
      ],
    );
    let position = 0;
    for (const block of order.blocks) {
      await client.query(
        'insert into order_blocks (order_id, block_id, hives_ordered, position) values ($1,$2,$3,$4)',
        [order.id, block.blockId, block.hives, position],
      );
      position += 1;
    }
  }
  for (const drop of DROPS) {
    await client.query(
      `insert into drops (id, order_id, beekeeper_id, yard_name, hives, status, block_id,
         delivered_at, delivered_on) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        drop.id,
        drop.orderId,
        drop.beekeeperId,
        drop.yardName,
        drop.hives,
        drop.status,
        drop.blockId,
        drop.deliveredAt,
        drop.deliveredOn,
      ],
    );
  }
}

/** Applies the schema and, when the database holds no users, the seed. */
export async function applySchemaAndSeed(): Promise<void> {
  await withTransaction(async (client) => {
    await client.query('select pg_advisory_xact_lock($1)', [SCHEMA_LOCK]);
    await client.query(SCHEMA_SQL);
    const existing = await one(client, 'select count(*)::int as count from users');
    if (int(existing?.count ?? 0) === 0) await insertSeed(client);
  });
}
