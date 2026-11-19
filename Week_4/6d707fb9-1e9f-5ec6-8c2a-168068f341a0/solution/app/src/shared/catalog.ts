export const MEASURES = ["climate", "water", "fossilEnergy", "landUse", "freshwaterToxicity", "microfibres"] as const;
export type MeasureId = (typeof MEASURES)[number];

export const MEASURE_NAMES: Record<MeasureId, string> = {
  climate: "Climate",
  water: "Water",
  fossilEnergy: "Fossil energy",
  landUse: "Land use",
  freshwaterToxicity: "Freshwater toxicity",
  microfibres: "Microfibres",
};

export const MEASURE_UNITS: Record<MeasureId, string> = {
  climate: "kg CO₂e",
  water: "L",
  fossilEnergy: "MJ",
  landUse: "points",
  freshwaterToxicity: "CTUe",
  microfibres: "mg",
};

export const STAGES = ["materials", "making", "transport", "use", "endOfLife"] as const;
export type StageId = (typeof STAGES)[number];

export const STAGE_NAMES: Record<StageId, string> = {
  materials: "Materials",
  making: "Making",
  transport: "Transport",
  use: "Use",
  endOfLife: "End of life",
};

export const MATERIALS = [
  { id: "organic-cotton", name: "Organic cotton" },
  { id: "cotton", name: "Cotton" },
  { id: "recycled-cotton", name: "Recycled cotton" },
  { id: "linen", name: "Linen" },
  { id: "wool", name: "Wool" },
  { id: "recycled-wool", name: "Recycled wool" },
  { id: "polyester", name: "Polyester" },
  { id: "recycled-polyester", name: "Recycled polyester" },
  { id: "viscose", name: "Viscose" },
  { id: "lyocell", name: "Lyocell" },
  { id: "nylon", name: "Nylon" },
  { id: "elastane", name: "Elastane" },
] as const;

export function materialName(id: string): string {
  return MATERIALS.find((material) => material.id === id)?.name ?? id;
}

export const COUNTRIES = [
  { id: "PT", name: "Portugal" },
  { id: "TR", name: "Turkey" },
  { id: "VN", name: "Vietnam" },
  { id: "EG", name: "Egypt" },
  { id: "IN", name: "India" },
  { id: "BD", name: "Bangladesh" },
] as const;

export function countryName(id: string): string {
  return COUNTRIES.find((country) => country.id === id)?.name ?? id;
}

export const MODES = [
  { id: "sea", name: "Sea" },
  { id: "road", name: "Road" },
  { id: "rail", name: "Rail" },
  { id: "air", name: "Air" },
] as const;

export function modeName(id: string): string {
  return MODES.find((mode) => mode.id === id)?.name ?? id;
}

export const GARMENTS = [
  { id: "tshirt", name: "T-shirt" },
  { id: "shirt", name: "Shirt" },
  { id: "jeans", name: "Jeans" },
  { id: "coat", name: "Coat" },
] as const;

export const TOWNS = [
  { id: "porto", name: "Porto", zone: "Europe/Lisbon" },
  { id: "izmir", name: "Izmir", zone: "Europe/Istanbul" },
  { id: "hoChiMinhCity", name: "Ho Chi Minh City", zone: "Asia/Ho_Chi_Minh" },
  { id: "cairo", name: "Cairo", zone: "Africa/Cairo" },
] as const;

export function townName(id: string): string {
  return TOWNS.find((town) => town.id === id)?.name ?? id;
}

export function townZone(id: string): string {
  return TOWNS.find((town) => town.id === id)?.zone ?? "Europe/Lisbon";
}

export const LANGUAGES = [
  { id: "en", name: "English" },
  { id: "fr", name: "French" },
  { id: "tr", name: "Turkish" },
  { id: "ar", name: "Arabic" },
] as const;
export type Language = (typeof LANGUAGES)[number]["id"];

export const READING_UNITS = [
  { id: "kWh", name: "kWh" },
  { id: "MJ", name: "MJ" },
  { id: "m3", name: "m³ of natural gas" },
] as const;

export const LABEL_STRIP = [
  "Maré Alta",
  "Linho & Sal",
  "Atelier Noroeste",
  "Kade Studio",
  "Fio Norte",
  "Serra Knit",
  "Douro Denim",
  "Cais Workwear",
];
