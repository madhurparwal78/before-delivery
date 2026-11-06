/** The closed catalog: board packages, components and accessories, plus the compatibility table. */

export type Slot = 'wing' | 'mast' | 'propulsion' | 'battery' | 'controller';
export const SLOTS: readonly Slot[] = ['wing', 'mast', 'propulsion', 'battery', 'controller'] as const;

export type BoardName = 'Drift' | 'Crest' | 'Swift';
export const BOARD_ORDER: readonly BoardName[] = ['Drift', 'Crest', 'Swift'] as const;

export interface BoardPackage {
  sku: string;
  board: BoardName;
  size: string;
  finish: string;
  priceCents: number;
  defaults: Record<Slot, string>;
  seedStock: number;
}

export interface Component {
  sku: string;
  slot: Slot;
  name: string;
  colour: string;
  shape: string;
  priceCents: number;
  wh: number | null;
  mastM: string | null;
  drawAtGear1: number | null;
  addedPerGear: number | null;
  fits: BoardName[];
  seedStock: number;
}

export interface Accessory {
  sku: string;
  name: string;
  priceCents: number;
  seedStock: number;
}

export const BOARD_PACKAGES: readonly BoardPackage[] = [
  {
    sku: 'DR-49',
    board: 'Drift',
    size: "4'9",
    finish: 'pearl white',
    priceCents: 1099900,
    defaults: { wing: 'WNG-B170', mast: 'MST-AL28', propulsion: 'PRP-68', battery: 'BAT-18', controller: 'CTL-STD' },
    seedStock: 5,
  },
  {
    sku: 'DR-54',
    board: 'Drift',
    size: "5'4",
    finish: 'pearl white',
    priceCents: 1099900,
    defaults: { wing: 'WNG-B170', mast: 'MST-AL28', propulsion: 'PRP-68', battery: 'BAT-18', controller: 'CTL-STD' },
    seedStock: 5,
  },
  {
    sku: 'CR-52',
    board: 'Crest',
    size: "5'2",
    finish: 'carbon black',
    priceCents: 1499900,
    defaults: { wing: 'WNG-Q150', mast: 'MST-CF28', propulsion: 'PRP-68', battery: 'BAT-22', controller: 'CTL-ELT' },
    seedStock: 3,
  },
  {
    sku: 'CR-58',
    board: 'Crest',
    size: "5'8",
    finish: 'carbon black',
    priceCents: 1499900,
    defaults: { wing: 'WNG-Q150', mast: 'MST-CF28', propulsion: 'PRP-68', battery: 'BAT-22', controller: 'CTL-ELT' },
    seedStock: 1,
  },
  {
    sku: 'SW-43',
    board: 'Swift',
    size: "4'3",
    finish: 'graphite',
    priceCents: 1399900,
    defaults: { wing: 'WNG-Q120', mast: 'MST-CF32', propulsion: 'PRP-55F', battery: 'BAT-10', controller: 'CTL-ELT' },
    seedStock: 2,
  },
  {
    sku: 'SW-48',
    board: 'Swift',
    size: "4'8",
    finish: 'graphite',
    priceCents: 1399900,
    defaults: { wing: 'WNG-Q120', mast: 'MST-CF32', propulsion: 'PRP-55F', battery: 'BAT-10', controller: 'CTL-ELT' },
    seedStock: 2,
  },
  {
    sku: 'SW-52',
    board: 'Swift',
    size: "5'2",
    finish: 'graphite',
    priceCents: 1399900,
    defaults: { wing: 'WNG-Q120', mast: 'MST-CF32', propulsion: 'PRP-55F', battery: 'BAT-10', controller: 'CTL-ELT' },
    seedStock: 0,
  },
];

