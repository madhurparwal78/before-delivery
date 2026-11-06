/**
 * Seed catalogue. Variant codes are `<product code>-<finish>-<beam>-<cct>` and
 * price in cents = product base price + finish surcharge + beam surcharge, the
 * same for every colour temperature. Candela comes from the product's table for
 * its beam and colour temperature; lumens depend only on colour temperature.
 */

import type { FinishCode, Occupation } from "../../shared/types.js";
import { FINISH_NAME } from "../../shared/domain.js";

interface Surcharge {
  retail: number;
  trade: number;
}

interface SeedProduct {
  slug: string;
  code: string;
  name: string;
  family: "downlights" | "track-spots" | "pendants" | "surface";
  description: string;
  watts: number;
  cri: number;
  ip_rating: string;
  default_variant: string;
  finishes: FinishCode[];
  beams: number[];
  ccts: number[];
  base: Surcharge;
  finishSurcharge?: Partial<Record<FinishCode, Surcharge>>;
  beamSurcharge?: Record<number, Surcharge>;
  /** Lumens by colour temperature. */
  lumens: Record<number, number>;
  /** Candela by beam then colour temperature. */
  candela: Record<number, Record<number, number>>;
  /** Variants outside the finish/beam/cct grid, such as discontinued clearance stock. */
  extraVariants?: SeedExtraVariant[];
}

interface SeedExtraVariant {
  finish: FinishCode;
  beam_deg: number;
  cct_k: number;
  lumens: number;
  candela: number;
  clearance_price_cents: number;
  stock_on_hand: number;
}

/** A clearance variant that is part of the regular grid. */
interface SeedClearanceGridVariant {
  code: string;
  clearance_price_cents: number;
  stock_on_hand: number;
}

export const SEED_PRODUCTS: readonly SeedProduct[] = [
  {
    slug: "kauri-downlight",
    code: "KDL",
    name: "Kauri Downlight",
    family: "downlights",
    description: "Deep-recessed downlight with a glare-free trim.",
    watts: 10,
    cri: 95,
    ip_rating: "IP44",
    default_variant: "KDL-WH-36-3000",
    finishes: ["WH", "BK", "BR"],
    beams: [24, 36, 60],
    ccts: [2700, 3000, 4000],
    base: { retail: 8900, trade: 6400 },
    finishSurcharge: { BR: { retail: 2000, trade: 1400 } },
    beamSurcharge: { 24: { retail: 600, trade: 400 } },
    lumens: { 2700: 860, 3000: 900, 4000: 940 },
    candela: {
      24: { 2700: 6260, 3000: 6550, 4000: 6840 },
      36: { 2700: 2800, 3000: 2930, 4000: 3060 },
      60: { 2700: 1020, 3000: 1070, 4000: 1120 },
    },
  },
  {
    slug: "totara-track-spot",
    code: "TTS",
    name: "T\u014dtara Track Spot",
    family: "track-spots",
    description: "Three-circuit track spot with a rotating, tilting head.",
    watts: 13,
    cri: 95,
    ip_rating: "IP20",
    default_variant: "TTS-BK-24-3000",
    finishes: ["BK", "WH"],
    beams: [15, 24, 36],
    ccts: [2700, 3000, 4000],
    base: { retail: 14900, trade: 10500 },
    beamSurcharge: { 15: { retail: 900, trade: 600 }, 24: { retail: 600, trade: 400 } },
    lumens: { 2700: 1150, 3000: 1200, 4000: 1260 },
    candela: {
      15: { 2700: 21370, 3000: 22300, 4000: 23420 },
      24: { 2700: 8380, 3000: 8740, 4000: 9180 },
      36: { 2700: 3740, 3000: 3900, 4000: 4100 },
    },
  },
  {
    slug: "pohutukawa-pendant",
    code: "PHP",
    name: "P\u014dhutukawa Pendant",
    family: "pendants",
    description: "Spun pendant with a softly diffused 60\u00b0 downward beam.",
    watts: 16,
    cri: 90,
    ip_rating: "IP20",
    default_variant: "PHP-BR-60-2700",
    finishes: ["BR", "BZ"],
    beams: [60],
    ccts: [2700, 3000],
    base: { retail: 32000, trade: 22400 },
    finishSurcharge: { BZ: { retail: 2500, trade: 1750 } },
    lumens: { 2700: 1400, 3000: 1450 },
    candela: { 60: { 2700: 1660, 3000: 1720 } },
  },
  {
    slug: "harbour-surface-cylinder",
    code: "HSC",
    name: "Harbour Surface Cylinder",
    family: "surface",
    description: "Surface-mounted cylinder for concrete and exposed ceilings.",
    watts: 8,
    cri: 90,
    ip_rating: "IP54",
    default_variant: "HSC-WH-24-3000",
    finishes: ["WH", "BK"],
    beams: [24, 36],
    ccts: [3000, 4000],
    base: { retail: 12500, trade: 8750 },
    beamSurcharge: { 24: { retail: 600, trade: 400 } },
    lumens: { 3000: 700, 4000: 740 },
    candela: {
      24: { 3000: 5100, 4000: 5390 },
      36: { 3000: 2280, 4000: 2410 },
    },
    extraVariants: [
      {
        finish: "CH",
        beam_deg: 24,
        cct_k: 3000,
        lumens: 700,
        candela: 5100,
        clearance_price_cents: 7900,
        stock_on_hand: 1,
      },
    ],
  },
  {
    slug: "rimu-gimbal-downlight",
    code: "RGD",
    name: "Rimu Gimbal Downlight",
    family: "downlights",
    description: "Adjustable gimbal downlight, final production run.",
    watts: 8,
    cri: 90,
    ip_rating: "IP44",
    default_variant: "RGD-SN-36-3000",
    finishes: ["SN"],
    beams: [36],
    ccts: [3000],
    base: { retail: 11900, trade: 8300 },
    lumens: { 3000: 650 },
    candela: { 36: { 3000: 2110 } },
  },
];

