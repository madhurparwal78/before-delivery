// One builder per published field list (brief: API → Published field lists). Nothing else reaches a response,
// so a grower never receives beekeeper identities, pay or commission.

import type {
  AnyOrder,
  BeekeeperOrder,
  BrokerOrder,
  Drop,
  GrowerOrder,
  OrderListItem,
  Settlement,
  SettlementStatus,
  User,
} from "../shared/api.js";
import { tenthsToNumber } from "../shared/strength.js";
import { payPerHive } from "./domain/allocation.js";
import { isDelivered } from "./domain/transitions.js";
import { assess, priceFor, type Assessment, type DropRecord, type OrderRecord } from "./model.js";

function settlementStatus(order: OrderRecord): SettlementStatus {
  return order.settlement?.status ?? "none";
}

function growerOrder(order: OrderRecord, figures: Assessment): GrowerOrder {
  return {
    id: order.id,
    ref: order.ref,
    status: order.status,
    settlement_status: settlementStatus(order),
    orchard: { id: order.orchard.id, name: order.orchard.name, county: order.orchard.county },
    bloom_start: order.bloom_start,
    bloom_end: order.bloom_end,
    delivery_deadline: order.delivery_deadline,
    hives_ordered: figures.hivesOrdered,
    hives_delivered: figures.hivesDelivered,
    deposit_cents: figures.depositCents,
    payable_cents: order.settlement?.payable_cents ?? figures.payableCents,
    report_available: order.report_key !== null,
    blocks: figures.blocks.map((entry) => ({
      id: entry.block.id,
      name: entry.block.name,
      acres: entry.block.acres_tenths / 10,
      hives_ordered: entry.block.hives_ordered,
      hives_delivered: entry.hivesDelivered,
      sample_count: entry.samples.length,
      average_frames: tenthsToNumber(entry.averageTenths),
      tier: entry.tier,
      payable_cents: entry.payableCents,
      placements: deliveredIn(order, entry.block.id).map((drop) => ({
        yard_name: drop.yard_name,
        hives: drop.hives,
        delivered_on: drop.delivered_on ?? "",
        average_frames: tenthsToNumber(figures.dropAverage.get(drop.id) ?? null),
      })),
    })),
  };
}

function deliveredIn(order: OrderRecord, blockId: string): DropRecord[] {
  return order.drops.filter((drop) => drop.block_id === blockId && isDelivered(drop.status));
}

function dropPayPerHive(order: OrderRecord, figures: Assessment, drop: DropRecord): number | null {
  const tier = drop.block_id ? (figures.blockById.get(drop.block_id)?.tier ?? null) : null;
  return tier === null ? null : payPerHive(priceFor(order.rule, tier), order.rule.commission_bps);
}

function brokerOrder(order: OrderRecord, figures: Assessment): BrokerOrder {
  const base = growerOrder(order, figures);
  return {
    ...base,
    grower: order.grower,
    hives_committed: figures.hivesCommitted,
    rule_set: { id: order.rule.id, name: order.rule.name },
    commission_bps: order.rule.commission_bps,
    commission_cents: order.settlement?.commission_cents ?? figures.allocation.commissionCents,
    inspection_link: order.link
      ? { id: order.link.id, status: order.link.status, inspector_email: order.link.inspector_email, expires_at: order.link.expires_at.toISOString() }
      : null,
    blocks: base.blocks.map((block) => ({
      ...block,
      placements: deliveredIn(order, block.id).map((drop) => ({
        yard_name: drop.yard_name,
        hives: drop.hives,
        delivered_on: drop.delivered_on ?? "",
        average_frames: tenthsToNumber(figures.dropAverage.get(drop.id) ?? null),
        drop_id: drop.id,
        beekeeper: drop.beekeeper,
        status: drop.status,
        pay_per_hive_cents: dropPayPerHive(order, figures, drop),
        payout_cents: figures.dropPayout.get(drop.id) ?? null,
      })),
    })),
  };
}

