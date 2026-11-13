import { slugify } from "../shared/format";
import { hashPassword } from "./auth";
import { unit, type Unit } from "./db";
import * as giftcards from "./giftcards";
import { move } from "./stock";
import schema from "./schema.sql";

// The schema and the seed data are applied on every start, under one advisory lock, so two copies starting
// at once agree. Seed data goes in only when the database has no catalogue.

const AIRLINES = [
  ["skyline-indus", "Skyline Indus", 55, 40, 20, 7],
  ["monsoon-air", "Monsoon Air", 56, 36, 23, 8],
  ["coastal-hop", "Coastal Hop", 52, 40, 22, 7],
  ["northwind", "Northwind Regional", 40, 30, 20, 5],
] as const;

const USERS = [
  ["Asha Menon", "asha@roamhouse.example", "travel-asha-01", "customer"],
  ["Dev Raman", "dev@roamhouse.example", "travel-dev-02", "customer"],
  ["Priya Kulkarni", "ops@roamhouse.example", "ops-priya-03", "operations"],
  ["Tomas Ferreira", "support@roamhouse.example", "support-tomas-04", "support"],
] as const;

const COLOUR_CODES: Record<string, string> = {
  Graphite: "GRA", Sage: "SAG", "Signal Red": "RED", Silver: "SIL", Navy: "NAV", Teal: "TEA",
  Yellow: "YEL", Blue: "BLU", Sand: "SND", Tan: "TAN", Black: "BLK", Grey: "GRY",
};
const SIZE_CODES: Record<string, string> = { cabin: "C", "check-in-medium": "M", "check-in-large": "L", underseat: "U", "one-size": "O" };

type Size = [slug: string, h: number, w: number, d: number, kg: number, price: number, compareAt?: number];

interface Seeded {
  code: string;
  slug: string;
  name: string;
  category: string;
  material: string;
  colours: string[];
  sizes: Size[];
  published: string;
  description: string;
}

