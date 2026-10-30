// Loads orders with everything their figures depend on, and assesses strength, payable and pay in one place.
// Derived figures are computed at read time from stored samples and drops, never stored.

import type { DropStatus, LinkStatus, OrderStatus, Ref, SettlementShare, Tier, TierPrices, User } from "../shared/api.js";
import { averageTenths, tierFor, type Thresholds } from "../shared/strength.js";
import { allocate, splitShare, type Allocation } from "./domain/allocation.js";
import { isDelivered, linkStatus } from "./domain/transitions.js";
import { rows, type Db } from "./db.js";

export interface RuleSet {
  id: string;
  name: string;
  effective_from: string;
  thresholds: Thresholds;
  prices: TierPrices;
  commission_bps: number;
  deposit_per_hive_cents: number;
}

export interface BlockRecord {
  id: string;
  name: string;
  acres_tenths: number;
  hives_ordered: number;
}

export interface DropRecord {
  id: string;
  order_id: string;
  beekeeper: Ref;
  yard_name: string;
  hives: number;
  status: DropStatus;
  block_id: string | null;
  delivered_on: string | null;
  dispute_reason: string | null;
  resolution_note: string | null;
}

export interface SampleRecord {
  id: string;
  block_id: string;
  drop_id: string;
  colony_label: string;
  frames_tenths: number;
}

export interface PhotoRecord {
  id: string;
  sample_id: string;
}

export interface LinkRecord {
  id: string;
  status: LinkStatus;
  inspector_email: string;
  expires_at: Date;
}

export interface SettlementRecord {
  status: "queued" | "settled";
  payment_received_on: string;
  payable_cents: number;
  commission_bps: number;
  commission_cents: number;
  shares: SettlementShare[];
}

export interface OrderRecord {
  id: string;
  ref: string;
  status: OrderStatus;
  orchard: { id: string; name: string; county: string; grower_id: string };
  grower: Ref;
  rule: RuleSet;
  bloom_start: string;
  bloom_end: string;
  delivery_deadline: string;
  deposit_invoice_id: string | null;
  balance_invoice_id: string | null;
  report_key: string | null;
  blocks: BlockRecord[];
  drops: DropRecord[];
  samples: SampleRecord[];
  photos: PhotoRecord[];
  link: LinkRecord | null;
  settlement: SettlementRecord | null;
}

interface RuleRow {
  id: string;
  name: string;
  effective_from: string;
  reduced_tenths: number;
  standard_tenths: number;
  bonus_tenths: number;
  price_none_cents: number;
  price_reduced_cents: number;
  price_standard_cents: number;
  price_bonus_cents: number;
  commission_bps: number;
  deposit_per_hive_cents: number;
}

export function toRuleSet(row: RuleRow): RuleSet {
  return {
    id: row.id,
    name: row.name,
    effective_from: row.effective_from,
    thresholds: { reduced: row.reduced_tenths, standard: row.standard_tenths, bonus: row.bonus_tenths },
    prices: { none: row.price_none_cents, reduced: row.price_reduced_cents, standard: row.price_standard_cents, bonus: row.price_bonus_cents },
    commission_bps: row.commission_bps,
    deposit_per_hive_cents: row.deposit_per_hive_cents,
  };
}

/** The rule set an order takes: the latest effective_from on or before its bloom start. */
export async function ruleSetFor(db: Db, bloomStart: string): Promise<RuleSet | null> {
  const [row] = await rows<RuleRow>(db, "SELECT * FROM rule_sets WHERE effective_from <= $1 ORDER BY effective_from DESC LIMIT 1", [bloomStart]);
  return row ? toRuleSet(row) : null;
}

type OrderRow = RuleRow & {
  order_id: string;
  ref: string;
  status: OrderStatus;
  orchard_id: string;
  orchard_name: string;
  county: string;
  grower_id: string;
  grower_name: string;
  bloom_start: string;
  bloom_end: string;
  delivery_deadline: string;
  deposit_invoice_id: string | null;
  balance_invoice_id: string | null;
  report_key: string | null;
};

