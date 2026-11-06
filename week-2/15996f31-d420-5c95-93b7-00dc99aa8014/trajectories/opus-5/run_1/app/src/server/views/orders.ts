import type {
  BeekeeperOrder,
  BeekeeperOrderListItem,
  BrokerOrder,
  BrokerOrderListItem,
  BrokerPlacement,
  DropPhoto,
  DropView,
  GrowerOrder,
  GrowerOrderListItem,
  GrowerPlacement,
  InspectionLinkView,
  Settlement,
} from '../../shared/api-types';
import type { DropRecord, OrderAggregate } from '../data/orders';
import type { OrderFigures } from '../domain/figures';
import { payPerHiveByTier, payPerHiveCents } from '../domain/rules';
import { inspectionLinkState } from '../domain/transitions';

function tenthsToNumber(tenths: number | null): number | null {
  return tenths === null ? null : tenths / 10;
}

type DeliveredDrop = DropRecord & { deliveredOn: string };

function growerPlacement(figures: OrderFigures, drop: DeliveredDrop): GrowerPlacement {
  return {
    yard_name: drop.yardName,
    hives: drop.hives,
    delivered_on: drop.deliveredOn,
    average_frames: tenthsToNumber(figures.dropAverageTenths.get(drop.id) ?? null),
  };
}

function brokerPlacement(
  order: OrderAggregate,
  figures: OrderFigures,
  drop: DeliveredDrop,
): BrokerPlacement {
  const tier = drop.blockId === null ? null : (figures.blocks.get(drop.blockId)?.tier ?? null);
  return {
    ...growerPlacement(figures, drop),
    drop_id: drop.id,
    beekeeper: { id: drop.beekeeperId, name: drop.beekeeperName },
    status: drop.status,
    pay_per_hive_cents:
      tier === null
        ? null
        : payPerHiveCents(order.ruleSet.pricePerHiveCents[tier], order.ruleSet.commissionBps),
    payout_cents: figures.payoutByDrop.get(drop.id) ?? null,
  };
}

function deliveredDrops(order: OrderAggregate, blockId: string): DeliveredDrop[] {
  return order.drops.filter(
    (drop): drop is DeliveredDrop => drop.blockId === blockId && drop.deliveredOn !== null,
  );
}

function inspectionLinkView(order: OrderAggregate, now: Date): InspectionLinkView | null {
  const link = order.inspectionLink;
  if (link === null) return null;
  const state = inspectionLinkState({ status: link.status, expiresAt: link.expiresAt }, now);
  const status =
    state === 'signed'
      ? 'signed'
      : state === 'expired'
        ? 'expired'
        : link.status === 'used'
          ? 'used'
          : 'issued';
  return {
    id: link.id,
    status,
    inspector_email: link.inspectorEmail,
    expires_at: link.expiresAt.toISOString(),
  };
}

export function growerOrderView(order: OrderAggregate, figures: OrderFigures): GrowerOrder {
  return {
    ...growerOrderListView(order, figures),
    blocks: [...figures.blocks.values()].map((block) => ({
      id: block.blockId,
      name: block.name,
      acres: block.acresTenths / 10,
      hives_ordered: block.hivesOrdered,
      hives_delivered: block.hivesDelivered,
      sample_count: block.sampleCount,
      average_frames: tenthsToNumber(block.averageTenths),
      tier: block.tier,
      payable_cents: block.payableCents,
      placements: deliveredDrops(order, block.blockId).map((drop) =>
        growerPlacement(figures, drop),
      ),
    })),
  };
}

export function growerOrderListView(
  order: OrderAggregate,
  figures: OrderFigures,
): GrowerOrderListItem {
  return {
    id: order.id,
    ref: order.ref,
    status: order.status,
    settlement_status: order.settlementStatus,
    orchard: { id: order.orchard.id, name: order.orchard.name, county: order.orchard.county },
    bloom_start: order.bloomStart,
    bloom_end: order.bloomEnd,
    delivery_deadline: order.deliveryDeadline,
    hives_ordered: figures.hivesOrdered,
    hives_delivered: figures.hivesDelivered,
    deposit_cents: figures.depositCents,
    payable_cents: figures.payableCents,
    report_available: order.reportAvailable,
  };
}

export function brokerOrderView(
  order: OrderAggregate,
  figures: OrderFigures,
  now: Date,
): BrokerOrder {
  const grower = growerOrderView(order, figures);
  return {
    ...brokerOrderListView(order, figures, now),
    blocks: grower.blocks.map((block) => ({
      ...block,
      placements: deliveredDrops(order, block.id).map((drop) =>
        brokerPlacement(order, figures, drop),
      ),
    })),
  };
}

export function brokerOrderListView(
  order: OrderAggregate,
  figures: OrderFigures,
  now: Date,
): BrokerOrderListItem {
  return {
    ...growerOrderListView(order, figures),
    grower: { id: order.orchard.growerId, name: order.orchard.growerName },
    hives_committed: figures.hivesCommitted,
    rule_set: { id: order.ruleSet.id, name: order.ruleSet.name },
    commission_bps: order.ruleSet.commissionBps,
    commission_cents: figures.commissionCents,
    inspection_link: inspectionLinkView(order, now),
  };
}

