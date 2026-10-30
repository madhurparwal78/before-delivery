import type { BlockStrength, InspectionSheet } from '../../shared/api-types';
import type { LinkHandle } from '../data/inspection-links';
import type { OrderAggregate } from '../data/orders';
import type { OrderFigures } from '../domain/figures';

function photoUrl(token: string, photoId: string): string {
  return `/api/inspect/${token}/photos/${photoId}`;
}

export function blockStrengthView(figures: OrderFigures, blockId: string): BlockStrength {
  const strength = figures.blocks.get(blockId);
  return {
    id: blockId,
    sample_count: strength?.sampleCount ?? 0,
    average_frames:
      strength?.averageTenths === null || strength === undefined
        ? null
        : strength.averageTenths / 10,
    tier: strength?.tier ?? null,
    payable_cents: strength?.payableCents ?? 0,
  };
}

export function inspectionSheetView(
  order: OrderAggregate,
  figures: OrderFigures,
  link: LinkHandle,
  token: string,
): InspectionSheet {
  return {
    order: { ref: order.ref },
    orchard: { name: order.orchard.name, county: order.orchard.county },
    link: {
      status: link.status === 'issued' ? 'used' : link.status,
      expires_at: link.expiresAt.toISOString(),
    },
    blocks: order.blocks.map((block) => {
      const strength = figures.blocks.get(block.blockId);
      return {
        id: block.blockId,
        name: block.name,
        hives_delivered: strength?.hivesDelivered ?? 0,
        samples_required: strength?.samplesRequired ?? 0,
        sample_count: strength?.sampleCount ?? 0,
        average_frames:
          strength === undefined || strength.averageTenths === null
            ? null
            : strength.averageTenths / 10,
        tier: strength?.tier ?? null,
        payable_cents: strength?.payableCents ?? 0,
        yards: order.drops
          .filter((drop) => drop.blockId === block.blockId)
          .map((drop) => ({ drop_id: drop.id, yard_name: drop.yardName, hives: drop.hives })),
        samples: order.samples
          .filter((sample) => sample.blockId === block.blockId)
          .map((sample) => ({
            id: sample.id,
            drop_id: sample.dropId,
            colony_label: sample.colonyLabel,
            frames: sample.framesTenths / 10,
            photos: order.photos
              .filter((photo) => photo.sampleId === sample.id)
              .map((photo) => ({ id: photo.id, url: photoUrl(token, photo.id) })),
          })),
      };
    }),
    payable_cents: figures.payableCents,
  };
}
