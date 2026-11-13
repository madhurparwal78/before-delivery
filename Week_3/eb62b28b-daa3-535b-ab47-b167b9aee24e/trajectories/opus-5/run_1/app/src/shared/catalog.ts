export type CategoryId =
  | 'metabolic'
  | 'heart'
  | 'hormones'
  | 'kidneyLiver'
  | 'nutrients'
  | 'inflammationBlood';

export interface UnitConversion {
  /** The lab unit as published, with `µ` where the lab writes a micro sign. */
  unit: string;
  /** `multiply` or `divide` by the factor to reach the practice unit. */
  step: 'multiply' | 'divide';
  factor: string;
}

export interface MarkerDefinition {
  id: string;
  name: string;
  category: CategoryId;
  unit: string;
  decimals: number;
  units: UnitConversion[];
  aliases: string[];
}

export const CATEGORIES: { id: CategoryId; name: string }[] = [
  { id: 'metabolic', name: 'Metabolic' },
  { id: 'heart', name: 'Heart' },
  { id: 'hormones', name: 'Hormones' },
  { id: 'kidneyLiver', name: 'Kidney and liver' },
  { id: 'nutrients', name: 'Nutrients' },
  { id: 'inflammationBlood', name: 'Inflammation and blood' },
];

export const MARKERS: MarkerDefinition[] = [
  {
    id: 'glucose',
    name: 'Fasting glucose',
    category: 'metabolic',
    unit: 'mg/dL',
    decimals: 0,
    units: [
      { unit: 'mg/dL', step: 'multiply', factor: '1' },
      { unit: 'mmol/L', step: 'multiply', factor: '18.016' },
    ],
    aliases: ['Glucose', 'GLU', 'Fasting glucose', 'Glucose fasting'],
  },
  {
    id: 'hba1c',
    name: 'HbA1c',
    category: 'metabolic',
    unit: '%',
    decimals: 1,
    units: [{ unit: '%', step: 'multiply', factor: '1' }],
    aliases: ['Hemoglobin A1c', 'A1C', 'HbA1c', 'Glycated hemoglobin'],
  },
  {
    id: 'insulin',
    name: 'Fasting insulin',
    category: 'metabolic',
    unit: 'µIU/mL',
    decimals: 1,
    units: [
      { unit: 'µIU/mL', step: 'multiply', factor: '1' },
      { unit: 'mIU/L', step: 'multiply', factor: '1' },
      { unit: 'pmol/L', step: 'divide', factor: '6.945' },
    ],
    aliases: ['Insulin', 'Insulin fasting'],
  },
  {
    id: 'ldl',
    name: 'LDL',
    category: 'heart',
    unit: 'mg/dL',
    decimals: 0,
    units: [
      { unit: 'mg/dL', step: 'multiply', factor: '1' },
      { unit: 'mmol/L', step: 'multiply', factor: '38.67' },
    ],
    aliases: ['LDL-C', 'LDL cholesterol', 'LDL Chol Calc'],
  },
  {
    id: 'hdl',
    name: 'HDL',
    category: 'heart',
    unit: 'mg/dL',
    decimals: 0,
    units: [
      { unit: 'mg/dL', step: 'multiply', factor: '1' },
      { unit: 'mmol/L', step: 'multiply', factor: '38.67' },
    ],
    aliases: ['HDL-C', 'HDL cholesterol'],
  },
  {
    id: 'triglycerides',
    name: 'Triglycerides',
    category: 'heart',
    unit: 'mg/dL',
    decimals: 0,
    units: [
      { unit: 'mg/dL', step: 'multiply', factor: '1' },
      { unit: 'mmol/L', step: 'multiply', factor: '88.57' },
    ],
    aliases: ['TG', 'Trig', 'Triglyceride'],
  },
  {
    id: 'apoB',
    name: 'ApoB',
    category: 'heart',
    unit: 'mg/dL',
    decimals: 0,
    units: [
      { unit: 'mg/dL', step: 'multiply', factor: '1' },
      { unit: 'g/L', step: 'multiply', factor: '100' },
    ],
    aliases: ['Apolipoprotein B', 'Apo B', 'APOB-100'],
  },
  {
    id: 'tsh',
    name: 'TSH',
    category: 'hormones',
    unit: 'mIU/L',
    decimals: 2,
    units: [
      { unit: 'mIU/L', step: 'multiply', factor: '1' },
      { unit: 'µIU/mL', step: 'multiply', factor: '1' },
    ],
    aliases: ['Thyroid stimulating hormone', 'Thyrotropin'],
  },
  {
    id: 'testosterone',
    name: 'Total testosterone',
    category: 'hormones',
    unit: 'ng/dL',
    decimals: 0,
    units: [
      { unit: 'ng/dL', step: 'multiply', factor: '1' },
      { unit: 'nmol/L', step: 'multiply', factor: '28.84' },
    ],
    aliases: ['Testosterone', 'Testosterone total', 'TT'],
  },
  {
    id: 'estradiol',
    name: 'Estradiol',
    category: 'hormones',
    unit: 'pg/mL',
    decimals: 0,
    units: [
      { unit: 'pg/mL', step: 'multiply', factor: '1' },
      { unit: 'pmol/L', step: 'divide', factor: '3.671' },
    ],
    aliases: ['E2', 'Oestradiol', 'Estradiol sensitive'],
  },
  {
    id: 'creatinine',
    name: 'Creatinine',
    category: 'kidneyLiver',
    unit: 'mg/dL',
    decimals: 2,
    units: [
      { unit: 'mg/dL', step: 'multiply', factor: '1' },
      { unit: 'µmol/L', step: 'divide', factor: '88.42' },
    ],
    aliases: ['Creat', 'Serum creatinine'],
  },
  {
    id: 'egfr',
    name: 'eGFR',
    category: 'kidneyLiver',
    unit: 'mL/min/1.73m²',
    decimals: 0,
    units: [{ unit: 'mL/min/1.73m²', step: 'multiply', factor: '1' }],
    aliases: ['GFR estimated', 'eGFR CKD-EPI'],
  },
  {
    id: 'alt',
    name: 'ALT',
    category: 'kidneyLiver',
    unit: 'U/L',
    decimals: 0,
    units: [{ unit: 'U/L', step: 'multiply', factor: '1' }],
    aliases: ['SGPT', 'Alanine aminotransferase', 'ALT/SGPT'],
  },
  {
    id: 'vitaminD',
    name: 'Vitamin D',
    category: 'nutrients',
    unit: 'ng/mL',
    decimals: 1,
    units: [
      { unit: 'ng/mL', step: 'multiply', factor: '1' },
      { unit: 'nmol/L', step: 'divide', factor: '2.5' },
    ],
    aliases: ['Vit D, 25-OH', '25(OH) Vitamin D', '25-Hydroxyvitamin D', 'Vitamin D 25-OH'],
  },
  {
    id: 'ferritin',
    name: 'Ferritin',
    category: 'nutrients',
    unit: 'ng/mL',
    decimals: 0,
    units: [
      { unit: 'ng/mL', step: 'multiply', factor: '1' },
      { unit: 'µg/L', step: 'multiply', factor: '1' },
    ],
    aliases: ['Serum ferritin', 'FERR'],
  },
  {
    id: 'vitaminB12',
    name: 'Vitamin B12',
    category: 'nutrients',
    unit: 'pg/mL',
    decimals: 0,
    units: [
      { unit: 'pg/mL', step: 'multiply', factor: '1' },
      { unit: 'pmol/L', step: 'multiply', factor: '1.355' },
    ],
    aliases: ['B12', 'Cobalamin', 'Vit B12'],
  },
  {
    id: 'magnesiumRbc',
    name: 'RBC magnesium',
    category: 'nutrients',
    unit: 'mg/dL',
    decimals: 1,
    units: [{ unit: 'mg/dL', step: 'multiply', factor: '1' }],
    aliases: ['Magnesium RBC', 'Mg RBC', 'Red cell magnesium'],
  },
  {
    id: 'hsCrp',
    name: 'hs-CRP',
    category: 'inflammationBlood',
    unit: 'mg/L',
    decimals: 2,
    units: [
      { unit: 'mg/L', step: 'multiply', factor: '1' },
      { unit: 'mg/dL', step: 'multiply', factor: '10' },
    ],
    aliases: ['CRP high sensitivity', 'hsCRP', 'C-reactive protein hs'],
  },
  {
    id: 'homocysteine',
    name: 'Homocysteine',
    category: 'inflammationBlood',
    unit: 'µmol/L',
    decimals: 1,
    units: [{ unit: 'µmol/L', step: 'multiply', factor: '1' }],
    aliases: ['Hcy', 'Homocyst(e)ine'],
  },
  {
    id: 'hemoglobin',
    name: 'Hemoglobin',
    category: 'inflammationBlood',
    unit: 'g/dL',
    decimals: 1,
    units: [
      { unit: 'g/dL', step: 'multiply', factor: '1' },
      { unit: 'g/L', step: 'divide', factor: '10' },
    ],
    aliases: ['Hgb', 'Hb', 'Haemoglobin'],
  },
];

