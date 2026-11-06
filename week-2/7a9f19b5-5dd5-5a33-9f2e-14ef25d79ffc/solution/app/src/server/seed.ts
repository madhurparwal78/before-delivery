// Seed data, verbatim from the brief's Seed data section. Every person, business and NZBN is invented.
import type pg from "pg";
import type { Family, Occupation } from "../shared/types.js";
import { hashPassword } from "./auth.js";

const FINISHES: [string, string][] = [
  ["WH", "Matte White"],
  ["BK", "Matte Black"],
  ["BR", "Brushed Brass"],
  ["BZ", "Aged Bronze"],
  ["CH", "Charcoal"],
  ["SN", "Satin Nickel"],
];

type Price = [retail: number, trade: number];

interface ProductSeed {
  slug: string;
  code: string;
  name: string;
  family: Family;
  description: string;
  watts: number;
  cri: number;
  ip: string;
  defaultVariant: string;
  finishes: string[];
  beams: number[];
  ccts: number[];
  base: Price;
  finishSurcharge?: Record<string, Price>;
  beamSurcharge?: Record<number, Price>;
  lumens: Record<number, number>;
  candela: Record<number, Record<number, number>>;
  /** Clearance price and starting stock for a variant that is on clearance. */
  clearance?: Record<string, { price: number; stock: number }>;
  /** A discontinued variant outside the regular finish/beam/cct grid. */
  extra?: { finish: string; beam: number; cct: number };
}

const PRODUCTS: ProductSeed[] = [
  {
    slug: "kauri-downlight",
    code: "KDL",
    name: "Kauri Downlight",
    family: "downlights",
    description: "Deep-recessed downlight with a glare-free trim.",
    watts: 10,
    cri: 95,
    ip: "IP44",
    defaultVariant: "KDL-WH-36-3000",
    finishes: ["WH", "BK", "BR"],
    beams: [24, 36, 60],
    ccts: [2700, 3000, 4000],
    base: [8900, 6400],
    finishSurcharge: { BR: [2000, 1400] },
    beamSurcharge: { 24: [600, 400] },
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
    name: "Tōtara Track Spot",
    family: "track-spots",
    description: "Three-circuit track spot with a rotating, tilting head.",
    watts: 13,
    cri: 95,
    ip: "IP20",
    defaultVariant: "TTS-BK-24-3000",
    finishes: ["BK", "WH"],
    beams: [15, 24, 36],
    ccts: [2700, 3000, 4000],
    base: [14900, 10500],
    beamSurcharge: { 15: [900, 600], 24: [600, 400] },
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
    name: "Pōhutukawa Pendant",
    family: "pendants",
    description: "Spun pendant with a softly diffused 60° downward beam.",
    watts: 16,
    cri: 90,
    ip: "IP20",
    defaultVariant: "PHP-BR-60-2700",
    finishes: ["BR", "BZ"],
    beams: [60],
    ccts: [2700, 3000],
    base: [32000, 22400],
    finishSurcharge: { BZ: [2500, 1750] },
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
    ip: "IP54",
    defaultVariant: "HSC-WH-24-3000",
    finishes: ["WH", "BK"],
    beams: [24, 36],
    ccts: [3000, 4000],
    base: [12500, 8750],
    beamSurcharge: { 24: [600, 400] },
    lumens: { 3000: 700, 4000: 740 },
    candela: { 24: { 3000: 5100, 4000: 5390 }, 36: { 3000: 2280, 4000: 2410 } },
    extra: { finish: "CH", beam: 24, cct: 3000 },
    clearance: { "HSC-CH-24-3000": { price: 7900, stock: 1 } },
  },
  {
    slug: "rimu-gimbal-downlight",
    code: "RGD",
    name: "Rimu Gimbal Downlight",
    family: "downlights",
    description: "Adjustable gimbal downlight, final production run.",
    watts: 8,
    cri: 90,
    ip: "IP44",
    defaultVariant: "RGD-SN-36-3000",
    finishes: ["SN"],
    beams: [36],
    ccts: [3000],
    base: [11900, 8300],
    lumens: { 3000: 650 },
    candela: { 36: { 3000: 2110 } },
    clearance: { "RGD-SN-36-3000": { price: 5900, stock: 3 } },
  },
];

interface AccountSeed {
  name: string;
  email: string;
  password: string;
  role: "admin" | "trade" | "retail";
  trade?: { status: "approved" | "submitted"; business: string; nzbn: string; occupation: Occupation };
}

