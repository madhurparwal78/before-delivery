// Domain vocabulary published by the brief: roles, bay classes, belongings kinds, paint stages,
// panels, band labels and the published band ranges. The server's coat stack decides each reading's
// band from these ranges; the browser only prints them in the band key.

export type Role = "concierge" | "care_technician" | "workshop_lead" | "house_manager" | "owner";

export type BayClass = "standard" | "covered_lift" | "sealed_capsule";
export const BAY_CLASS_LABEL: Record<BayClass, string> = {
  standard: "Standard",
  covered_lift: "Covered lift",
  sealed_capsule: "Sealed capsule",
};

export type ItemKind = "key_set" | "cover" | "spare_wheel" | "document";
export const ITEM_KINDS: readonly ItemKind[] = ["key_set", "cover", "spare_wheel", "document"];
export const ITEM_KIND_LABEL: Record<ItemKind, string> = {
  key_set: "Key set",
  cover: "Cover",
  spare_wheel: "Spare wheel",
  document: "Document",
};

export type LineKind = "part" | "labour" | "paint_materials";
export const LINE_KINDS: readonly LineKind[] = ["part", "labour", "paint_materials"];
export const LINE_KIND_LABEL: Record<LineKind, string> = {
  part: "Part",
  labour: "Labour",
  paint_materials: "Paint materials",
};

export const STAGES = ["Intake", "Stripped", "Epoxy primer", "Guide coat", "2K primer", "Base", "Clear", "Cut and polish"] as const;

export const PANELS = [
  { id: "front_valance", name: "Front valance" },
  { id: "bonnet", name: "Bonnet" },
  { id: "front_wing_l", name: "Front wing L" },
  { id: "front_wing_r", name: "Front wing R" },
  { id: "door_l", name: "Door L" },
  { id: "door_r", name: "Door R" },
  { id: "sill_l", name: "Sill L" },
  { id: "sill_r", name: "Sill R" },
  { id: "roof", name: "Roof" },
  { id: "rear_quarter_l", name: "Rear quarter L" },
  { id: "rear_quarter_r", name: "Rear quarter R" },
  { id: "boot_lid", name: "Boot lid" },
] as const;
export type PanelId = (typeof PANELS)[number]["id"];
export const PANEL_NAME = Object.fromEntries(PANELS.map((p) => [p.id, p.name])) as Record<PanelId, string>;

export type Band = "thin" | "factory" | "refinished" | "filler_suspected";
export const BAND_LABEL: Record<Band, string> = {
  thin: "Thin",
  factory: "Factory",
  refinished: "Refinished",
  filler_suspected: "Filler suspected",
};
/** Published band ranges in whole µm: thin below 80, factory 80–180, refinished 181–300, filler above. */
export const BAND_LIMIT_UM = { thinBelow: 80, factoryUpTo: 180, refinishedUpTo: 300 } as const;

export type FlagCode = "battery_low" | "tyre_pressure";
export const FLAG_LABEL: Record<FlagCode, string> = { battery_low: "battery low", tyre_pressure: "tyre pressure off" };

export const HOUSE_NAME = "Marrow & Lark Motor House";
export const HOUSE_ACTOR = { id: "house", name: HOUSE_NAME } as const;

/** "<year> <make> <model>" — the car name the brief uses everywhere. */
export function carName(car: { year: number; make: string; model: string }): string {
  return `${car.year} ${car.make} ${car.model}`;
}
