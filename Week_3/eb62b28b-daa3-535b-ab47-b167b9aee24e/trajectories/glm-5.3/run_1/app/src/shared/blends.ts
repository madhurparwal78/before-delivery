import { Decimal } from "decimal.js";
import { dec } from "./money.js";
import type { PacketTime } from "./enums.js";

export type IngredientDef = {
  id: string;
  name: string;
  strength: string;
  mcg: string | null;
  time: PacketTime;
  priceCentsPerCapsule: number;
};

export const INGREDIENTS: IngredientDef[] = [
  { id: "vitaminD3", name: "Vitamin D3", strength: "5,000 IU", mcg: "125", time: "morning", priceCentsPerCapsule: 9 },
  { id: "vitaminD3Small", name: "Vitamin D3 low dose", strength: "1,000 IU", mcg: "25", time: "morning", priceCentsPerCapsule: 6 },
  { id: "magnesiumGlycinate", name: "Magnesium glycinate", strength: "200 mg", mcg: null, time: "evening", priceCentsPerCapsule: 12 },
  { id: "omega3", name: "Omega-3", strength: "1,000 mg", mcg: null, time: "split", priceCentsPerCapsule: 18 },
  { id: "methylB12", name: "Methyl B12", strength: "1,000 mcg", mcg: null, time: "morning", priceCentsPerCapsule: 15 },
  { id: "ashwagandha", name: "Ashwagandha", strength: "300 mg", mcg: null, time: "evening", priceCentsPerCapsule: 15 },
  { id: "vitaminK2", name: "Vitamin K2 (MK-7)", strength: "100 mcg", mcg: null, time: "morning", priceCentsPerCapsule: 11 },
  { id: "zincPicolinate", name: "Zinc picolinate", strength: "15 mg", mcg: null, time: "evening", priceCentsPerCapsule: 8 },
  { id: "creatine", name: "Creatine monohydrate", strength: "1,000 mg", mcg: null, time: "split", priceCentsPerCapsule: 6 },
  { id: "coq10", name: "CoQ10", strength: "100 mg", mcg: null, time: "morning", priceCentsPerCapsule: 22 },
  { id: "glycine", name: "Glycine", strength: "1,000 mg", mcg: null, time: "evening", priceCentsPerCapsule: 5 },
];

export const INGREDIENT_BY_ID: Map<string, IngredientDef> = new Map(
  INGREDIENTS.map((i) => [i.id, i])
);

export type BlendItemInput = { ingredient: string; capsulesPerDay: number };
export type PackedItem = { ingredient: string; capsulesPerDay: number; morning: number; evening: number };

export type PackedBlend = {
  items: PackedItem[];
  morningCapsules: number;
  eveningCapsules: number;
  listPriceCents: number;
  memberPriceCents: number;
};

export const MAX_PACKET_CAPSULES = 4;
export const BLEND_MEMBER_DISCOUNT_NUMERATOR = "85";

/**
 * Pack a blend: morning and evening ingredients go wholly into their packet;
 * split ingredients divide with the odd capsule going to the morning packet.
 * Each packet holds at most 4 capsules. This is the one place packing is decided.
 */
export function packBlend(items: BlendItemInput[]): PackedBlend {
  const packed: PackedItem[] = [];
  let morning = 0;
  let evening = 0;
  let listPrice = dec(0);
  for (const item of items) {
    const def = INGREDIENT_BY_ID.get(item.ingredient);
    if (!def) continue;
    const perDay = item.capsulesPerDay;
    let itemMorning = 0;
    let itemEvening = 0;
    if (def.time === "morning") {
      itemMorning = perDay;
    } else if (def.time === "evening") {
      itemEvening = perDay;
    } else {
      itemMorning = Math.ceil(perDay / 2);
      itemEvening = perDay - itemMorning;
    }
    morning += itemMorning;
    evening += itemEvening;
    listPrice = listPrice.plus(dec(perDay).times(dec(30)).times(dec(def.priceCentsPerCapsule)));
    packed.push({ ingredient: def.id, capsulesPerDay: perDay, morning: itemMorning, evening: itemEvening });
  }
  const listPriceCents = listPrice.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  // The member price is 85% of the list price, rounded half up to the cent.
  const rawMember = dec(listPriceCents).times(dec(BLEND_MEMBER_DISCOUNT_NUMERATOR)).dividedBy(dec(100));
  const memberPriceCents = rawMember.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  return {
    items: packed,
    morningCapsules: morning,
    eveningCapsules: evening,
    listPriceCents,
    memberPriceCents,
  };
}

/** Which packet overflows first (morning when both do). */
export function overflowingPacket(blend: PackedBlend): "morning" | "evening" | null {
  if (blend.morningCapsules > MAX_PACKET_CAPSULES) return "morning";
  if (blend.eveningCapsules > MAX_PACKET_CAPSULES) return "evening";
  return null;
}

export function strengthLabel(def: IngredientDef): string {
  return def.mcg ? `${def.strength} (${def.mcg} mcg)` : def.strength;
}
