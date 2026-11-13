import { INGREDIENTS_BY_ID, IngredientDefinition } from '../shared/catalog';
import { memberBlendPriceCents } from '../shared/money';

export interface BlendItemInput {
  ingredient: string;
  capsulesPerDay: number;
}

export interface PackedItem {
  ingredient: string;
  capsulesPerDay: number;
  morning: number;
  evening: number;
}

export interface PackedBlend {
  items: PackedItem[];
  morningCapsules: number;
  eveningCapsules: number;
  listPriceCents: number;
  memberPriceCents: number;
}

export const PACKET_CAPACITY = 4;

function packetSplit(
  ingredient: IngredientDefinition,
  capsulesPerDay: number,
): { morning: number; evening: number } {
  if (ingredient.time === 'morning') return { morning: capsulesPerDay, evening: 0 };
  if (ingredient.time === 'evening') return { morning: 0, evening: capsulesPerDay };
  const morning = Math.ceil(capsulesPerDay / 2);
  return { morning, evening: capsulesPerDay - morning };
}

/** Packs whole capsules into the morning and evening packets and prices 30 days. */
export function packBlend(inputs: BlendItemInput[]): PackedBlend {
  const items: PackedItem[] = [];
  let morningCapsules = 0;
  let eveningCapsules = 0;
  let listPriceCents = 0;
  for (const input of inputs) {
    const ingredient = INGREDIENTS_BY_ID.get(input.ingredient);
    if (!ingredient) throw new Error(`Unknown ingredient ${input.ingredient}`);
    const split = packetSplit(ingredient, input.capsulesPerDay);
    morningCapsules += split.morning;
    eveningCapsules += split.evening;
    listPriceCents += input.capsulesPerDay * 30 * ingredient.priceCentsPerCapsule;
    items.push({
      ingredient: ingredient.id,
      capsulesPerDay: input.capsulesPerDay,
      morning: split.morning,
      evening: split.evening,
    });
  }
  return {
    items,
    morningCapsules,
    eveningCapsules,
    listPriceCents,
    memberPriceCents: memberBlendPriceCents(listPriceCents),
  };
}

/** The packet that overflows, the morning one when both do. */
export function overfullPacket(blend: PackedBlend): 'morning' | 'evening' | null {
  if (blend.morningCapsules > PACKET_CAPACITY) return 'morning';
  if (blend.eveningCapsules > PACKET_CAPACITY) return 'evening';
  return null;
}