/** Orders matching `where` (a condition on `o`), newest first, with their blocks, drops, samples, photos, link and settlement. */
export async function loadOrders(db: Db, where: string, params: unknown[] = []): Promise<OrderRecord[]> {
  const orderRows = await rows<OrderRow>(
    db,
    `SELECT o.id AS order_id, o.ref, o.status, o.bloom_start, o.bloom_end, o.delivery_deadline, o.deposit_invoice_id,
            o.balance_invoice_id, o.report_key, c.id AS orchard_id, c.name AS orchard_name, c.county, u.id AS grower_id,
            u.name AS grower_name, r.*
       FROM orders o JOIN orchards c ON c.id = o.orchard_id JOIN users u ON u.id = c.grower_id JOIN rule_sets r ON r.id = o.rule_set_id
      WHERE ${where} ORDER BY o.bloom_start DESC, o.seq DESC`,
    params,
  );
  const ids = orderRows.map((row) => row.order_id);
  if (ids.length === 0) return [];
  const blocks = await rows<BlockRecord & { order_id: string }>(
      db,
      `SELECT ob.order_id, b.id, b.name, b.acres_tenths, ob.hives AS hives_ordered FROM order_blocks ob JOIN blocks b ON b.id = ob.block_id
        WHERE ob.order_id = ANY($1) ORDER BY ob.position`,
      [ids],
    );
  const drops = await rows<Omit<DropRecord, "beekeeper"> & { beekeeper_id: string; beekeeper_name: string }>(
      db,
      `SELECT d.id, d.order_id, d.beekeeper_id, u.name AS beekeeper_name, d.yard_name, d.hives, d.status, d.block_id, d.delivered_on,
              d.dispute_reason, d.resolution_note
         FROM drops d JOIN users u ON u.id = d.beekeeper_id WHERE d.order_id = ANY($1) ORDER BY d.seq`,
      [ids],
    );
  const samples = await rows<SampleRecord & { order_id: string }>(db, "SELECT id, order_id, block_id, drop_id, colony_label, frames_tenths FROM samples WHERE order_id = ANY($1) ORDER BY seq", [ids]);
  const photos = await rows<PhotoRecord & { order_id: string }>(db, "SELECT id, order_id, sample_id FROM photos WHERE order_id = ANY($1) ORDER BY seq", [ids]);
  const links = await rows<Omit<LinkRecord, "status"> & { order_id: string; status: LinkStatus }>(
      db,
      `SELECT DISTINCT ON (order_id) id, order_id, status, inspector_email, expires_at FROM inspection_links
        WHERE order_id = ANY($1) ORDER BY order_id, seq DESC`,
      [ids],
    );
  const settlements = await rows<SettlementRecord & { order_id: string }>(
      db,
      "SELECT order_id, status, payment_received_on, payable_cents, commission_bps, commission_cents, shares FROM settlements WHERE order_id = ANY($1)",
      [ids],
    );
  const now = new Date();
  const byOrder = <T extends { order_id: string }>(list: T[]): Map<string, T[]> => {
    const grouped = new Map<string, T[]>();
    for (const item of list) grouped.set(item.order_id, [...(grouped.get(item.order_id) ?? []), item]);
    return grouped;
  };
  const blocksBy = byOrder(blocks);
  const dropsBy = byOrder(drops);
  const samplesBy = byOrder(samples);
  const photosBy = byOrder(photos);
  const linkBy = new Map(links.map((link) => [link.order_id, link]));
  const settlementBy = new Map(settlements.map((settlement) => [settlement.order_id, settlement]));
  return orderRows.map((row) => {
    const link = linkBy.get(row.order_id);
    const settlement = settlementBy.get(row.order_id);
    return {
      id: row.order_id,
      ref: row.ref,
      status: row.status,
      orchard: { id: row.orchard_id, name: row.orchard_name, county: row.county, grower_id: row.grower_id },
      grower: { id: row.grower_id, name: row.grower_name },
      rule: toRuleSet(row),
      bloom_start: row.bloom_start,
      bloom_end: row.bloom_end,
      delivery_deadline: row.delivery_deadline,
      deposit_invoice_id: row.deposit_invoice_id,
      balance_invoice_id: row.balance_invoice_id,
      report_key: row.report_key,
      blocks: (blocksBy.get(row.order_id) ?? []).map(({ id, name, acres_tenths, hives_ordered }) => ({ id, name, acres_tenths, hives_ordered })),
      drops: (dropsBy.get(row.order_id) ?? []).map(({ beekeeper_id, beekeeper_name, ...drop }) => ({ ...drop, beekeeper: { id: beekeeper_id, name: beekeeper_name } })),
      samples: samplesBy.get(row.order_id) ?? [],
      photos: photosBy.get(row.order_id) ?? [],
      link: link
        ? { id: link.id, status: linkStatus(link.status, link.expires_at, now), inspector_email: link.inspector_email, expires_at: link.expires_at }
        : null,
      settlement: settlement
        ? {
            status: settlement.status,
            payment_received_on: settlement.payment_received_on,
            payable_cents: settlement.payable_cents,
            commission_bps: settlement.commission_bps,
            commission_cents: settlement.commission_cents,
            shares: settlement.shares,
          }
        : null,
    };
  });
}

export async function loadOrder(db: Db, orderId: string): Promise<OrderRecord | null> {
  const [order] = await loadOrders(db, "o.id = $1", [orderId]);
  return order ?? null;
}

