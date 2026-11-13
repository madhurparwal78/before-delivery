// The practice's published catalogs: states, markers, unit factors, ingredients, staff and starting ranges.

import type { AgeBand, RangeRow, Sex } from "../shared/api";

export const US_STATES: readonly { code: string; name: string }[] = [
  ["al", "Alabama"], ["ak", "Alaska"], ["az", "Arizona"], ["ar", "Arkansas"], ["ca", "California"],
  ["co", "Colorado"], ["ct", "Connecticut"], ["de", "Delaware"], ["fl", "Florida"], ["ga", "Georgia"],
  ["hi", "Hawaii"], ["id", "Idaho"], ["il", "Illinois"], ["in", "Indiana"], ["ia", "Iowa"],
  ["ks", "Kansas"], ["ky", "Kentucky"], ["la", "Louisiana"], ["me", "Maine"], ["md", "Maryland"],
  ["ma", "Massachusetts"], ["mi", "Michigan"], ["mn", "Minnesota"], ["ms", "Mississippi"], ["mo", "Missouri"],
  ["mt", "Montana"], ["ne", "Nebraska"], ["nv", "Nevada"], ["nh", "New Hampshire"], ["nj", "New Jersey"],
  ["nm", "New Mexico"], ["ny", "New York"], ["nc", "North Carolina"], ["nd", "North Dakota"], ["oh", "Ohio"],
  ["ok", "Oklahoma"], ["or", "Oregon"], ["pa", "Pennsylvania"], ["ri", "Rhode Island"], ["sc", "South Carolina"],
  ["sd", "South Dakota"], ["tn", "Tennessee"], ["tx", "Texas"], ["ut", "Utah"], ["vt", "Vermont"],
  ["va", "Virginia"], ["wa", "Washington"], ["wv", "West Virginia"], ["wi", "Wisconsin"], ["wy", "Wyoming"],
].map(([code = "", name = ""]) => ({ code, name }));

const NOT_SERVED = new Set(["ak", "hi", "ri"]);

export const isServed = (code: string): boolean => !NOT_SERVED.has(code);

export function stateName(code: string): string {
  return US_STATES.find((state) => state.code === code)?.name ?? code;
}

export function stateCheckCopy(code: string): string {
  const name = stateName(code);
  return isServed(code) ? `Yes — we serve members in ${name}.` : `Not yet — we can't serve members in ${name}.`;
}

interface UnitStep {
  unit: string;
  step: "times" | "dividedBy";
  factor: string;
}

export interface Marker {
  id: string;
  name: string;
  category: string;
  unit: string;
  decimals: number;
  units: UnitStep[];
  aliases: string[];
}

export const CATEGORIES: readonly { id: string; name: string }[] = [
  { id: "metabolic", name: "Metabolic" },
  { id: "heart", name: "Heart" },
  { id: "hormones", name: "Hormones" },
  { id: "kidneyLiver", name: "Kidney and liver" },
  { id: "nutrients", name: "Nutrients" },
  { id: "inflammationBlood", name: "Inflammation and blood" },
];

const same = (unit: string): UnitStep => ({ unit, step: "times", factor: "1" });
const timesBy = (unit: string, factor: string): UnitStep => ({ unit, step: "times", factor });
const divBy = (unit: string, factor: string): UnitStep => ({ unit, step: "dividedBy", factor });

function marker(
  category: string, id: string, name: string, unit: string, decimals: number, units: UnitStep[], aliases: string[],
): Marker {
  return { id, name, category, unit, decimals, units, aliases };
}