export function beekeeperOrderListView(
  order: OrderAggregate,
  figures: OrderFigures,
): BeekeeperOrderListItem {
  return {
    id: order.id,
    ref: order.ref,
    status: order.status,
    orchard: { id: order.orchard.id, name: order.orchard.name, county: order.orchard.county },
    bloom_start: order.bloomStart,
    bloom_end: order.bloomEnd,
    delivery_deadline: order.deliveryDeadline,
    hives_ordered: figures.hivesOrdered,
    hives_remaining: figures.hivesRemaining,
    pay_per_hive_cents: payPerHiveByTier(order.ruleSet),
  };
}

export function beekeeperOrderView(
  order: OrderAggregate,
  figures: OrderFigures,
  beekeeperId: string,
): BeekeeperOrder {
  return {
    ...beekeeperOrderListView(order, figures),
    blocks: [...figures.blocks.values()].map((block) => ({
      id: block.blockId,
      name: block.name,
      hives_ordered: block.hivesOrdered,
      hives_delivered: block.hivesDelivered,
      average_frames: tenthsToNumber(block.averageTenths),
      tier: block.tier,
    })),
    my_drops: order.drops
      .filter((drop) => drop.beekeeperId === beekeeperId)
      .map((drop) => dropView(order, figures, drop, false)),
  };
}

export function dropView(
  order: OrderAggregate,
  figures: OrderFigures,
  drop: DropRecord,
  includeBeekeeper: boolean,
): DropView {
  const block = drop.blockId === null ? undefined : figures.blocks.get(drop.blockId);
  const tier = block?.tier ?? null;
  const sampleIds = new Set(
    order.samples.filter((sample) => sample.dropId === drop.id).map((sample) => sample.id),
  );
  const colonyBySample = new Map(
    order.samples.map((sample) => [sample.id, sample.colonyLabel] as const),
  );
  const photos: DropPhoto[] = order.photos
    .filter((photo) => sampleIds.has(photo.sampleId))
    .map((photo) => ({
      id: photo.id,
      colony_label: colonyBySample.get(photo.sampleId) ?? '',
      url: `/api/photos/${photo.id}`,
    }));

  return {
    id: drop.id,
    order: { id: order.id, ref: order.ref },
    orchard: { id: order.orchard.id, name: order.orchard.name },
    yard_name: drop.yardName,
    hives: drop.hives,
    status: drop.status,
    block: block === undefined ? null : { id: block.blockId, name: block.name },
    delivered_on: drop.deliveredOn,
    average_frames: tenthsToNumber(figures.dropAverageTenths.get(drop.id) ?? null),
    block_average_frames: tenthsToNumber(block?.averageTenths ?? null),
    tier,
    pay_per_hive_cents:
      tier === null
        ? null
        : payPerHiveCents(order.ruleSet.pricePerHiveCents[tier], order.ruleSet.commissionBps),
    payout_cents: figures.payoutByDrop.get(drop.id) ?? null,
    dispute_reason: drop.disputeReason,
    resolution_note: drop.resolutionNote,
    photos,
    ...(includeBeekeeper ? { beekeeper: { id: drop.beekeeperId, name: drop.beekeeperName } } : {}),
  };
}

export function settlementView(order: OrderAggregate, figures: OrderFigures): Settlement {
  const stored = order.settlement;
  if (stored !== null) {
    const names = new Map(order.drops.map((drop) => [drop.beekeeperId, drop.beekeeperName] as const));
    return {
      status: stored.status,
      payment_received_on: stored.paymentReceivedOn,
      rule_set: { id: stored.ruleSetId, name: stored.ruleSetName },
      payable_cents: stored.payableCents,
      commission_bps: stored.commissionBps,
      commission_cents: stored.commissionCents,
      shares: [...stored.shares]
        .sort((left, right) => (left.beekeeperId < right.beekeeperId ? -1 : 1))
        .map((share) => ({
          beekeeper: {
            id: share.beekeeperId,
            name: names.get(share.beekeeperId) ?? share.beekeeperId,
          },
          hives: share.hives,
          gross_cents: share.grossCents,
          payout_cents: share.payoutCents,
        })),
    };
  }
  const names = new Map(order.drops.map((drop) => [drop.beekeeperId, drop.beekeeperName] as const));
  return {
    status: 'preview',
    payment_received_on: null,
    rule_set: { id: order.ruleSet.id, name: order.ruleSet.name },
    payable_cents: figures.payableCents,
    commission_bps: order.ruleSet.commissionBps,
    commission_cents: figures.commissionCents,
    shares: [...figures.grossByBeekeeper.keys()]
      .sort((left, right) => (left < right ? -1 : 1))
      .map((beekeeperId) => ({
        beekeeper: { id: beekeeperId, name: names.get(beekeeperId) ?? beekeeperId },
        hives: figures.hivesByBeekeeper.get(beekeeperId) ?? 0,
        gross_cents: figures.grossByBeekeeper.get(beekeeperId) ?? 0,
        payout_cents: figures.payoutByBeekeeper.get(beekeeperId) ?? 0,
      })),
  };
}
