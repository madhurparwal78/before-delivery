import type { Tier } from "../domain/model.ts";
import { payPerHiveCents, allocateSettlement } from "../domain/model.ts";
import { orderStatusLabel } from "../domain/states.ts";
import {
  deliveredHivesByBlock, strengthByBlock, orchardPayableCents, payoutCentsByDrop,
  hivesOrdered, hivesCommitted, hivesDelivered, hivesRemaining, grossesByBeekeeper,
  type OrderContext, type DropRow, type SessionUser,
} from "../store.ts";

/**
 * The published field lists, exactly. Grower responses never carry beekeeper
 * identities, pay or commission; beekeeper responses never carry the grower's
 * price or commission.
 */

function payPerHiveByTier(context: OrderContext): Record<Tier, number> {
  return {
    none: payPerHiveCents("none", context.ruleSet),
    reduced: payPerHiveCents("reduced", context.ruleSet),
    standard: payPerHiveCents("standard", context.ruleSet),
    bonus: payPerHiveCents("bonus", context.ruleSet),
  };
}

function dropAverageFrames(drop: DropRow, context: OrderContext): number | null {
  const taken = context.samples.filter((s) => s.drop_id === drop.id);
  if (taken.length === 0) return null;
  const sum = taken.reduce((a, s) => a + s.frames_tenths, 0);
  return Math.floor(sum / taken.length + 0.5) / 10;
}

interface DeliveredDrop extends DropRow {
  delivered_on: string;
}

function deliveredDropsInBlock(context: OrderContext, blockId: string): DeliveredDrop[] {
  return context.drops
    .filter((d): d is DeliveredDrop => d.block_id === blockId && d.status !== "committed" && d.delivered_on !== null)
    .sort((a, b) => (`${a.delivered_on}${a.id}`).localeCompare(`${b.delivered_on}${b.id}`));
}

export function serializeGrowerOrder(context: OrderContext): Record<string, unknown> {
  const delivered = deliveredHivesByBlock(context);
  const strengths = strengthByBlock(context);
  const blocks = context.blocks.map((block) => {
    const strength = strengths.get(block.id)!;
    return {
      id: block.id,
      name: block.name,
      acres: Number(block.acres),
      hives_ordered: block.hives_ordered,
      hives_delivered: delivered.get(block.id) ?? 0,
      sample_count: strength.sample_count,
      average_frames: strength.average_frames,
      tier: strength.tier,
      payable_cents: strength.payable_cents,
      placements: deliveredDropsInBlock(context, block.id).map((drop) => ({
        yard_name: drop.yard_name,
        hives: drop.hives,
        delivered_on: drop.delivered_on,
        average_frames: dropAverageFrames(drop, context),
      })),
    };
  });
  return {
    id: context.order.id,
    ref: context.order.ref,
    status: context.order.status,
    settlement_status: context.order.settlement_status,
    orchard: { id: context.orchard.id, name: context.orchard.name, county: context.orchard.county },
    bloom_start: context.order.bloom_start,
    bloom_end: context.order.bloom_end,
    delivery_deadline: context.order.delivery_deadline,
    hives_ordered: hivesOrdered(context),
    hives_delivered: hivesDelivered(context),
    deposit_cents: context.order.deposit_cents,
    payable_cents: orchardPayableCents(context),
    report_available: context.order.signed_at !== null,
    blocks,
  };
}

export function serializeBrokerOrder(context: OrderContext): Record<string, unknown> {
  const strengths = strengthByBlock(context);
  const payouts = payoutCentsByDrop(context);
  const base = serializeGrowerOrder(context);
  const blocks = (base.blocks as Record<string, unknown>[]).map((block) => {
    const blockId = block.id as string;
    const drops = deliveredDropsInBlock(context, blockId);
    return {
      ...block,
      placements: drops.map((drop) => {
        const tier = strengths.get(blockId)?.tier ?? null;
        return {
          yard_name: drop.yard_name,
          hives: drop.hives,
          delivered_on: drop.delivered_on,
          average_frames: dropAverageFrames(drop, context),
          drop_id: drop.id,
          beekeeper: context.beekeepers.get(drop.beekeeper_id) ?? { id: drop.beekeeper_id, name: drop.beekeeper_id },
          status: drop.status,
          pay_per_hive_cents: tier ? payPerHiveCents(tier, context.ruleSet) : null,
          payout_cents: payouts.get(drop.id) ?? null,
        };
      }),
    };
  });
  return {
    ...base,
    blocks,
    grower: { id: context.grower.id, name: context.grower.name },
    hives_committed: hivesCommitted(context),
    rule_set: { id: context.ruleSet.id, name: context.ruleSet.name },
    commission_bps: context.ruleSet.commission_bps,
    commission_cents: context.settlement ? context.settlement.commission_cents : 0,
    inspection_link: context.link
      ? {
          id: context.link.id,
          status: context.link.status,
          inspector_email: context.link.inspector_email,
          expires_at: context.link.expires_at.toISOString(),
        }
      : null,
  };
}