export const MARKERS_BY_ID = new Map(MARKERS.map((marker) => [marker.id, marker]));

export function markerById(id: string): MarkerDefinition | undefined {
  return MARKERS_BY_ID.get(id);
}

/** Lower-cases and drops every character that is not a letter or digit. */
export function matchKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function markerByLabName(labName: string): MarkerDefinition | undefined {
  const key = matchKey(labName);
  if (key === '') return undefined;
  return MARKERS.find(
    (marker) =>
      matchKey(marker.name) === key || marker.aliases.some((alias) => matchKey(alias) === key),
  );
}

/** Matches a search text against display names and aliases. */
export function markerMatchesSearch(marker: MarkerDefinition, search: string): boolean {
  const key = matchKey(search);
  if (key === '') return true;
  if (matchKey(marker.name).includes(key)) return true;
  return marker.aliases.some((alias) => matchKey(alias).includes(key));
}

/** Units match ignoring case, and `u` stands for `µ`. */
export function unitKey(unit: string): string {
  return unit.toLowerCase().replace(/µ/g, 'u').replace(/\s/g, '');
}

export function conversionFor(
  marker: MarkerDefinition,
  labUnit: string,
): UnitConversion | undefined {
  const key = unitKey(labUnit);
  return marker.units.find((conversion) => unitKey(conversion.unit) === key);
}

