/** Published domain constants. */

export const MEASURE_IDS = ["climate", "water", "fossilEnergy", "landUse", "freshwaterToxicity", "microfibres"] as const;
export type MeasureId = (typeof MEASURE_IDS)[number];

export const MEASURE_UNITS: Record<MeasureId, string> = {
  climate: "kg CO\u2082e",
  water: "L",
  fossilEnergy: "MJ",
  landUse: "points",
  freshwaterToxicity: "CTUe",
  microfibres: "mg",
};

export const MEASURE_LABELS: Record<MeasureId, string> = {
  climate: "Climate",
  water: "Water",
  fossilEnergy: "Fossil energy",
  landUse: "Land use",
  freshwaterToxicity: "Freshwater toxicity",
  microfibres: "Microfibres",
};

export const STAGE_IDS = ["materials", "making", "transport", "use", "endOfLife"] as const;
export type StageId = (typeof STAGE_IDS)[number];

export const STAGE_LABELS: Record<StageId, string> = {
  materials: "Materials",
  making: "Making",
  transport: "Transport",
  use: "Use",
  endOfLife: "End of life",
};

export const MEASURE_FIELD: Record<MeasureId, string> = {
  climate: "climate",
  water: "water",
  fossilEnergy: "fossil",
  landUse: "land",
  freshwaterToxicity: "toxicity",
  microfibres: "microfibres",
};

export interface MaterialDef {
  id: string;
  name: string;
}

/** The twelve material ids and names the app holds itself for the Add material search. */
export const MATERIALS: MaterialDef[] = [
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
];

export const COUNTRIES = ["PT", "TR", "VN", "EG", "IN", "BD"] as const;
export type CountryCode = (typeof COUNTRIES)[number];

export const COUNTRY_NAMES_EN: Record<CountryCode, string> = {
  PT: "Portugal",
  TR: "Turkey",
  VN: "Vietnam",
  EG: "Egypt",
  IN: "India",
  BD: "Bangladesh",
};

export const MODES = ["sea", "road", "rail", "air"] as const;
export type ModeId = (typeof MODES)[number];

export const MODE_NAMES: Record<ModeId, string> = {
  sea: "Sea",
  road: "Road",
  rail: "Rail",
  air: "Air",
};

export const GARMENTS = ["tshirt", "shirt", "jeans", "coat"] as const;
export type GarmentId = (typeof GARMENTS)[number];

export const GARMENT_NAMES: Record<GarmentId, string> = {
  tshirt: "T-shirt",
  shirt: "Shirt",
  jeans: "Jeans",
  coat: "Coat",
};

/** Try one garment tables. No library call. */
export const ESTIMATE_GARMENT_KG: Record<GarmentId, string> = {
  tshirt: "0.25",
  shirt: "0.30",
  jeans: "0.80",
  coat: "1.20",
};

export const ESTIMATE_FIBRES: Record<string, string> = {
  "organic-cotton": "3.10",
  cotton: "4.15",
  polyester: "3.24",
  wool: "14.6",
};

export const ESTIMATE_COUNTRIES: Record<string, string> = {
  PT: "0.92",
  TR: "1.35",
  VN: "2.10",
  EG: "1.74",
};

export const TOWN_IDS = ["porto", "izmir", "hoChiMinhCity", "cairo"] as const;
export type Town = (typeof TOWN_IDS)[number];

export const LANG_IDS = ["en", "fr", "tr", "ar"] as const;

export const QUALITY_GRADES: { minPercent: number; grade: string }[] = [
  { minPercent: 80, grade: "A" },
  { minPercent: 50, grade: "B" },
  { minPercent: 0, grade: "C" },
];

export const QUALITY_COPY: Record<string, string> = { A: "A", B: "B", C: "C" };

export const STALE_SOURCE = { answer: "answer", elsewhere: "elsewhere" } as const;