export const MARKERS: readonly Marker[] = [
  marker("metabolic", "glucose", "Fasting glucose", "mg/dL", 0, [same("mg/dL"), timesBy("mmol/L", "18.016")], ["Glucose", "GLU", "Fasting glucose", "Glucose fasting"]),
  marker("metabolic", "hba1c", "HbA1c", "%", 1, [same("%")], ["Hemoglobin A1c", "A1C", "HbA1c", "Glycated hemoglobin"]),
  marker("metabolic", "insulin", "Fasting insulin", "µIU/mL", 1, [same("µIU/mL"), same("mIU/L"), divBy("pmol/L", "6.945")], ["Insulin", "Insulin fasting"]),
  marker("heart", "ldl", "LDL", "mg/dL", 0, [same("mg/dL"), timesBy("mmol/L", "38.67")], ["LDL-C", "LDL cholesterol", "LDL Chol Calc"]),
  marker("heart", "hdl", "HDL", "mg/dL", 0, [same("mg/dL"), timesBy("mmol/L", "38.67")], ["HDL-C", "HDL cholesterol"]),
  marker("heart", "triglycerides", "Triglycerides", "mg/dL", 0, [same("mg/dL"), timesBy("mmol/L", "88.57")], ["TG", "Trig", "Triglyceride"]),
  marker("heart", "apoB", "ApoB", "mg/dL", 0, [same("mg/dL"), timesBy("g/L", "100")], ["Apolipoprotein B", "Apo B", "APOB-100"]),
  marker("hormones", "tsh", "TSH", "mIU/L", 2, [same("mIU/L"), same("µIU/mL")], ["Thyroid stimulating hormone", "Thyrotropin"]),
  marker("hormones", "testosterone", "Total testosterone", "ng/dL", 0, [same("ng/dL"), timesBy("nmol/L", "28.84")], ["Testosterone", "Testosterone total", "TT"]),
  marker("hormones", "estradiol", "Estradiol", "pg/mL", 0, [same("pg/mL"), divBy("pmol/L", "3.671")], ["E2", "Oestradiol", "Estradiol sensitive"]),
  marker("kidneyLiver", "creatinine", "Creatinine", "mg/dL", 2, [same("mg/dL"), divBy("µmol/L", "88.42")], ["Creat", "Serum creatinine"]),
  marker("kidneyLiver", "egfr", "eGFR", "mL/min/1.73m²", 0, [same("mL/min/1.73m²")], ["GFR estimated", "eGFR CKD-EPI"]),
  marker("kidneyLiver", "alt", "ALT", "U/L", 0, [same("U/L")], ["SGPT", "Alanine aminotransferase", "ALT/SGPT"]),
  marker("nutrients", "vitaminD", "Vitamin D", "ng/mL", 1, [same("ng/mL"), divBy("nmol/L", "2.5")], ["Vit D, 25-OH", "25(OH) Vitamin D", "25-Hydroxyvitamin D", "Vitamin D 25-OH"]),
  marker("nutrients", "ferritin", "Ferritin", "ng/mL", 0, [same("ng/mL"), same("µg/L")], ["Serum ferritin", "FERR"]),
  marker("nutrients", "vitaminB12", "Vitamin B12", "pg/mL", 0, [same("pg/mL"), timesBy("pmol/L", "1.355")], ["B12", "Cobalamin", "Vit B12"]),
  marker("nutrients", "magnesiumRbc", "RBC magnesium", "mg/dL", 1, [same("mg/dL")], ["Magnesium RBC", "Mg RBC", "Red cell magnesium"]),
  marker("inflammationBlood", "hsCrp", "hs-CRP", "mg/L", 2, [same("mg/L"), timesBy("mg/dL", "10")], ["CRP high sensitivity", "hsCRP", "C-reactive protein hs"]),
  marker("inflammationBlood", "homocysteine", "Homocysteine", "µmol/L", 1, [same("µmol/L")], ["Hcy", "Homocyst(e)ine"]),
  marker("inflammationBlood", "hemoglobin", "Hemoglobin", "g/dL", 1, [same("g/dL"), divBy("g/L", "10")], ["Hgb", "Hb", "Haemoglobin"]),
];

export function markerById(id: string): Marker | undefined {
  return MARKERS.find((entry) => entry.id === id);
}