export type PacketTime = 'morning' | 'evening' | 'split';

export interface IngredientDefinition {
  id: string;
  name: string;
  strength: { amount: string; unit: string; mcg?: string };
  time: PacketTime;
  priceCentsPerCapsule: number;
}

export const INGREDIENTS: IngredientDefinition[] = [
  {
    id: 'vitaminD3',
    name: 'Vitamin D3',
    strength: { amount: '5000', unit: 'IU', mcg: '125' },
    time: 'morning',
    priceCentsPerCapsule: 9,
  },
  {
    id: 'vitaminD3Small',
    name: 'Vitamin D3 low dose',
    strength: { amount: '1000', unit: 'IU', mcg: '25' },
    time: 'morning',
    priceCentsPerCapsule: 6,
  },
  {
    id: 'magnesiumGlycinate',
    name: 'Magnesium glycinate',
    strength: { amount: '200', unit: 'mg' },
    time: 'evening',
    priceCentsPerCapsule: 12,
  },
  {
    id: 'omega3',
    name: 'Omega-3',
    strength: { amount: '1000', unit: 'mg' },
    time: 'split',
    priceCentsPerCapsule: 18,
  },
  {
    id: 'methylB12',
    name: 'Methyl B12',
    strength: { amount: '1000', unit: 'mcg' },
    time: 'morning',
    priceCentsPerCapsule: 15,
  },
  {
    id: 'ashwagandha',
    name: 'Ashwagandha',
    strength: { amount: '300', unit: 'mg' },
    time: 'evening',
    priceCentsPerCapsule: 15,
  },
  {
    id: 'vitaminK2',
    name: 'Vitamin K2 (MK-7)',
    strength: { amount: '100', unit: 'mcg' },
    time: 'morning',
    priceCentsPerCapsule: 11,
  },
  {
    id: 'zincPicolinate',
    name: 'Zinc picolinate',
    strength: { amount: '15', unit: 'mg' },
    time: 'evening',
    priceCentsPerCapsule: 8,
  },
  {
    id: 'creatine',
    name: 'Creatine monohydrate',
    strength: { amount: '1000', unit: 'mg' },
    time: 'split',
    priceCentsPerCapsule: 6,
  },
  {
    id: 'coq10',
    name: 'CoQ10',
    strength: { amount: '100', unit: 'mg' },
    time: 'morning',
    priceCentsPerCapsule: 22,
  },
  {
    id: 'glycine',
    name: 'Glycine',
    strength: { amount: '1000', unit: 'mg' },
    time: 'evening',
    priceCentsPerCapsule: 5,
  },
];