const SEPT = "2026-09-01";
const PRODUCTS: Seeded[] = [
  { code: "MER", slug: "meridian-spinner", name: "Meridian Spinner", category: "luggage", material: "Polycarbonate", colours: ["Graphite", "Sage", "Signal Red"], published: SEPT,
    sizes: [["cabin", 55, 40, 20, 2.9, 12499, 14999], ["check-in-medium", 68, 46, 28, 3.8, 15999], ["check-in-large", 77, 52, 31, 4.6, 18999]],
    description: "A four-wheel polycarbonate spinner with a stowing handle, drawn to the cabin sizer." },
  { code: "ATL", slug: "atlas-aluminium", name: "Atlas Aluminium", category: "luggage", material: "Aluminium", colours: ["Silver", "Graphite"], published: SEPT,
    sizes: [["cabin", 56, 40, 23, 4.4, 24999], ["check-in-medium", 69, 47, 27, 5.6, 29999]],
    description: "A ribbed aluminium shell with recessed locks and an all-metal frame." },
  { code: "HAR", slug: "harbour-softside", name: "Harbour Softside", category: "luggage", material: "Recycled nylon", colours: ["Navy", "Teal"], published: SEPT,
    sizes: [["cabin", 54, 38, 22, 2.4, 8999], ["check-in-medium", 67, 44, 29, 3.3, 10999]],
    description: "A soft-sided suitcase in recycled nylon that gives a little at the gate." },
  { code: "KES", slug: "kestrel-trunk", name: "Kestrel Trunk", category: "luggage", material: "Polypropylene", colours: ["Yellow", "Blue"], published: "2026-10-20",
    sizes: [["check-in-large", 80, 50, 35, 5.1, 21499]],
    description: "A large check-in trunk in impact-tough polypropylene." },
  { code: "LRK", slug: "lark-underseat", name: "Lark Underseat", category: "luggage", material: "Polycarbonate", colours: ["Graphite", "Signal Red"], published: "2026-10-10",
    sizes: [["underseat", 40, 30, 18, 2.1, 7999]],
    description: "An underseat case that rolls on two wheels and fits the smallest sizers." },
  { code: "TRN", slug: "transit-backpack", name: "Transit Backpack", category: "backpacks", material: "Recycled nylon", colours: ["Graphite", "Sage", "Blue"], published: SEPT,
    sizes: [["cabin", 48, 32, 20, 1.3, 6499]],
    description: "A clamshell travel backpack that opens flat like a case." },
  { code: "RDG", slug: "ridge-roll-top", name: "Ridge Roll-top", category: "backpacks", material: "Waxed canvas", colours: ["Sand", "Graphite"], published: SEPT,
    sizes: [["underseat", 42, 30, 15, 1.1, 4999, 5999]],
    description: "A waxed canvas roll-top pack that grows with the day." },
  { code: "CRR", slug: "courier-daypack", name: "Courier Daypack", category: "backpacks", material: "Recycled nylon", colours: ["Teal", "Signal Red"], published: SEPT,
    sizes: [["underseat", 40, 28, 14, 0.8, 3999]],
    description: "A slim daypack for the commute and the connecting flight." },
  { code: "WKT", slug: "weekender-tote", name: "Weekender Tote", category: "totes", material: "Waxed canvas", colours: ["Sand", "Navy"], published: SEPT,
    sizes: [["underseat", 45, 32, 20, 1.0, 5499]],
    description: "A waxed canvas tote sized for a weekend under the seat." },
  { code: "MKT", slug: "market-tote", name: "Market Tote", category: "totes", material: "Cotton canvas", colours: ["Sand", "Black"], published: SEPT,
    sizes: [["one-size", 38, 40, 12, 0.4, 2499]],
    description: "A flat cotton canvas tote that folds into a pocket." },
  { code: "FLD", slug: "field-duffel", name: "Field Duffel", category: "totes", material: "Waxed canvas", colours: ["Graphite", "Sage"], published: SEPT,
    sizes: [["cabin", 30, 52, 28, 1.2, 7499]],
    description: "A waxed canvas duffel with a shoulder strap and a cabin-friendly shape." },
  { code: "PSW", slug: "passport-wallet", name: "Passport Wallet", category: "wallets", material: "Leather", colours: ["Tan", "Black"], published: SEPT,
    sizes: [["one-size", 14, 10, 2, 0.1, 2999]],
    description: "A leather wallet for a passport, cards and a boarding pass." },
  { code: "CSL", slug: "card-sleeve", name: "Card Sleeve", category: "wallets", material: "Leather", colours: ["Tan", "Black"], published: SEPT,
    sizes: [["one-size", 10, 7, 1, 0.05, 1499]],
    description: "A leather sleeve that holds the cards you actually use." },
  { code: "PCK", slug: "packing-cubes", name: "Fold Packing Cubes", category: "accessories", material: "Recycled nylon", colours: ["Sage", "Graphite"], published: SEPT,
    sizes: [["one-size", 35, 25, 10, 0.3, 1245]],
    description: "A set of folding packing cubes in recycled nylon." },
  { code: "TAG", slug: "tag-pair", name: "Tag Pair", category: "accessories", material: "Leather", colours: ["Tan"], published: SEPT,
    sizes: [["one-size", 11, 6, 1, 0.05, 980]],
    description: "A pair of leather luggage tags with a covered name window." },
  { code: "LCK", slug: "travel-lock", name: "Travel Lock", category: "accessories", material: "Zinc alloy", colours: ["Black"], published: SEPT,
    sizes: [["one-size", 6, 3, 1, 0.1, 1199]],
    description: "A three-dial zinc alloy lock for zips and hasps." },
  { code: "PLW", slug: "neck-pillow", name: "Neck Pillow", category: "accessories", material: "Memory foam", colours: ["Grey"], published: SEPT,
    sizes: [["one-size", 30, 28, 12, 0.3, 1799]],
    description: "A memory foam neck pillow that compresses into its own pouch." },
];

const STOCK_EXCEPTIONS: Record<string, number> = { "MER-SAG-M": 2, "MER-RED-C": 1, "HAR-NAV-C": 5, "ATL-SIL-M": 0, "KES-YEL-L": 3 };

