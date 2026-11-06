// Seed data of the catalog (brief: Seed data) and the live catalog read from PostgreSQL.
import type { Db } from "./db.ts";
import { asLowAs } from "./domain/financing.ts";

export const SLOTS = ["wing", "mast", "propulsion", "battery", "controller"] as const;
export type Slot = (typeof SLOTS)[number];
export const BOARD_NAMES = ["Drift", "Crest", "Swift"] as const;
export type BoardName = (typeof BOARD_NAMES)[number];

export interface BoardPackage {
  sku: string;
  name: BoardName;
  size: string;
  finish: string;
  price_cents: number;
  defaults: Record<Slot, string>;
  stock: number;
  in_stock: boolean;
}

export interface Component {
  sku: string;
  slot: Slot;
  name: string;
  colour: string;
  price_cents: number;
  wh: number | null;
  /** Three decimals as seeded ("0.711"), or null for parts that are not masts. */
  mast_m: string | null;
  /** Wing draw at gear 1 and added per gear in watts, null for parts that are not wings (not published). */
  draw_w: [number, number] | null;
  fits: BoardName[];
  stock: number;
  in_stock: boolean;
}

export interface Accessory {
  sku: string;
  name: string;
  price_cents: number;
  stock: number;
  in_stock: boolean;
}

type Seed<T> = Omit<T, "in_stock">;

const DRIFT = { wing: "WNG-B170", mast: "MST-AL28", propulsion: "PRP-68", battery: "BAT-18", controller: "CTL-STD" };
const CREST = { wing: "WNG-Q150", mast: "MST-CF28", propulsion: "PRP-68", battery: "BAT-22", controller: "CTL-ELT" };
const SWIFT = { wing: "WNG-Q120", mast: "MST-CF32", propulsion: "PRP-55F", battery: "BAT-10", controller: "CTL-ELT" };

export const BOARD_SEED: Seed<BoardPackage>[] = [
  { sku: "DR-49", name: "Drift", size: "4'9", finish: "pearl white", price_cents: 1099900, defaults: DRIFT, stock: 5 },
  { sku: "DR-54", name: "Drift", size: "5'4", finish: "pearl white", price_cents: 1099900, defaults: DRIFT, stock: 5 },
  { sku: "CR-52", name: "Crest", size: "5'2", finish: "carbon black", price_cents: 1499900, defaults: CREST, stock: 3 },
  { sku: "CR-58", name: "Crest", size: "5'8", finish: "carbon black", price_cents: 1499900, defaults: CREST, stock: 1 },
  { sku: "SW-43", name: "Swift", size: "4'3", finish: "graphite", price_cents: 1399900, defaults: SWIFT, stock: 2 },
  { sku: "SW-48", name: "Swift", size: "4'8", finish: "graphite", price_cents: 1399900, defaults: SWIFT, stock: 2 },
  { sku: "SW-52", name: "Swift", size: "5'2", finish: "graphite", price_cents: 1399900, defaults: SWIFT, stock: 0 },
];

const COMPONENT_STOCK = 50;

export const COMPONENT_SEED: Seed<Component>[] = [
  { sku: "WNG-B170", slot: "wing", name: "Bolt-on Glide 170", colour: "sky blue", price_cents: 89900, wh: null, mast_m: null, draw_w: [900, 150], fits: ["Drift"], stock: COMPONENT_STOCK },
  { sku: "WNG-Q150", slot: "wing", name: "Arc Pro 150 SnapFit", colour: "teal", price_cents: 159900, wh: null, mast_m: null, draw_w: [1000, 170], fits: ["Crest", "Swift"], stock: COMPONENT_STOCK },
  { sku: "WNG-Q180", slot: "wing", name: "Arc Pro 180 Wide SnapFit", colour: "deep teal", price_cents: 179900, wh: null, mast_m: null, draw_w: [950, 160], fits: ["Crest"], stock: COMPONENT_STOCK },
  { sku: "WNG-Q120", slot: "wing", name: "Reef 120 SnapFit", colour: "coral", price_cents: 149900, wh: null, mast_m: null, draw_w: [1100, 200], fits: ["Swift"], stock: COMPONENT_STOCK },
  { sku: "MST-AL28", slot: "mast", name: '28" aluminum', colour: "brushed silver", price_cents: 49900, wh: null, mast_m: "0.711", draw_w: null, fits: ["Drift"], stock: COMPONENT_STOCK },
  { sku: "MST-CF28", slot: "mast", name: '28" carbon SnapFit', colour: "black", price_cents: 119900, wh: null, mast_m: "0.711", draw_w: null, fits: ["Drift", "Crest"], stock: COMPONENT_STOCK },
  { sku: "MST-CF32", slot: "mast", name: '32" carbon SnapFit', colour: "black", price_cents: 139900, wh: null, mast_m: "0.813", draw_w: null, fits: ["Crest", "Swift"], stock: COMPONENT_STOCK },
  { sku: "PRP-68", slot: "propulsion", name: "68 mm direct drive", colour: "dark grey", price_cents: 299900, wh: null, mast_m: null, draw_w: null, fits: ["Drift", "Crest"], stock: COMPONENT_STOCK },
  { sku: "PRP-55F", slot: "propulsion", name: "55 mm folding glide", colour: "light grey", price_cents: 279900, wh: null, mast_m: null, draw_w: null, fits: ["Swift"], stock: COMPONENT_STOCK },
  { sku: "BAT-18", slot: "battery", name: "1.8 kWh pack", colour: "yellow", price_cents: 299900, wh: 1800, mast_m: null, draw_w: null, fits: ["Drift"], stock: COMPONENT_STOCK },
  { sku: "BAT-22", slot: "battery", name: "2.2 kWh pack", colour: "orange", price_cents: 349900, wh: 2200, mast_m: null, draw_w: null, fits: ["Drift", "Crest"], stock: COMPONENT_STOCK },
  { sku: "BAT-10", slot: "battery", name: "1.0 kWh pack", colour: "green", price_cents: 249900, wh: 1000, mast_m: null, draw_w: null, fits: ["Swift"], stock: COMPONENT_STOCK },
  { sku: "CTL-STD", slot: "controller", name: "Hand Controller", colour: "white", price_cents: 29900, wh: null, mast_m: null, draw_w: null, fits: ["Drift", "Crest", "Swift"], stock: COMPONENT_STOCK },
  { sku: "CTL-ELT", slot: "controller", name: "Grip Pro Hand Controller", colour: "black", price_cents: 59900, wh: null, mast_m: null, draw_w: null, fits: ["Crest", "Swift"], stock: COMPONENT_STOCK },
];