export const COMPONENTS: readonly Component[] = [
  {
    sku: 'WNG-B170',
    slot: 'wing',
    name: 'Bolt-on Glide 170',
    colour: 'sky blue',
    shape: 'broad',
    priceCents: 89900,
    wh: null,
    mastM: null,
    drawAtGear1: 900,
    addedPerGear: 150,
    fits: ['Drift'],
    seedStock: 50,
  },
  {
    sku: 'WNG-Q150',
    slot: 'wing',
    name: 'Arc Pro 150 SnapFit',
    colour: 'teal',
    shape: 'swept',
    priceCents: 159900,
    wh: null,
    mastM: null,
    drawAtGear1: 1000,
    addedPerGear: 170,
    fits: ['Crest', 'Swift'],
    seedStock: 50,
  },
  {
    sku: 'WNG-Q180',
    slot: 'wing',
    name: 'Arc Pro 180 Wide SnapFit',
    colour: 'deep teal',
    shape: 'wider span',
    priceCents: 179900,
    wh: null,
    mastM: null,
    drawAtGear1: 950,
    addedPerGear: 160,
    fits: ['Crest'],
    seedStock: 50,
  },
  {
    sku: 'WNG-Q120',
    slot: 'wing',
    name: 'Reef 120 SnapFit',
    colour: 'coral',
    shape: 'narrow',
    priceCents: 149900,
    wh: null,
    mastM: null,
    drawAtGear1: 1100,
    addedPerGear: 200,
    fits: ['Swift'],
    seedStock: 50,
  },
  {
    sku: 'MST-AL28',
    slot: 'mast',
    name: '28" aluminum',
    colour: 'brushed silver',
    shape: 'round',
    priceCents: 49900,
    wh: null,
    mastM: '0.711',
    drawAtGear1: null,
    addedPerGear: null,
    fits: ['Drift'],
    seedStock: 50,
  },
  {
    sku: 'MST-CF28',
    slot: 'mast',
    name: '28" carbon SnapFit',
    colour: 'black',
    shape: 'blade',
    priceCents: 119900,
    wh: null,
    mastM: '0.711',
    drawAtGear1: null,
    addedPerGear: null,
    fits: ['Drift', 'Crest'],
    seedStock: 50,
  },
  {
    sku: 'MST-CF32',
    slot: 'mast',
    name: '32" carbon SnapFit',
    colour: 'black',
    shape: 'blade, longer',
    priceCents: 139900,
    wh: null,
    mastM: '0.813',
    drawAtGear1: null,
    addedPerGear: null,
    fits: ['Crest', 'Swift'],
    seedStock: 50,
  },
  {
    sku: 'PRP-68',
    slot: 'propulsion',
    name: '68 mm direct drive',
    colour: 'dark grey',
    shape: 'pod, three blades',
    priceCents: 299900,
    wh: null,
    mastM: null,
    drawAtGear1: null,
    addedPerGear: null,
    fits: ['Drift', 'Crest'],
    seedStock: 50,
  },
  {
    sku: 'PRP-55F',
    slot: 'propulsion',
    name: '55 mm folding glide',
    colour: 'light grey',
    shape: 'pod, two folding blades',
    priceCents: 279900,
    wh: null,
    mastM: null,
    drawAtGear1: null,
    addedPerGear: null,
    fits: ['Swift'],
    seedStock: 50,
  },
  {
    sku: 'BAT-18',
    slot: 'battery',
    name: '1.8 kWh pack',
    colour: 'yellow',
    shape: 'block',
    priceCents: 299900,
    wh: 1800,
    mastM: null,
    drawAtGear1: null,
    addedPerGear: null,
    fits: ['Drift'],
    seedStock: 50,
  },
  {
    sku: 'BAT-22',
    slot: 'battery',
    name: '2.2 kWh pack',
    colour: 'orange',
    shape: 'longer block',
    priceCents: 349900,
    wh: 2200,
    mastM: null,
    drawAtGear1: null,
    addedPerGear: null,
    fits: ['Drift', 'Crest'],
    seedStock: 50,
  },
  {
    sku: 'BAT-10',
    slot: 'battery',
    name: '1.0 kWh pack',
    colour: 'green',
    shape: 'short block',
    priceCents: 249900,
    wh: 1000,
    mastM: null,
    drawAtGear1: null,
    addedPerGear: null,
    fits: ['Swift'],
    seedStock: 50,
  },
  {
    sku: 'CTL-STD',
    slot: 'controller',
    name: 'Hand Controller',
    colour: 'white',
    shape: 'trigger grip',
    priceCents: 29900,
    wh: null,
    mastM: null,
    drawAtGear1: null,
    addedPerGear: null,
    fits: ['Drift', 'Crest', 'Swift'],
    seedStock: 50,
  },
  {
    sku: 'CTL-ELT',
    slot: 'controller',
    name: 'Grip Pro Hand Controller',
    colour: 'black',
    shape: 'grip with a teal ring',
    priceCents: 59900,
    wh: null,
    mastM: null,
    drawAtGear1: null,
    addedPerGear: null,
    fits: ['Crest', 'Swift'],
    seedStock: 50,
  },
];