// Lower-cased with every character that is not a letter or digit dropped.
export function squeezeName(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function markerMatching(written: string): Marker | undefined {
  const wanted = squeezeName(written);
  return MARKERS.find((entry) => [entry.name, ...entry.aliases].some((name) => squeezeName(name) === wanted));
}

export const AGE_BANDS: readonly AgeBand[] = ["age18To39", "age40To59", "age60Plus"];
export const SEXES: readonly Sex[] = ["female", "male"];

// One bound set as `low high optimalLow optimalHigh`.
type Bounds = readonly [string, string, string, string];
type BoundsFor = (sex: Sex, band: AgeBand) => Bounds;

const everyone = (bounds: Bounds): BoundsFor => () => bounds;
const bySex = (female: Bounds, male: Bounds): BoundsFor => (sex) => (sex === "female" ? female : male);

export const STARTING_BOUNDS: Readonly<Record<string, BoundsFor>> = {
  glucose: everyone(["70", "99", "75", "90"]),
  hba1c: everyone(["4.0", "5.6", "4.6", "5.3"]),
  insulin: everyone(["2.0", "19.6", "2.0", "8.0"]),
  ldl: everyone(["40", "129", "40", "99"]),
  hdl: bySex(["50", "100", "60", "90"], ["40", "100", "50", "90"]),
  triglycerides: everyone(["30", "149", "30", "99"]),
  apoB: everyone(["40", "99", "40", "79"]),
  tsh: everyone(["0.45", "4.50", "1.00", "2.50"]),
  testosterone: (sex, band) => {
    if (sex === "female") return ["15", "70", "25", "60"];
    if (band === "age18To39") return ["300", "1000", "500", "900"];
    return band === "age40To59" ? ["300", "950", "450", "850"] : ["250", "900", "400", "800"];
  },
  estradiol: (sex, band) => {
    if (sex === "male") return ["10", "40", "20", "35"];
    if (band === "age18To39") return ["30", "400", "50", "250"];
    return band === "age40To59" ? ["10", "350", "30", "200"] : ["0", "30", "0", "20"];
  },
  creatinine: bySex(["0.50", "1.00", "0.60", "0.90"], ["0.70", "1.30", "0.80", "1.10"]),
  egfr: (_sex, band) => {
    if (band === "age18To39") return ["90", "150", "100", "130"];
    return band === "age40To59" ? ["75", "150", "90", "120"] : ["60", "150", "75", "110"];
  },
  alt: bySex(["7", "33", "10", "25"], ["7", "40", "10", "30"]),
  vitaminD: everyone(["30.0", "100.0", "40.0", "60.0"]),
  ferritin: bySex(["15", "150", "40", "120"], ["30", "400", "50", "200"]),
  vitaminB12: everyone(["232", "1245", "500", "1000"]),
  magnesiumRbc: everyone(["4.2", "6.8", "5.5", "6.5"]),
  hsCrp: everyone(["0.00", "3.00", "0.00", "1.00"]),
  homocysteine: everyone(["4.0", "15.0", "4.0", "9.0"]),
  hemoglobin: bySex(["12.0", "15.5", "13.0", "14.5"], ["13.5", "17.5", "14.0", "16.0"]),
};

export function sixRows(boundsFor: BoundsFor): RangeRow[] {
  return SEXES.flatMap((sex) =>
    AGE_BANDS.map((ageBand) => {
      const [low, high, optimalLow, optimalHigh] = boundsFor(sex, ageBand);
      return { sex, ageBand, low, high, optimalLow, optimalHigh };
    }),
  );
}

export const SEEDED_LDL_CHANGE: BoundsFor = everyone(["40", "115", "40", "89"]);

export const PRACTICE = {
  name: "Ocotillo Longevity Club",
  address: "8820 E Desert Willow Way, Suite 140, Scottsdale, AZ 85258",
  taxNumber: "86-4172093",
};