const ACCESSORY_SEED: Seed<Accessory>[] = [
  { sku: "ACC-FLOAT", name: "Floatpad inflatable", price_cents: 129900, stock: 10 },
  { sku: "ACC-CHG", name: "Fast charger", price_cents: 39900, stock: 50 },
  { sku: "ACC-BAG", name: "Board bag", price_cents: 24900, stock: 50 },
  { sku: "SFB-40-18", name: "4'0 18L Tow board", price_cents: 165000, stock: 0 },
  { sku: "SFB-50-60", name: "5'0 60L Prone board", price_cents: 189900, stock: 4 },
  { sku: "SFB-59-105", name: "5'9 105L Wing board", price_cents: 219900, stock: 3 },
];

export interface Catalog {
  boards: BoardPackage[];
  components: Component[];
  accessories: Accessory[];
  board(sku: string): BoardPackage | undefined;
  component(sku: string): Component | undefined;
  /** A SKU sold as an accessory line: one of the accessories or any component under its own SKU. */
  sellable(sku: string): Accessory | Component | undefined;
  stock(sku: string): number;
}

interface ProductRow {
  sku: string;
  kind: "board" | "component" | "accessory";
  name: string;
  price_cents: number;
  details: Record<string, unknown>;
  stock: number;
}

export async function loadCatalog(db: Db): Promise<Catalog> {
  const { rows } = await db.query<ProductRow>(
    "SELECT sku, kind, name, price_cents, details, stock FROM products ORDER BY position",
  );
  const boards: BoardPackage[] = [];
  const components: Component[] = [];
  const accessories: Accessory[] = [];
  for (const row of rows) {
    const base = { sku: row.sku, price_cents: row.price_cents, stock: row.stock, in_stock: row.stock > 0 };
    if (row.kind === "board") boards.push({ ...(row.details as Omit<BoardPackage, keyof typeof base>), ...base });
    else if (row.kind === "component") components.push({ ...(row.details as Omit<Component, keyof typeof base>), ...base });
    else accessories.push({ name: row.name, ...base });
  }
  const bySku = new Map<string, BoardPackage | Component | Accessory>(
    [...boards, ...components, ...accessories].map((item) => [item.sku, item]),
  );
  return {
    boards,
    components,
    accessories,
    board: (sku) => boards.find((b) => b.sku === sku),
    component: (sku) => components.find((c) => c.sku === sku),
    sellable: (sku) => accessories.find((a) => a.sku === sku) ?? components.find((c) => c.sku === sku),
    stock: (sku) => bySku.get(sku)?.stock ?? 0,
  };
}

/** Rows for the products table, seeded once. */
export function productSeedRows(): { sku: string; kind: string; name: string; price_cents: number; details: object; stock: number }[] {
  return [
    ...BOARD_SEED.map(({ sku, price_cents, stock, ...details }) => ({ sku, kind: "board", name: details.name, price_cents, details, stock })),
    ...COMPONENT_SEED.map(({ sku, price_cents, stock, ...details }) => ({ sku, kind: "component", name: details.name, price_cents, details, stock })),
    ...ACCESSORY_SEED.map(({ sku, price_cents, stock, name }) => ({ sku, kind: "accessory", name, price_cents, details: {}, stock })),
  ];
}

/** The published catalog shapes (brief: Shapes): board packages, components and accessories with live stock. */
export function catalogBody(catalog: Catalog): object {
  return {
    boards: catalog.boards.map((b) => ({
      sku: b.sku, name: b.name, size: b.size, finish: b.finish, price_cents: b.price_cents, defaults: Object.fromEntries(SLOTS.map((s) => [s, b.defaults[s]])),
      stock: b.stock, in_stock: b.in_stock, as_low_as_cents: asLowAs(b.price_cents),
    })),
    components: catalog.components.map((c) => ({
      sku: c.sku, slot: c.slot, name: c.name, colour: c.colour, price_cents: c.price_cents, wh: c.wh, mast_m: c.mast_m,
      fits: [...c.fits], stock: c.stock, in_stock: c.in_stock, as_low_as_cents: asLowAs(c.price_cents),
    })),
    accessories: catalog.accessories.map((a) => ({
      sku: a.sku, name: a.name, price_cents: a.price_cents, stock: a.stock, in_stock: a.in_stock, as_low_as_cents: asLowAs(a.price_cents),
    })),
  };
}