/** Grid variants that are sold as clearance stock. */
const SEED_CLEARANCE_GRID_VARIANTS: readonly SeedClearanceGridVariant[] = [
  { code: "RGD-SN-36-3000", clearance_price_cents: 5900, stock_on_hand: 3 },
];

export interface SeedVariantRow {
  code: string;
  product_slug: string;
  finish: FinishCode;
  finish_name: string;
  beam_deg: number;
  cct_k: number;
  lumens: number;
  candela: number;
  retail_price_cents: number;
  trade_price_cents: number;
  was_price_cents: number | null;
  clearance: boolean;
  stock_on_hand: number | null;
  sort_order: number;
}

export function variantCode(productCode: string, finish: FinishCode, beam: number, cct: number): string {
  return `${productCode}-${finish}-${beam}-${cct}`;
}

function priceFor(product: SeedProduct, finish: FinishCode, beam: number): Surcharge {
  const finishExtra = product.finishSurcharge?.[finish] ?? { retail: 0, trade: 0 };
  const beamExtra = product.beamSurcharge?.[beam] ?? { retail: 0, trade: 0 };
  return {
    retail: product.base.retail + finishExtra.retail + beamExtra.retail,
    trade: product.base.trade + finishExtra.trade + beamExtra.trade,
  };
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`seed data is missing ${what}`);
  return value;
}