export function serializeBeekeeperOrder(context: OrderContext, beekeeperId: string): Record<string, unknown> {
  const delivered = deliveredHivesByBlock(context);
  const strengths = strengthByBlock(context);
  const blocks = context.blocks.map((block) => {
    const strength = strengths.get(block.id)!;
    return {
      id: block.id,
      name: block.name,
      hives_ordered: block.hives_ordered,
      hives_delivered: delivered.get(block.id) ?? 0,
      average_frames: strength.average_frames,
      tier: strength.tier,
    };
  });
  const myDrops = context.drops.filter((d) => d.beekeeper_id === beekeeperId);
  return {
    id: context.order.id,
    ref: context.order.ref,
    status: context.order.status,
    orchard: { id: context.orchard.id, name: context.orchard.name, county: context.orchard.county },
    bloom_start: context.order.bloom_start,
    bloom_end: context.order.bloom_end,
    delivery_deadline: context.order.delivery_deadline,
    hives_ordered: hivesOrdered(context),
    hives_remaining: hivesRemaining(context),
    pay_per_hive_cents: payPerHiveByTier(context),
    blocks,
    my_drops: myDrops.map((drop) => serializeDrop(context, drop, "beekeeper")),
  };
}

export function serializeOrder(context: OrderContext, actor: SessionUser): Record<string, unknown> {
  if (actor.role === "broker") return serializeBrokerOrder(context);
  if (actor.role === "grower") return serializeGrowerOrder(context);
  return serializeBeekeeperOrder(context, actor.id);
}

export function serializeOrderList(context: OrderContext, actor: SessionUser): Record<string, unknown> {
  const full = serializeOrder(context, actor);
  const entry: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(full)) {
    if (key === "blocks" || key === "my_drops") continue;
    entry[key] = value;
  }
  return entry;
}

export function serializeDrop(context: OrderContext, drop: DropRow, viewer: "broker" | "beekeeper"): Record<string, unknown> {
  const strengths = strengthByBlock(context);
  const payouts = payoutCentsByDrop(context);
  const block = drop.block_id ? context.blocks.find((b) => b.id === drop.block_id) : null;
  const strength = drop.block_id ? strengths.get(drop.block_id) : undefined;
  const sampleIds = context.samples.filter((s) => s.drop_id === drop.id).map((s) => s.id);
  const photos: { id: string; colony_label: string; url: string }[] = [];
  for (const sampleId of sampleIds) {
    const sample = context.samples.find((s) => s.id === sampleId)!;
    for (const photo of context.photos.get(sampleId) ?? []) {
      photos.push({ id: photo.id, colony_label: sample.colony_label, url: `/api/photos/${photo.id}` });
    }
  }
  const payload: Record<string, unknown> = {
    id: drop.id,
    order: { id: context.order.id, ref: context.order.ref },
    orchard: { id: context.orchard.id, name: context.orchard.name },
    yard_name: drop.yard_name,
    hives: drop.hives,
    status: drop.status,
    block: block ? { id: block.id, name: block.name } : null,
    delivered_on: drop.delivered_on,
    average_frames: dropAverageFrames(drop, context),
    block_average_frames: strength?.average_frames ?? null,
    tier: strength?.tier ?? null,
    pay_per_hive_cents: strength?.tier ? payPerHiveCents(strength.tier, context.ruleSet) : null,
    payout_cents: payouts.get(drop.id) ?? null,
    dispute_reason: drop.dispute_reason,
    resolution_note: drop.resolution_note,
    photos,
  };
  if (viewer === "broker") {
    payload.beekeeper = context.beekeepers.get(drop.beekeeper_id) ?? { id: drop.beekeeper_id, name: drop.beekeeper_id };
  }
  return payload;
}

export function serializeSettlement(context: OrderContext, beekeeperNames: Map<string, string>): Record<string, unknown> {
  const grosses = grossesByBeekeeper(context);
  const allocation = allocateSettlement(
    orchardPayableCents(context),
    context.ruleSet.commission_bps,
    [...grosses.entries()].map(([beekeeperId, g]) => ({ beekeeperId, hives: g.hives, grossCents: g.grossCents })),
  );
  const shareView = (beekeeperId: string, hives: number, grossCents: number, payoutCents: number) => ({
    beekeeper: { id: beekeeperId, name: beekeeperNames.get(beekeeperId) ?? beekeeperId },
    hives,
    gross_cents: grossCents,
    payout_cents: payoutCents,
  });
  if (!context.settlement) {
    return {
      status: "preview",
      payment_received_on: null,
      rule_set: { id: context.ruleSet.id, name: context.ruleSet.name },
      payable_cents: orchardPayableCents(context),
      commission_bps: context.ruleSet.commission_bps,
      commission_cents: allocation.commissionCents,
      shares: allocation.shares.map((s) => shareView(s.beekeeperId, s.hives, s.grossCents, s.payoutCents)),
    };
  }
  return {
    status: context.settlement.status,
    payment_received_on: context.settlement.payment_received_on,
    rule_set: { id: context.ruleSet.id, name: context.ruleSet.name },
    payable_cents: context.settlement.payable_cents,
    commission_bps: context.settlement.commission_bps,
    commission_cents: context.settlement.commission_cents,
    shares: context.settlement.shares.map((s) => shareView(s.beekeeper_id, s.hives, s.gross_cents, s.payout_cents)),
  };
}

export function statusLineFor(context: OrderContext): string {
  return orderStatusLabel(context.order.status, context.order.settlement_status);
}
