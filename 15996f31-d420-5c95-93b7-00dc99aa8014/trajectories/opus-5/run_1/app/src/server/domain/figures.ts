import type { Tier } from '../../shared/labels';
import type { OrderAggregate } from '../data/orders';
import { allocateSettlement, splitShareAcrossDrops, type PartyGross } from './allocation';
import {
  averageFramesTenths,
  blockPayableCents,
  depositCents,
  samplesRequired,
  tierFor,
} from './rules';

export interface BlockFigures {
  blockId: string;
  name: string;
  acresTenths: number;
  hivesOrdered: number;
  hivesDelivered: number;
  sampleCount: number;
  samplesRequired: number;
  averageTenths: number | null;
  tier: Tier | null;
  payableCents: number;
}

export interface OrderFigures {
  blocks: Map<string, BlockFigures>;
  hivesOrdered: number;
  hivesCommitted: number;
  hivesRemaining: number;
  hivesDelivered: number;
  depositCents: number;
  payableCents: number;
  commissionCents: number;
  grossByBeekeeper: Map<string, number>;
  payoutByBeekeeper: Map<string, number>;
  hivesByBeekeeper: Map<string, number>;
  payoutByDrop: Map<string, number | null>;
  dropAverageTenths: Map<string, number | null>;
}

/** Every derived figure of an order, computed from its stored rows alone. */
export function computeOrderFigures(order: OrderAggregate): OrderFigures {
  const framesByBlock = new Map<string, number[]>();
  const framesByDrop = new Map<string, number[]>();
  for (const sample of order.samples) {
    const blockFrames = framesByBlock.get(sample.blockId) ?? [];
    blockFrames.push(sample.framesTenths);
    framesByBlock.set(sample.blockId, blockFrames);
    const dropFrames = framesByDrop.get(sample.dropId) ?? [];
    dropFrames.push(sample.framesTenths);
    framesByDrop.set(sample.dropId, dropFrames);
  }

  const deliveredByBlock = new Map<string, number>();
  for (const drop of order.drops) {
    if (drop.blockId === null) continue;
    deliveredByBlock.set(drop.blockId, (deliveredByBlock.get(drop.blockId) ?? 0) + drop.hives);
  }

  const blocks = new Map<string, BlockFigures>();
  let payableCents = 0;
  let hivesOrdered = 0;
  let hivesDelivered = 0;
  for (const block of order.blocks) {
    const frames = framesByBlock.get(block.blockId) ?? [];
    const averageTenths = averageFramesTenths(frames);
    const tier = averageTenths === null ? null : tierFor(averageTenths, order.ruleSet);
    const delivered = deliveredByBlock.get(block.blockId) ?? 0;
    const blockPayable = blockPayableCents(delivered, tier, order.ruleSet);
    blocks.set(block.blockId, {
      blockId: block.blockId,
      name: block.name,
      acresTenths: block.acresTenths,
      hivesOrdered: block.hivesOrdered,
      hivesDelivered: delivered,
      sampleCount: frames.length,
      samplesRequired: samplesRequired(delivered),
      averageTenths,
      tier,
      payableCents: blockPayable,
    });
    payableCents += blockPayable;
    hivesOrdered += block.hivesOrdered;
    hivesDelivered += delivered;
  }

  const hivesCommitted = order.drops.reduce((total, drop) => total + drop.hives, 0);

  const grossByBeekeeper = new Map<string, number>();
  const hivesByBeekeeper = new Map<string, number>();
  const dropGross = new Map<string, number>();
  for (const drop of order.drops) {
    const block = drop.blockId === null ? undefined : blocks.get(drop.blockId);
    const tier = block?.tier ?? null;
    const gross = tier === null ? 0 : drop.hives * order.ruleSet.pricePerHiveCents[tier];
    dropGross.set(drop.id, gross);
    grossByBeekeeper.set(drop.beekeeperId, (grossByBeekeeper.get(drop.beekeeperId) ?? 0) + gross);
    hivesByBeekeeper.set(
      drop.beekeeperId,
      (hivesByBeekeeper.get(drop.beekeeperId) ?? 0) + drop.hives,
    );
  }

  const grosses: PartyGross[] = [...grossByBeekeeper.entries()].map(([beekeeperId, grossCents]) => ({
    beekeeperId,
    grossCents,
  }));
  const allocation = allocateSettlement(payableCents, order.ruleSet.commissionBps, grosses);
  const payoutByBeekeeper = new Map(
    allocation.shares.map((share) => [share.beekeeperId, share.payoutCents]),
  );

  const payoutByDrop = new Map<string, number | null>();
  for (const [beekeeperId, payoutCents] of payoutByBeekeeper) {
    const payable = order.drops.filter(
      (drop) =>
        drop.beekeeperId === beekeeperId &&
        drop.blockId !== null &&
        (blocks.get(drop.blockId)?.sampleCount ?? 0) > 0,
    );
    const split = splitShareAcrossDrops(
      payoutCents,
      payable.map((drop) => ({ dropId: drop.id, grossCents: dropGross.get(drop.id) ?? 0 })),
    );
    for (const drop of order.drops) {
      if (drop.beekeeperId !== beekeeperId) continue;
      payoutByDrop.set(drop.id, split.get(drop.id) ?? null);
    }
  }

  const dropAverageTenths = new Map<string, number | null>();
  for (const drop of order.drops) {
    dropAverageTenths.set(drop.id, averageFramesTenths(framesByDrop.get(drop.id) ?? []));
  }

  return {
    blocks,
    hivesOrdered,
    hivesCommitted,
    hivesRemaining: hivesOrdered - hivesCommitted,
    hivesDelivered,
    depositCents: depositCents(hivesOrdered, order.ruleSet),
    payableCents,
    commissionCents: allocation.commissionCents,
    grossByBeekeeper,
    payoutByBeekeeper,
    hivesByBeekeeper,
    payoutByDrop,
    dropAverageTenths,
  };
}
