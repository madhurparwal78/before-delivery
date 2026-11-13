// The published ingredient catalog.

import type { Packet } from "./api";

export const PACKET_CAPSULES = 4;

export interface Ingredient {
  id: string;
  name: string;
  strength: { amount: string; unit: string; mcg?: string };
  time: Packet;
  priceCentsPerCapsule: number;
}

export const INGREDIENTS: readonly Ingredient[] = [
  { id: "vitaminD3", name: "Vitamin D3", strength: { amount: "5000", unit: "IU", mcg: "125" }, time: "morning", priceCentsPerCapsule: 9 },
  { id: "vitaminD3Small", name: "Vitamin D3 low dose", strength: { amount: "1000", unit: "IU", mcg: "25" }, time: "morning", priceCentsPerCapsule: 6 },
  { id: "magnesiumGlycinate", name: "Magnesium glycinate", strength: { amount: "200", unit: "mg" }, time: "evening", priceCentsPerCapsule: 12 },
  { id: "omega3", name: "Omega-3", strength: { amount: "1000", unit: "mg" }, time: "split", priceCentsPerCapsule: 18 },
  { id: "methylB12", name: "Methyl B12", strength: { amount: "1000", unit: "mcg" }, time: "morning", priceCentsPerCapsule: 15 },
  { id: "ashwagandha", name: "Ashwagandha", strength: { amount: "300", unit: "mg" }, time: "evening", priceCentsPerCapsule: 15 },
  { id: "vitaminK2", name: "Vitamin K2 (MK-7)", strength: { amount: "100", unit: "mcg" }, time: "morning", priceCentsPerCapsule: 11 },
  { id: "zincPicolinate", name: "Zinc picolinate", strength: { amount: "15", unit: "mg" }, time: "evening", priceCentsPerCapsule: 8 },
  { id: "creatine", name: "Creatine monohydrate", strength: { amount: "1000", unit: "mg" }, time: "split", priceCentsPerCapsule: 6 },
  { id: "coq10", name: "CoQ10", strength: { amount: "100", unit: "mg" }, time: "morning", priceCentsPerCapsule: 22 },
  { id: "glycine", name: "Glycine", strength: { amount: "1000", unit: "mg" }, time: "evening", priceCentsPerCapsule: 5 },
];

export function ingredientName(id: string): string {
  return INGREDIENTS.find((entry) => entry.id === id)?.name ?? id;
}
