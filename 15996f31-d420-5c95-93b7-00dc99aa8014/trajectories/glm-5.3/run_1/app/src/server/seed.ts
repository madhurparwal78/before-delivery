import { randomUUID, scryptSync, timingSafeEqual, randomBytes } from "node:crypto";
import type { Pool } from "./db.ts";
import { one, query } from "./db.ts";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const derived = scryptSync(password, salt, 32);
  const expected = Buffer.from(digest, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

const SEED_USERS = [
  { id: "usr_broker", role: "broker", name: "Dana Okafor", business: "Kettleman Pollination Services", email: "dana@kettleman-pollination.example" },
  { id: "bk_coulee", role: "beekeeper", name: "Sam Delacroix", business: "Coulee Gold Bees", email: "sam@couleegold.example" },
  { id: "bk_prairie", role: "beekeeper", name: "Ruth Ammons", business: "Prairie Lantern Honey", email: "ruth@prairielantern.example" },
  { id: "bk_ridge", role: "beekeeper", name: "Teo Lindqvist", business: "Ridgeback Apiaries", email: "teo@ridgeback-apiaries.example" },
  { id: "grw_harlan", role: "grower", name: "Priya Harlan", business: "Harlan Ridge Almonds", email: "priya@harlanridge.example" },
  { id: "grw_mendota", role: "grower", name: "Luis Arreola", business: "Mendota Flats Orchards", email: "luis@mendotaflats.example" },
];

const SEED_RULE_SETS = [
  {
    id: "rs_2026", name: "2026 season", effective_from: "2025-11-01",
    threshold_reduced: 60, threshold_standard: 80, threshold_bonus: 100,
    price_none_cents: 0, price_reduced_cents: 13950, price_standard_cents: 19950, price_bonus_cents: 21995,
    commission_bps: 1250, deposit_per_hive_cents: 5000,
  },
  {
    id: "rs_2027", name: "2027 season", effective_from: "2026-11-01",
    threshold_reduced: 60, threshold_standard: 80, threshold_bonus: 100,
    price_none_cents: 0, price_reduced_cents: 14875, price_standard_cents: 21450, price_bonus_cents: 23995,
    commission_bps: 1175, deposit_per_hive_cents: 6000,
  },
];

const SEED_GROWERS = [
  { id: "grw_harlan", name: "Harlan Ridge Almonds", contact_name: "Priya Harlan", email: "priya@harlanridge.example" },
  { id: "grw_mendota", name: "Mendota Flats Orchards", contact_name: "Luis Arreola", email: "luis@mendotaflats.example" },
];

const SEED_ORCHARDS = [
  {
    id: "orc_harlan_north", grower_id: "grw_harlan", name: "Harlan North Ranch", county: "Madera",
    blocks: [
      { id: "blk_hn_1", name: "Block 1", acres: "20" },
      { id: "blk_hn_2", name: "Block 2", acres: "25" },
      { id: "blk_hn_3", name: "Block 3", acres: "15" },
      { id: "blk_hn_4", name: "Block 4", acres: "30" },
    ],
  },
  {
    id: "orc_harlan_south", grower_id: "grw_harlan", name: "Harlan South Ranch", county: "Madera",
    blocks: [
      { id: "blk_hs_1", name: "Block 1", acres: "40" },
      { id: "blk_hs_2", name: "Block 2", acres: "40" },
      { id: "blk_hs_3", name: "Block 3", acres: "40" },
    ],
  },
  {
    id: "orc_mendota_west", grower_id: "grw_mendota", name: "Mendota Flats West", county: "Fresno",
    blocks: [
      { id: "blk_mw_a", name: "Block A", acres: "18" },
      { id: "blk_mw_b", name: "Block B", acres: "22" },
    ],
  },
];

const SEED_ORDERS = [
  {
    id: "ord_hn27", ref: "HN-2027", orchard_id: "orc_harlan_north", grower_id: "grw_harlan", status: "open",
    bloom_start: "2027-02-08", bloom_end: "2027-03-01", delivery_deadline: "2027-02-05", rule_set_id: "rs_2027",
    deposit_cents: 180 * 6000,
    blocks: [
      { block_id: "blk_hn_1", hives: 40 },
      { block_id: "blk_hn_2", hives: 50 },
      { block_id: "blk_hn_3", hives: 30 },
      { block_id: "blk_hn_4", hives: 60 },
    ],
  },
  {
    id: "ord_hs27", ref: "HS-2027", orchard_id: "orc_harlan_south", grower_id: "grw_harlan", status: "open",
    bloom_start: "2027-02-10", bloom_end: "2027-03-03", delivery_deadline: "2027-02-06", rule_set_id: "rs_2027",
    deposit_cents: 240 * 6000,
    blocks: [
      { block_id: "blk_hs_1", hives: 80 },
      { block_id: "blk_hs_2", hives: 80 },
      { block_id: "blk_hs_3", hives: 80 },
    ],
  },
  {
    id: "ord_mw26", ref: "MW-2026", orchard_id: "orc_mendota_west", grower_id: "grw_mendota", status: "placed",
    bloom_start: "2026-02-12", bloom_end: "2026-03-04", delivery_deadline: "2026-02-09", rule_set_id: "rs_2026",
    deposit_cents: 80 * 5000,
    blocks: [
      { block_id: "blk_mw_a", hives: 36 },
      { block_id: "blk_mw_b", hives: 44 },
    ],
  },
];

const SEED_DROPS = [
  {
    id: "drp_r1", order_id: "ord_hn27", beekeeper_id: "bk_ridge", yard_name: "Bitterroot Yard", hives: 40,
    status: "committed",
  },
  {
    id: "drp_p1", order_id: "ord_mw26", beekeeper_id: "bk_prairie", yard_name: "Sheyenne Yard", hives: 36,
    status: "delivered", block_id: "blk_mw_a", delivered_at: "2026-02-07T10:00:00-08:00", delivered_on: "2026-02-07",
  },
  {
    id: "drp_c1", order_id: "ord_mw26", beekeeper_id: "bk_coulee", yard_name: "Snake River Yard", hives: 44,
    status: "delivered", block_id: "blk_mw_b", delivered_at: "2026-02-08T14:00:00-08:00", delivered_on: "2026-02-08",
  },
];

/**
 * Applies the seed when the database is empty. Guarded by an advisory lock so
 * two instances starting together seed exactly once. Creating the seed sends
 * no email.
 */
export async function seedIfEmpty(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(91472931)");
    const marker = await client.query<{ applied_at: Date }>("SELECT applied_at FROM seed_marker WHERE id = 1");
    if (marker.rowCount && marker.rows[0]) {
      await client.query("COMMIT");
      return;
    }
    for (const user of SEED_USERS) {
      await client.query(
        "INSERT INTO users (id, role, name, business, email, password_hash) VALUES ($1,$2,$3,$4,$5,$6)",
        [user.id, user.role, user.name, user.business, user.email, hashPassword("bloom-desk-2027")],
      );
    }
    for (const grower of SEED_GROWERS) {
      await client.query("INSERT INTO growers (id, name, contact_name, email) VALUES ($1,$2,$3,$4)", [
        grower.id, grower.name, grower.contact_name, grower.email,
      ]);
    }
    for (const orchard of SEED_ORCHARDS) {
      await client.query("INSERT INTO orchards (id, grower_id, name, county) VALUES ($1,$2,$3,$4)", [
        orchard.id, orchard.grower_id, orchard.name, orchard.county,
      ]);
      let position = 1;
      for (const block of orchard.blocks) {
        await client.query("INSERT INTO blocks (id, orchard_id, name, acres, position) VALUES ($1,$2,$3,$4,$5)", [
          block.id, orchard.id, block.name, block.acres, position,
        ]);
        position += 1;
      }
    }
    for (const ruleSet of SEED_RULE_SETS) {
      await client.query(
        `INSERT INTO rule_sets (id, name, effective_from, threshold_reduced, threshold_standard, threshold_bonus,
          price_none_cents, price_reduced_cents, price_standard_cents, price_bonus_cents, commission_bps, deposit_per_hive_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [ruleSet.id, ruleSet.name, ruleSet.effective_from, ruleSet.threshold_reduced, ruleSet.threshold_standard,
          ruleSet.threshold_bonus, ruleSet.price_none_cents, ruleSet.price_reduced_cents, ruleSet.price_standard_cents,
          ruleSet.price_bonus_cents, ruleSet.commission_bps, ruleSet.deposit_per_hive_cents],
      );
    }
    for (const order of SEED_ORDERS) {
      await client.query(
        `INSERT INTO orders (id, ref, orchard_id, grower_id, status, bloom_start, bloom_end, delivery_deadline,
          rule_set_id, deposit_cents) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [order.id, order.ref, order.orchard_id, order.grower_id, order.status, order.bloom_start, order.bloom_end,
          order.delivery_deadline, order.rule_set_id, order.deposit_cents],
      );
      for (const block of order.blocks) {
        await client.query("INSERT INTO order_blocks (order_id, block_id, hives) VALUES ($1,$2,$3)", [
          order.id, block.block_id, block.hives,
        ]);
      }
    }
    for (const drop of SEED_DROPS) {
      await client.query(
        `INSERT INTO drops (id, order_id, beekeeper_id, yard_name, hives, status, block_id, delivered_at, delivered_on)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [drop.id, drop.order_id, drop.beekeeper_id, drop.yard_name, drop.hives, drop.status,
          drop.block_id ?? null, drop.delivered_at ?? null, drop.delivered_on ?? null],
      );
    }
    await client.query("INSERT INTO seed_marker (id) VALUES (1)");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** The order ref counter for orders created after the seed (BD-1001 onward). */
export async function ensureRefSequence(pool: Pool): Promise<void> {
  await query(pool, "CREATE SEQUENCE IF NOT EXISTS order_ref_seq START 1001");
}

export async function nextOrderRef(pool: Pool): Promise<string> {
  const result = await one<{ nextval: string }>(pool, "SELECT nextval('order_ref_seq') AS nextval");
  return `BD-${result?.nextval ?? "1001"}`;
}