/** Expands the seed tables into the variant rows the database stores. */
export function buildSeedVariants(): SeedVariantRow[] {
  const rows: SeedVariantRow[] = [];
  let sortOrder = 0;

  for (const product of SEED_PRODUCTS) {
    for (const finish of product.finishes) {
      for (const beam of product.beams) {
        for (const cct of product.ccts) {
          const code = variantCode(product.code, finish, beam, cct);
          const price = priceFor(product, finish, beam);
          const clearanceInfo = SEED_CLEARANCE_GRID_VARIANTS.find((c) => c.code === code);
          rows.push({
            code,
            product_slug: product.slug,
            finish,
            finish_name: FINISH_NAME[finish],
            beam_deg: beam,
            cct_k: cct,
            lumens: required(product.lumens[cct], `lumens for ${code}`),
            candela: required(required(product.candela[beam], `candela for beam ${beam}`)[cct], `candela for ${code}`),
            retail_price_cents: clearanceInfo ? clearanceInfo.clearance_price_cents : price.retail,
            trade_price_cents: clearanceInfo ? clearanceInfo.clearance_price_cents : price.trade,
            was_price_cents: clearanceInfo ? price.retail : null,
            clearance: clearanceInfo !== undefined,
            stock_on_hand: clearanceInfo ? clearanceInfo.stock_on_hand : null,
            sort_order: (sortOrder += 1),
          });
        }
      }
    }

    for (const extra of product.extraVariants ?? []) {
      const code = variantCode(product.code, extra.finish, extra.beam_deg, extra.cct_k);
      const price = priceFor(product, extra.finish, extra.beam_deg);
      rows.push({
        code,
        product_slug: product.slug,
        finish: extra.finish,
        finish_name: FINISH_NAME[extra.finish],
        beam_deg: extra.beam_deg,
        cct_k: extra.cct_k,
        lumens: extra.lumens,
        candela: extra.candela,
        retail_price_cents: extra.clearance_price_cents,
        trade_price_cents: extra.clearance_price_cents,
        was_price_cents: price.retail,
        clearance: true,
        stock_on_hand: extra.stock_on_hand,
        sort_order: (sortOrder += 1),
      });
    }
  }

  return rows;
}

export interface SeedAccount {
  email: string;
  name: string;
  password: string;
  role: "retail" | "trade" | "admin";
  trade_status: null | "submitted" | "approved" | "declined";
  trade?: { business_name: string; nzbn: string; occupation: Occupation };
}

export const SEED_ACCOUNTS: readonly SeedAccount[] = [
  {
    email: "admin@southerly-light.test",
    name: "Ana Whitlow",
    password: "Lightfall-admin-2026",
    role: "admin",
    trade_status: null,
  },
  {
    email: "rangi@kowhai-electrical.test",
    name: "Rangi Parata",
    password: "Trade-approved-2026",
    role: "trade",
    trade_status: "approved",
    trade: { business_name: "K\u014dwhai Electrical Ltd", nzbn: "9429041234567", occupation: "electrician" },
  },
  {
    email: "isla@harbourlight.test",
    name: "Isla Morven",
    password: "Trade-collab-2026",
    role: "trade",
    trade_status: "approved",
    trade: { business_name: "Harbour Light Design", nzbn: "9429047654321", occupation: "lighting_designer" },
  },
  {
    email: "sam@whitcombe-wholesale.test",
    name: "Sam Whitcombe",
    password: "Trade-pending-2026",
    role: "trade",
    trade_status: "submitted",
    trade: { business_name: "Whitcombe Wholesale", nzbn: "9429030000017", occupation: "wholesaler" },
  },
  {
    email: "jo@bennett-home.test",
    name: "Jo Bennett",
    password: "Retail-buyer-2026",
    role: "retail",
    trade_status: null,
  },
  {
    email: "lee@chen-house.test",
    name: "Lee Chen",
    password: "Retail-buyer2-2026",
    role: "retail",
    trade_status: null,
  },
];

export const SEED_PROJECT = {
  name: "Ponsonby Kitchen",
  owner_email: "rangi@kowhai-electrical.test",
  collaborator_email: "isla@harbourlight.test",
  client_name: "M. and T. Hale",
  ceiling_height_mm: 2700,
  room_width_mm: 6000,
  room_depth_mm: 4500,
  lines: [
    { variant_code: "KDL-BK-24-2700", quantity: 6 },
    { variant_code: "TTS-BK-36-3000", quantity: 2 },
  ],
} as const;