export const ACCESSORIES: readonly Accessory[] = [
  { sku: 'ACC-FLOAT', name: 'Floatpad inflatable', priceCents: 129900, seedStock: 10 },
  { sku: 'ACC-CHG', name: 'Fast charger', priceCents: 39900, seedStock: 50 },
  { sku: 'ACC-BAG', name: 'Board bag', priceCents: 24900, seedStock: 50 },
  { sku: 'SFB-40-18', name: "4'0 18L Tow board", priceCents: 165000, seedStock: 0 },
  { sku: 'SFB-50-60', name: "5'0 60L Prone board", priceCents: 189900, seedStock: 4 },
  { sku: 'SFB-59-105', name: "5'9 105L Wing board", priceCents: 219900, seedStock: 3 },
];

export interface BoardCopy {
  board: BoardName;
  eyebrow: string;
  description: string;
  material: string;
  battery: string;
  rideTime: string;
  anchor: string;
}

export const BOARD_COPY: readonly BoardCopy[] = [
  {
    board: 'Drift',
    eyebrow: 'First flights',
    description: 'A forgiving deck and a broad wing for your very first lift-off.',
    material: 'Glass-wrapped EPS core',
    battery: '1.8 kWh pack',
    rideTime: 'Up to 70 min',
    anchor: 'drift',
  },
  {
    board: 'Crest',
    eyebrow: 'Longest range',
    description: 'The long-range tourer: a bigger pack and a swept wing for open water.',
    material: 'Carbon sandwich hull',
    battery: '2.2 kWh pack',
    rideTime: 'Up to 80 min',
    anchor: 'crest',
  },
  {
    board: 'Swift',
    eyebrow: 'Lightest carry',
    description: 'The lightest board in the workshop, built for quick turns and a one-arm carry.',
    material: 'Full carbon shell',
    battery: '1.0 kWh pack',
    rideTime: 'Up to 35 min',
    anchor: 'swift',
  },
];

const boardBySku = new Map(BOARD_PACKAGES.map((b) => [b.sku, b]));
const componentBySku = new Map(COMPONENTS.map((c) => [c.sku, c]));
const accessoryBySku = new Map(ACCESSORIES.map((a) => [a.sku, a]));

export function boardPackage(sku: unknown): BoardPackage | undefined {
  return typeof sku === 'string' ? boardBySku.get(sku) : undefined;
}

export function component(sku: unknown): Component | undefined {
  return typeof sku === 'string' ? componentBySku.get(sku) : undefined;
}

export function accessory(sku: unknown): Accessory | undefined {
  return typeof sku === 'string' ? accessoryBySku.get(sku) : undefined;
}

export function componentInSlot(slot: Slot, sku: unknown): Component | undefined {
  const found = component(sku);
  return found && found.slot === slot ? found : undefined;
}

export function fitsBoard(part: Component, board: BoardName): boolean {
  return part.fits.includes(board);
}

/** A SKU is sellable as an accessory line when it is an accessory or a component. */
export function sellableSku(sku: unknown): { sku: string; name: string; priceCents: number } | undefined {
  const acc = accessory(sku);
  if (acc) return { sku: acc.sku, name: acc.name, priceCents: acc.priceCents };
  const comp = component(sku);
  if (comp) return { sku: comp.sku, name: comp.name, priceCents: comp.priceCents };
  return undefined;
}

export function allStockSkus(): { sku: string; stock: number }[] {
  return [
    ...BOARD_PACKAGES.map((b) => ({ sku: b.sku, stock: b.seedStock })),
    ...COMPONENTS.map((c) => ({ sku: c.sku, stock: c.seedStock })),
    ...ACCESSORIES.map((a) => ({ sku: a.sku, stock: a.seedStock })),
  ];
}

export function boardPackageName(pkg: BoardPackage): string {
  return `${pkg.board} ${pkg.size}`;
}