const ACCOUNTS: AccountSeed[] = [
  { name: "Ana Whitlow", email: "admin@southerly-light.test", password: "Lightfall-admin-2026", role: "admin" },
  {
    name: "Rangi Parata",
    email: "rangi@kowhai-electrical.test",
    password: "Trade-approved-2026",
    role: "trade",
    trade: { status: "approved", business: "Kōwhai Electrical Ltd", nzbn: "9429041234567", occupation: "electrician" },
  },
  {
    name: "Isla Morven",
    email: "isla@harbourlight.test",
    password: "Trade-collab-2026",
    role: "trade",
    trade: { status: "approved", business: "Harbour Light Design", nzbn: "9429047654321", occupation: "lighting_designer" },
  },
  {
    name: "Sam Whitcombe",
    email: "sam@whitcombe-wholesale.test",
    password: "Trade-pending-2026",
    role: "trade",
    trade: { status: "submitted", business: "Whitcombe Wholesale", nzbn: "9429030000017", occupation: "wholesaler" },
  },
  { name: "Jo Bennett", email: "jo@bennett-home.test", password: "Retail-buyer-2026", role: "retail" },
  { name: "Lee Chen", email: "lee@chen-house.test", password: "Retail-buyer2-2026", role: "retail" },
];

function priceOf(product: ProductSeed, finish: string, beam: number): Price {
  const finishPart = product.finishSurcharge?.[finish] ?? [0, 0];
  const beamPart = product.beamSurcharge?.[beam] ?? [0, 0];
  return [product.base[0] + finishPart[0] + beamPart[0], product.base[1] + finishPart[1] + beamPart[1]];
}

function candelaOf(product: ProductSeed, beam: number, cct: number): number {
  const value = product.candela[beam]?.[cct];
  if (value === undefined) throw new Error(`seed: no candela for ${product.code} ${beam}/${cct}`);
  return value;
}

export async function seed(client: pg.PoolClient): Promise<void> {
  for (const [index, [code, name]] of FINISHES.entries()) {
    await client.query("INSERT INTO finishes (code, name, position) VALUES ($1, $2, $3)", [code, name, index]);
  }
  let position = 0;
  for (const [productIndex, product] of PRODUCTS.entries()) {
    await client.query(
      `INSERT INTO products (slug, code, name, family, description, watts, cri, ip_rating, default_variant, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [product.slug, product.code, product.name, product.family, product.description, product.watts, product.cri,
        product.ip, product.defaultVariant, productIndex],
    );
    const grid = product.finishes.flatMap((finish) =>
      product.beams.flatMap((beam) => product.ccts.map((cct) => ({ finish, beam, cct }))),
    );
    for (const { finish, beam, cct } of product.extra ? [...grid, product.extra] : grid) {
      const code = `${product.code}-${finish}-${beam}-${cct}`;
      const [retail, trade] = priceOf(product, finish, beam);
      const clearance = product.clearance?.[code];
      const lumens = product.lumens[cct];
      if (lumens === undefined) throw new Error(`seed: no lumens for ${code}`);
      await client.query(
        `INSERT INTO variants (code, product_slug, finish, beam_deg, cct_k, lumens, candela, retail_price_cents,
           trade_price_cents, clearance_price_cents, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [code, product.slug, finish, beam, cct, lumens, candelaOf(product, beam, cct), retail, trade,
          clearance?.price ?? null, position++],
      );
      if (clearance) {
        await client.query("INSERT INTO stock_movements (variant_code, delta, reason) VALUES ($1, $2, 'seed')", [
          code,
          clearance.stock,
        ]);
      }
    }
  }

  const ids = new Map<string, string>();
  for (const account of ACCOUNTS) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash, role, trade_status) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [account.email, account.name, await hashPassword(account.password), account.role, account.trade?.status ?? null],
    );
    const id = inserted.rows[0]!.id;
    ids.set(account.email, id);
    if (account.trade) {
      await client.query(
        `INSERT INTO trade_applications (user_id, business_name, nzbn, occupation, status, decided_at)
         VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 = 'approved' THEN now() END)`,
        [id, account.trade.business, account.trade.nzbn, account.trade.occupation, account.trade.status],
      );
    }
  }

  const project = await client.query<{ id: string }>(
    `INSERT INTO projects (name, client_name, owner_id, ceiling_height_mm, room_width_mm, room_depth_mm)
     VALUES ('Ponsonby Kitchen', 'M. and T. Hale', $1, 2700, 6000, 4500) RETURNING id`,
    [ids.get("rangi@kowhai-electrical.test")],
  );
  const projectId = project.rows[0]!.id;
  for (const [code, quantity] of [["KDL-BK-24-2700", 6], ["TTS-BK-36-3000", 2]] as const) {
    await client.query("INSERT INTO project_lines (project_id, variant_code, quantity) VALUES ($1, $2, $3)", [
      projectId,
      code,
      quantity,
    ]);
  }
  await client.query("INSERT INTO project_collaborators (project_id, user_id) VALUES ($1, $2)", [
    projectId,
    ids.get("isla@harbourlight.test"),
  ]);
}