export function dropView(order: OrderRecord, figures: Assessment, drop: DropRecord, viewer: User): Drop {
  const block = drop.block_id ? figures.blockById.get(drop.block_id) : undefined;
  const view: Drop = {
    id: drop.id,
    order: { id: order.id, ref: order.ref },
    orchard: { id: order.orchard.id, name: order.orchard.name },
    yard_name: drop.yard_name,
    hives: drop.hives,
    status: drop.status,
    block: block ? { id: block.block.id, name: block.block.name } : null,
    delivered_on: drop.delivered_on,
    average_frames: tenthsToNumber(figures.dropAverage.get(drop.id) ?? null),
    block_average_frames: tenthsToNumber(block?.averageTenths ?? null),
    tier: block?.tier ?? null,
    pay_per_hive_cents: dropPayPerHive(order, figures, drop),
    payout_cents: figures.dropPayout.get(drop.id) ?? null,
    dispute_reason: drop.dispute_reason,
    resolution_note: drop.resolution_note,
    photos: order.samples
      .filter((sample) => sample.drop_id === drop.id)
      .flatMap((sample) =>
        order.photos.filter((photo) => photo.sample_id === sample.id).map((photo) => ({ id: photo.id, colony_label: sample.colony_label, url: `/api/photos/${photo.id}` })),
      ),
  };
  return viewer.role === "broker" ? { ...view, beekeeper: drop.beekeeper } : view;
}

function beekeeperOrder(order: OrderRecord, figures: Assessment, viewer: User): BeekeeperOrder {
  const prices = order.rule.prices;
  const bps = order.rule.commission_bps;
  return {
    id: order.id,
    ref: order.ref,
    status: order.status,
    orchard: { id: order.orchard.id, name: order.orchard.name, county: order.orchard.county },
    bloom_start: order.bloom_start,
    bloom_end: order.bloom_end,
    delivery_deadline: order.delivery_deadline,
    hives_ordered: figures.hivesOrdered,
    hives_remaining: figures.hivesRemaining,
    pay_per_hive_cents: {
      none: payPerHive(prices.none, bps),
      reduced: payPerHive(prices.reduced, bps),
      standard: payPerHive(prices.standard, bps),
      bonus: payPerHive(prices.bonus, bps),
    },
    blocks: figures.blocks.map((entry) => ({
      id: entry.block.id,
      name: entry.block.name,
      hives_ordered: entry.block.hives_ordered,
      hives_delivered: entry.hivesDelivered,
      average_frames: tenthsToNumber(entry.averageTenths),
      tier: entry.tier,
    })),
    my_drops: order.drops.filter((drop) => drop.beekeeper.id === viewer.id).map((drop) => dropView(order, figures, drop, viewer)),
  };
}

export function orderView(order: OrderRecord, viewer: User): AnyOrder {
  const figures = assess(order);
  if (viewer.role === "broker") return brokerOrder(order, figures);
  if (viewer.role === "grower") return growerOrder(order, figures);
  return beekeeperOrder(order, figures, viewer);
}

export function orderListView(order: OrderRecord, viewer: User): OrderListItem {
  const { blocks: _blocks, my_drops: _drops, ...listed } = orderView(order, viewer) as AnyOrder & { my_drops?: unknown };
  return listed as OrderListItem;
}

export function settlementView(order: OrderRecord): Settlement {
  const stored = order.settlement;
  if (stored) {
    return {
      status: stored.status,
      payment_received_on: stored.payment_received_on,
      rule_set: { id: order.rule.id, name: order.rule.name },
      payable_cents: stored.payable_cents,
      commission_bps: stored.commission_bps,
      commission_cents: stored.commission_cents,
      shares: stored.shares,
    };
  }
  const figures = assess(order);
  return {
    status: "preview",
    payment_received_on: null,
    rule_set: { id: order.rule.id, name: order.rule.name },
    payable_cents: figures.payableCents,
    commission_bps: order.rule.commission_bps,
    commission_cents: figures.allocation.commissionCents,
    shares: figures.shares,
  };
}