/** Locks the order row for the rest of the transaction; decisions on one order are made one at a time. */
export async function lockOrder(db: Db, orderId: string): Promise<OrderRecord | null> {
  const locked = await rows(db, "SELECT id FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
  return locked.length === 0 ? null : loadOrder(db, orderId);
}

export interface BlockAssessment {
  block: BlockRecord;
  hivesDelivered: number;
  samples: SampleRecord[];
  averageTenths: number | null;
  tier: Tier | null;
  payableCents: number;
}

export interface Assessment {
  blocks: BlockAssessment[];
  blockById: Map<string, BlockAssessment>;
  hivesOrdered: number;
  hivesCommitted: number;
  /** Hives ordered minus every drop's hives: the figure the commit rule decides on. */
  hivesRemaining: number;
  hivesDelivered: number;
  payableCents: number;
  depositCents: number;
  allocation: Allocation;
  shares: SettlementShare[];
  dropAverage: Map<string, number | null>;
  dropPayout: Map<string, number | null>;
}

export function priceFor(rule: RuleSet, tier: Tier | null): number {
  return tier === null ? 0 : rule.prices[tier];
}

export function assess(order: OrderRecord): Assessment {
  const blocks = order.blocks.map((block): BlockAssessment => {
    const samples = order.samples.filter((sample) => sample.block_id === block.id);
    const hivesDelivered = order.drops
      .filter((drop) => drop.block_id === block.id && isDelivered(drop.status))
      .reduce((sum, drop) => sum + drop.hives, 0);
    const average = averageTenths(samples.map((sample) => sample.frames_tenths));
    const tier = tierFor(average, order.rule.thresholds);
    return { block, hivesDelivered, samples, averageTenths: average, tier, payableCents: hivesDelivered * priceFor(order.rule, tier) };
  });
  const blockById = new Map(blocks.map((entry) => [entry.block.id, entry]));
  const placed = order.drops.filter((drop) => isDelivered(drop.status));
  const dropGross = (drop: DropRecord): number => drop.hives * priceFor(order.rule, blockById.get(drop.block_id ?? "")?.tier ?? null);
  const beekeepers = new Map<string, { ref: Ref; hives: number; gross: number }>();
  for (const drop of placed) {
    const entry = beekeepers.get(drop.beekeeper.id) ?? { ref: drop.beekeeper, hives: 0, gross: 0 };
    entry.hives += drop.hives;
    entry.gross += dropGross(drop);
    beekeepers.set(drop.beekeeper.id, entry);
  }
  const allocation = allocate(
    [...beekeepers.entries()].map(([beekeeperId, entry]) => ({ beekeeperId, grossCents: entry.gross })),
    order.rule.commission_bps,
  );
  const shares = [...allocation.payouts.entries()].map(([beekeeperId, payout]) => {
    const entry = beekeepers.get(beekeeperId);
    if (!entry) throw new Error("allocation lost a beekeeper");
    return { beekeeper: entry.ref, hives: entry.hives, gross_cents: entry.gross, payout_cents: payout };
  });
  const dropPayout = new Map<string, number | null>(order.drops.map((drop) => [drop.id, null]));
  for (const [beekeeperId, share] of allocation.payouts) {
    const sampled = placed.filter((drop) => drop.beekeeper.id === beekeeperId && blockById.get(drop.block_id ?? "")?.averageTenths !== null);
    for (const [dropId, payout] of splitShare(share, sampled.map((drop) => ({ dropId: drop.id, grossCents: dropGross(drop) })))) {
      dropPayout.set(dropId, payout);
    }
  }
  const dropAverage = new Map(
    order.drops.map((drop) => [drop.id, averageTenths(order.samples.filter((sample) => sample.drop_id === drop.id).map((sample) => sample.frames_tenths))]),
  );
  const hivesOrdered = order.blocks.reduce((sum, block) => sum + block.hives_ordered, 0);
  const hivesCommitted = order.drops.reduce((sum, drop) => sum + drop.hives, 0);
  return {
    blocks,
    blockById,
    hivesOrdered,
    hivesCommitted,
    hivesRemaining: hivesOrdered - hivesCommitted,
    hivesDelivered: blocks.reduce((sum, entry) => sum + entry.hivesDelivered, 0),
    payableCents: blocks.reduce((sum, entry) => sum + entry.payableCents, 0),
    depositCents: hivesOrdered * order.rule.deposit_per_hive_cents,
    allocation,
    shares,
    dropAverage,
    dropPayout,
  };
}

interface Visibility {
  status: OrderStatus;
  growerId: string;
  beekeeperIds: readonly string[];
}

/** Who may see an order at all (brief: GET /api/orders). Anyone else gets 404. */
export function canSee(user: User, order: Visibility): boolean {
  if (user.role === "broker") return true;
  if (user.role === "grower") return order.growerId === user.id && order.status !== "draft";
  return order.status === "open" || order.beekeeperIds.includes(user.id);
}

export function canSeeOrder(user: User, order: OrderRecord): boolean {
  return canSee(user, { status: order.status, growerId: order.orchard.grower_id, beekeeperIds: order.drops.map((drop) => drop.beekeeper.id) });
}