const DISCOUNTS = [
  ["TRAVEL10", "percent", 10, null, 0, "2026-01-01T00:00:00+05:30", "2027-12-31T23:59:59+05:30", null, 0],
  ["SPRING15", "percent", 15, null, 0, "2026-01-01T00:00:00+05:30", "2026-05-31T23:59:00+05:30", null, 0],
  ["DUFFEL20", "percent", 20, "totes", 0, "2026-01-01T00:00:00+05:30", "2027-12-31T23:59:59+05:30", null, 0],
  ["BIG1500", "fixed", 1500, null, 20000, "2026-01-01T00:00:00+05:30", "2027-12-31T23:59:59+05:30", null, 0],
  ["LAUNCH25", "percent", 25, null, 0, "2026-01-01T00:00:00+05:30", "2027-12-31T23:59:59+05:30", 50, 50],
  ["SAVE300", "fixed", 300, null, 0, "2026-01-01T00:00:00+05:30", "2027-12-31T23:59:59+05:30", null, 0],
] as const;

async function seedAll(u: Unit): Promise<void> {
  const now = new Date();
  for (const [position, a] of AIRLINES.entries()) {
    await u.db.query("INSERT INTO airlines (code, name, height_cm, width_cm, depth_cm, weight_kg, position) VALUES ($1,$2,$3,$4,$5,$6,$7)", [...a, position]);
  }
  for (const [name, email, password, role] of USERS) {
    const { rows: [created] } = await u.db.query<{ id: string }>("INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id", [name, email, await hashPassword(password), role]);
    if (email.startsWith("asha")) {
      const saved = [
        ["Home", "14 Carter Road", "Bandra West", "Mumbai", "Maharashtra", "400050"],
        ["Office", "3rd Floor", "22 Residency Road", "Bengaluru", "Karnataka", "560025"],
      ] as const;
      for (const [label, line1, line2, city, state, postcode] of saved) {
        await u.db.query("INSERT INTO addresses (user_id, label, name, line1, line2, city, state, postcode, phone) VALUES ($1,$2,'Asha Menon',$3,$4,$5,$6,$7,'9820012345')", [created?.id, label, line1, line2, city, state, postcode]);
      }
    }
  }
  for (const p of PRODUCTS) {
    const { rows: [created] } = await u.db.query<{ id: string }>(
      "INSERT INTO products (slug, name, category, material, description, status, published_at) VALUES ($1,$2,$3,$4,$5,'published',$6) RETURNING id",
      [p.slug, p.name, p.category, p.material, p.description, new Date(`${p.published}T00:00:00+05:30`)],
    );
    let position = 0;
    for (const colour of p.colours) {
      for (const [size, h, w, d, kg, price, compareAt] of p.sizes) {
        const sku = `${p.code}-${COLOUR_CODES[colour]}-${SIZE_CODES[size]}`;
        await u.db.query(
          `INSERT INTO variants (sku, product_id, colour, colour_slug, size_slug, height_cm, width_cm, depth_cm, weight_kg, price, compare_at, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [sku, created?.id, colour, slugify(colour), size, h, w, d, kg, price, compareAt ?? null, position],
        );
        const available = STOCK_EXCEPTIONS[sku] ?? 8;
        if (available > 0) await move(u.db, { sku, location: "bhiwandi", reason: "stock_received", ref: "seed", from: "external", to: "available", quantity: available, at: now });
        position += 1;
      }
    }
  }
  for (const [code, kind, value, collection, minimum, starts, ends, limit, used] of DISCOUNTS) {
    await u.db.query("INSERT INTO discount_codes (code, kind, value, collection, minimum, starts_at, ends_at, usage_limit, used_before) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [code, kind, value, collection, minimum, starts, ends, limit, used]);
  }
  await giftcards.issue(u.db, "RHGC-2000-ALFA", 2000, now);
  await giftcards.issue(u.db, "RHGC-0500-BRVO", 500, now);
}

export async function applySchemaAndSeed(): Promise<void> {
  await unit(async (u) => {
    await u.db.query("SELECT pg_advisory_xact_lock(727001)");
    await u.db.query(schema);
    const existing = await u.db.query("SELECT 1 FROM products LIMIT 1");
    if (existing.rowCount === 0) await seedAll(u);
  });
}
