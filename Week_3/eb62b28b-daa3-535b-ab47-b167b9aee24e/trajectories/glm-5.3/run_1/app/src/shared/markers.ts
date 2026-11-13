import type { AgeBandKey, MarkerSex } from "./enums.js";

export type MarkerCategory = {
  id: string;
  name: string;
};

export type MarkerDef = {
  id: string;
  categoryId: string;
  name: string;
  unit: string;
  decimals: number;
  aliases: string[];
  labUnits: { unit: string; factor: string; divide: boolean }[];
  catalogOrder: number;
};

export type RangeRowDef = {
  sex: MarkerSex;
  ageBand: AgeBandKey;
  low: string;
  high: string;
  optimalLow: string;
  optimalHigh: string;
};

export const CATEGORIES: MarkerCategory[] = [
  { id: "metabolic", name: "Metabolic" },
  { id: "heart", name: "Heart" },
  { id: "hormones", name: "Hormones" },
  { id: "kidneyLiver", name: "Kidney and liver" },
  { id: "nutrients", name: "Nutrients" },
  { id: "inflammationBlood", name: "Inflammation and blood" },
];

const u = (unit: string, factor: string, divide = false): { unit: string; factor: string; divide: boolean } => ({
  unit,
  factor,
  divide,
});

export const MARKERS: MarkerDef[] = [
  {
    id: "glucose",
    categoryId: "metabolic",
    name: "Fasting glucose",
    unit: "mg/dL",
    decimals: 0,
    aliases: ["Glucose", "GLU", "Fasting glucose", "Glucose fasting"],
    labUnits: [u("mg/dL", "1"), u("mmol/L", "18.016")],
    catalogOrder: 1,
  },
  {
    id: "hba1c",
    categoryId: "metabolic",
    name: "HbA1c",
    unit: "%",
    decimals: 1,
    aliases: ["Hemoglobin A1c", "A1C", "HbA1c", "Glycated hemoglobin"],
    labUnits: [u("%", "1")],
    catalogOrder: 2,
  },
  {
    id: "insulin",
    categoryId: "metabolic",
    name: "Fasting insulin",
    unit: "µIU/mL",
    decimals: 1,
    aliases: ["Insulin", "Insulin fasting"],
    labUnits: [u("µIU/mL", "1"), u("mIU/L", "1"), u("pmol/L", "6.945", true)],
    catalogOrder: 3,
  },
  {
    id: "ldl",
    categoryId: "heart",
    name: "LDL",
    unit: "mg/dL",
    decimals: 0,
    aliases: ["LDL-C", "LDL cholesterol", "LDL Chol Calc"],
    labUnits: [u("mg/dL", "1"), u("mmol/L", "38.67")],
    catalogOrder: 4,
  },
  {
    id: "hdl",
    categoryId: "heart",
    name: "HDL",
    unit: "mg/dL",
    decimals: 0,
    aliases: ["HDL-C", "HDL cholesterol"],
    labUnits: [u("mg/dL", "1"), u("mmol/L", "38.67")],
    catalogOrder: 5,
  },
  {
    id: "triglycerides",
    categoryId: "heart",
    name: "Triglycerides",
    unit: "mg/dL",
    decimals: 0,
    aliases: ["TG", "Trig", "Triglyceride"],
    labUnits: [u("mg/dL", "1"), u("mmol/L", "88.57")],
    catalogOrder: 6,
  },
  {
    id: "apoB",
    categoryId: "heart",
    name: "ApoB",
    unit: "mg/dL",
    decimals: 0,
    aliases: ["Apolipoprotein B", "Apo B", "APOB-100"],
    labUnits: [u("mg/dL", "1"), u("g/L", "100")],
    catalogOrder: 7,
  },
  {
    id: "tsh",
    categoryId: "hormones",
    name: "TSH",
    unit: "mIU/L",
    decimals: 2,
    aliases: ["Thyroid stimulating hormone", "Thyrotropin"],
    labUnits: [u("mIU/L", "1"), u("µIU/mL", "1")],
    catalogOrder: 8,
  },
  {
    id: "testosterone",
    categoryId: "hormones",
    name: "Total testosterone",
    unit: "ng/dL",
    decimals: 0,
    aliases: ["Testosterone", "Testosterone total", "TT"],
    labUnits: [u("ng/dL", "1"), u("nmol/L", "28.84")],
    catalogOrder: 9,
  },
  {
    id: "estradiol",
    categoryId: "hormones",
    name: "Estradiol",
    unit: "pg/mL",
    decimals: 0,
    aliases: ["E2", "Oestradiol", "Estradiol sensitive"],
    labUnits: [u("pg/mL", "1"), u("pmol/L", "3.671", true)],
    catalogOrder: 10,
  },
  {
    id: "creatinine",
    categoryId: "kidneyLiver",
    name: "Creatinine",
    unit: "mg/dL",
    decimals: 2,
    aliases: ["Creat", "Serum creatinine"],
    labUnits: [u("mg/dL", "1"), u("µmol/L", "88.42", true)],
    catalogOrder: 11,
  },
  {
    id: "egfr",
    categoryId: "kidneyLiver",
    name: "eGFR",
    unit: "mL/min/1.73m²",
    decimals: 0,
    aliases: ["GFR estimated", "eGFR CKD-EPI"],
    labUnits: [u("mL/min/1.73m²", "1")],
    catalogOrder: 12,
  },
  {
    id: "alt",
    categoryId: "kidneyLiver",
    name: "ALT",
    unit: "U/L",
    decimals: 0,
    aliases: ["SGPT", "Alanine aminotransferase", "ALT/SGPT"],
    labUnits: [u("U/L", "1")],
    catalogOrder: 13,
  },
  {
    id: "vitaminD",
    categoryId: "nutrients",
    name: "Vitamin D",
    unit: "ng/mL",
    decimals: 1,
    aliases: ["Vit D, 25-OH", "25(OH) Vitamin D", "25-Hydroxyvitamin D", "Vitamin D 25-OH"],
    labUnits: [u("ng/mL", "1"), u("nmol/L", "2.5", true)],
    catalogOrder: 14,
  },
  {
    id: "ferritin",
    categoryId: "nutrients",
    name: "Ferritin",
    unit: "ng/mL",
    decimals: 0,
    aliases: ["Serum ferritin", "FERR"],
    labUnits: [u("ng/mL", "1"), u("µg/L", "1")],
    catalogOrder: 15,
  },
  {
    id: "vitaminB12",
    categoryId: "nutrients",
    name: "Vitamin B12",
    unit: "pg/mL",
    decimals: 0,
    aliases: ["B12", "Cobalamin", "Vit B12"],
    labUnits: [u("pg/mL", "1"), u("pmol/L", "1.355")],
    catalogOrder: 16,
  },
  {
    id: "magnesiumRbc",
    categoryId: "nutrients",
    name: "RBC magnesium",
    unit: "mg/dL",
    decimals: 1,
    aliases: ["Magnesium RBC", "Mg RBC", "Red cell magnesium"],
    labUnits: [u("mg/dL", "1")],
    catalogOrder: 17,
  },
  {
    id: "hsCrp",
    categoryId: "inflammationBlood",
    name: "hs-CRP",
    unit: "mg/L",
    decimals: 2,
    aliases: ["CRP high sensitivity", "hsCRP", "C-reactive protein hs"],
    labUnits: [u("mg/L", "1"), u("mg/dL", "10")],
    catalogOrder: 18,
  },
  {
    id: "homocysteine",
    categoryId: "inflammationBlood",
    name: "Homocysteine",
    unit: "µmol/L",
    decimals: 1,
    aliases: ["Hcy", "Homocyst(e)ine"],
    labUnits: [u("µmol/L", "1")],
    catalogOrder: 19,
  },
  {
    id: "hemoglobin",
    categoryId: "inflammationBlood",
    name: "Hemoglobin",
    unit: "g/dL",
    decimals: 1,
    aliases: ["Hgb", "Hb", "Haemoglobin"],
    labUnits: [u("g/dL", "1"), u("g/L", "10", true)],
    catalogOrder: 20,
  },
];

export const MARKER_BY_ID: Map<string, MarkerDef> = new Map(MARKERS.map((m) => [m.id, m]));

export function markerByUnitLabKey(unit: string, marker: MarkerDef): { unit: string; factor: string; divide: boolean } | undefined {
  const target = unit.replace(/µ/gi, "u").toLowerCase();
  return marker.labUnits.find((lab) => lab.unit.replace(/µ/gi, "u").toLowerCase() === target);
}

/** Canonical alias match key: lower-case, letters and digits only. */
export function aliasKey(text: string): string {
  return text
    .toLowerCase()
    .split("")
    .filter((c) => /[a-z0-9]/.test(c))
    .join("");
}

/** Match a lab-reported marker name to the catalog. */
export function matchMarkerByName(name: string): MarkerDef | undefined {
  const key = aliasKey(name);
  return MARKERS.find((m) => aliasKey(m.name) === key || m.aliases.some((a) => aliasKey(a) === key));
}