export const INGREDIENTS_BY_ID = new Map(INGREDIENTS.map((item) => [item.id, item]));

/** `5,000 IU (125 mcg)` or `200 mg`. */
export function strengthLabel(ingredient: IngredientDefinition): string {
  const grouped = ingredient.strength.amount.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const base = `${grouped} ${ingredient.strength.unit}`;
  if (!ingredient.strength.mcg) return base;
  const mcg = ingredient.strength.mcg.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${base} (${mcg} mcg)`;
}

export const UNSERVED_STATES = ['ak', 'hi', 'ri'];

export const STATES: { state: string; name: string }[] = [
  { state: 'al', name: 'Alabama' },
  { state: 'ak', name: 'Alaska' },
  { state: 'az', name: 'Arizona' },
  { state: 'ar', name: 'Arkansas' },
  { state: 'ca', name: 'California' },
  { state: 'co', name: 'Colorado' },
  { state: 'ct', name: 'Connecticut' },
  { state: 'de', name: 'Delaware' },
  { state: 'fl', name: 'Florida' },
  { state: 'ga', name: 'Georgia' },
  { state: 'hi', name: 'Hawaii' },
  { state: 'id', name: 'Idaho' },
  { state: 'il', name: 'Illinois' },
  { state: 'in', name: 'Indiana' },
  { state: 'ia', name: 'Iowa' },
  { state: 'ks', name: 'Kansas' },
  { state: 'ky', name: 'Kentucky' },
  { state: 'la', name: 'Louisiana' },
  { state: 'me', name: 'Maine' },
  { state: 'md', name: 'Maryland' },
  { state: 'ma', name: 'Massachusetts' },
  { state: 'mi', name: 'Michigan' },
  { state: 'mn', name: 'Minnesota' },
  { state: 'ms', name: 'Mississippi' },
  { state: 'mo', name: 'Missouri' },
  { state: 'mt', name: 'Montana' },
  { state: 'ne', name: 'Nebraska' },
  { state: 'nv', name: 'Nevada' },
  { state: 'nh', name: 'New Hampshire' },
  { state: 'nj', name: 'New Jersey' },
  { state: 'nm', name: 'New Mexico' },
  { state: 'ny', name: 'New York' },
  { state: 'nc', name: 'North Carolina' },
  { state: 'nd', name: 'North Dakota' },
  { state: 'oh', name: 'Ohio' },
  { state: 'ok', name: 'Oklahoma' },
  { state: 'or', name: 'Oregon' },
  { state: 'pa', name: 'Pennsylvania' },
  { state: 'ri', name: 'Rhode Island' },
  { state: 'sc', name: 'South Carolina' },
  { state: 'sd', name: 'South Dakota' },
  { state: 'tn', name: 'Tennessee' },
  { state: 'tx', name: 'Texas' },
  { state: 'ut', name: 'Utah' },
  { state: 'vt', name: 'Vermont' },
  { state: 'va', name: 'Virginia' },
  { state: 'wa', name: 'Washington' },
  { state: 'wv', name: 'West Virginia' },
  { state: 'wi', name: 'Wisconsin' },
  { state: 'wy', name: 'Wyoming' },
];

export const STATES_BY_CODE = new Map(STATES.map((entry) => [entry.state, entry]));

export function stateName(code: string): string {
  return STATES_BY_CODE.get(code)?.name ?? code;
}

export function stateServed(code: string): boolean {
  return STATES_BY_CODE.has(code) && !UNSERVED_STATES.includes(code);
}
