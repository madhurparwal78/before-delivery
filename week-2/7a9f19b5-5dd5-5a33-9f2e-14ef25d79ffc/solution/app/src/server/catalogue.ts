import { ownLux, poolDiameterMm, REFERENCE_CEILING_MM } from "../shared/lightpool.js";
import type { ComparisonItem, Family, Product, Variant } from "../shared/types.js";
import { seesTradePrices, type UserRow } from "./auth.js";
import { pool, type Queryable } from "./db.js";
import { notFound, validation } from "./errors.js";
import { json, type Route } from "./http.js";

export interface VariantRow {
  code: string;
  product_slug: string;
  product_name: string;
  finish: string;
  finish_name: string;
  beam_deg: number;
  cct_k: number;
  lumens: number;
  candela: number;
  retail_price_cents: number;
  trade_price_cents: number;
  clearance_price_cents: number | null;
  stock_on_hand: number | null;
}

interface ProductRow {
  slug: string;
  name: string;
  family: Family;
  description: string;
  watts: number;
  cri: number;
  ip_rating: string;
  default_variant: string;
}

export type PriceTier = "retail" | "trade";

const VARIANT_SELECT = `
  SELECT v.code, v.product_slug, p.name AS product_name, v.finish, f.name AS finish_name, v.beam_deg, v.cct_k,
         v.lumens, v.candela, v.retail_price_cents, v.trade_price_cents, v.clearance_price_cents,
         CASE WHEN v.clearance_price_cents IS NULL THEN NULL
              ELSE (SELECT coalesce(sum(m.delta), 0) FROM stock_movements m WHERE m.variant_code = v.code) END
           AS stock_on_hand
  FROM variants v JOIN products p ON p.slug = v.product_slug JOIN finishes f ON f.code = v.finish`;

export function isClearance(variant: VariantRow): boolean {
  return variant.clearance_price_cents !== null;
}

/** The price a buyer pays at a tier: clearance variants carry their clearance price at both tiers. */
export function unitPrice(variant: VariantRow, tier: PriceTier): number {
  if (variant.clearance_price_cents !== null) return variant.clearance_price_cents;
  return tier === "trade" ? variant.trade_price_cents : variant.retail_price_cents;
}

/** The one projection of price fields by role: only approved trade buyers and admins get trade_price_cents. */
function projectVariant(variant: VariantRow, user: UserRow | null): Variant {
  const clearance = isClearance(variant);
  const projected: Variant = {
    code: variant.code,
    finish: variant.finish,
    finish_name: variant.finish_name,
    beam_deg: variant.beam_deg,
    cct_k: variant.cct_k,
    lumens: variant.lumens,
    candela: variant.candela,
    retail_price_cents: unitPrice(variant, "retail"),
    was_price_cents: clearance ? variant.retail_price_cents : null,
    clearance,
    stock_on_hand: clearance ? variant.stock_on_hand : null,
  };
  return seesTradePrices(user) ? { ...projected, trade_price_cents: unitPrice(variant, "trade") } : projected;
}

export async function variantRows(db: Queryable = pool): Promise<VariantRow[]> {
  return (await db.query<VariantRow>(`${VARIANT_SELECT} ORDER BY v.position`)).rows;
}

export async function variantByCode(code: string, db: Queryable = pool): Promise<VariantRow | null> {
  return (await db.query<VariantRow>(`${VARIANT_SELECT} WHERE v.code = $1`, [code])).rows[0] ?? null;
}

async function catalogue(): Promise<{ products: ProductRow[]; variants: VariantRow[] }> {
  const [products, variants] = await Promise.all([
    pool.query<ProductRow>(
      "SELECT slug, name, family, description, watts, cri, ip_rating, default_variant FROM products ORDER BY position",
    ),
    variantRows(),
  ]);
  return { products: products.rows, variants };
}

function projectProduct(product: ProductRow, variants: VariantRow[], user: UserRow | null): Product {
  return {
    slug: product.slug,
    name: product.name,
    family: product.family,
    description: product.description,
    watts: product.watts,
    cri: product.cri,
    ip_rating: product.ip_rating,
    default_variant: product.default_variant,
    variants: variants.filter((v) => v.product_slug === product.slug).map((v) => projectVariant(v, user)),
  };
}

function list(value: string | null): string[] | null {
  if (value === null) return null;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

/** The catalogue query from the brief: q matches the product, and one variant matches every filter at once. */
function matches(product: ProductRow, variants: VariantRow[], query: URLSearchParams): boolean {
  const q = (query.get("q") ?? "").trim().toLowerCase();
  const family = query.get("family");
  const finishes = list(query.get("finish"));
  const beams = list(query.get("beam"));
  const ccts = list(query.get("cct"));
  const clearanceOnly = query.get("clearance") === "true" || family === "clearance";
  const own = variants.filter((v) => v.product_slug === product.slug);
  if (
    q &&
    !product.name.toLowerCase().includes(q) &&
    !product.description.toLowerCase().includes(q) &&
    !own.some((v) => v.code.toLowerCase().includes(q))
  ) {
    return false;
  }
  if (family && family !== "clearance" && product.family !== family) return false;
  return own.some(
    (v) =>
      (!finishes || finishes.includes(v.finish)) &&
      (!beams || beams.includes(String(v.beam_deg))) &&
      (!ccts || ccts.includes(String(v.cct_k))) &&
      (!clearanceOnly || isClearance(v)),
  );
}

function comparisonItem(variant: VariantRow, product: ProductRow, user: UserRow | null): ComparisonItem {
  return {
    product_slug: product.slug,
    product_name: product.name,
    watts: product.watts,
    cri: product.cri,
    ip_rating: product.ip_rating,
    pool_diameter_mm_at_2700: poolDiameterMm(REFERENCE_CEILING_MM, variant.beam_deg),
    centre_lux_at_2700: ownLux(variant.candela, REFERENCE_CEILING_MM),
    ...projectVariant(variant, user),
  };
}

export const catalogueRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/catalogue",
    access: "public",
    async handler({ url, user }) {
      const { products, variants } = await catalogue();
      return json(200, {
        products: products
          .filter((product) => matches(product, variants, url.searchParams))
          .map((product) => projectProduct(product, variants, user)),
      });
    },
  },
  {
    method: "GET",
    path: "/api/products/:slug",
    access: "public",
    async handler({ params, user }) {
      const { products, variants } = await catalogue();
      const product = products.find((p) => p.slug === params.slug);
      if (!product) throw notFound();
      return json(200, { product: projectProduct(product, variants, user) });
    },
  },
  {
    method: "GET",
    path: "/api/compare",
    access: "public",
    async handler({ url, user }) {
      const codes = list(url.searchParams.get("codes")) ?? [];
      const { products, variants } = await catalogue();
      const chosen = codes.map((code) => variants.find((v) => v.code === code));
      if (chosen.some((v) => v === undefined)) throw notFound("unknown_variant");
      if (codes.length === 0) throw validation({ codes: "required" });
      if (codes.length > 4) throw validation({ codes: "too_many" });
      return json(200, {
        items: chosen.map((variant) => {
          const product = products.find((p) => p.slug === variant!.product_slug)!;
          return comparisonItem(variant!, product, user);
        }),
      });
    },
  },
  {
    method: "GET",
    path: "/api/favourites",
    access: "user",
    async handler({ user }) {
      const saved = await pool.query<{ variant_code: string }>(
        "SELECT variant_code FROM favourites WHERE user_id = $1 ORDER BY created_at, variant_code",
        [user!.id],
      );
      const variants = await variantRows();
      return json(200, {
        items: saved.rows.map(({ variant_code }) => {
          const variant = variants.find((v) => v.code === variant_code)!;
          return { ...projectVariant(variant, user), product_name: variant.product_name, product_slug: variant.product_slug };
        }),
      });
    },
  },
  {
    method: "PUT",
    path: "/api/favourites/:code",
    access: "user",
    async handler({ params, user }) {
      if (!(await variantByCode(params.code!))) throw notFound();
      await pool.query("INSERT INTO favourites (user_id, variant_code) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
        user!.id,
        params.code,
      ]);
      return json(200, { saved: true });
    },
  },
  {
    method: "DELETE",
    path: "/api/favourites/:code",
    access: "user",
    async handler({ params, user }) {
      await pool.query("DELETE FROM favourites WHERE user_id = $1 AND variant_code = $2", [user!.id, params.code]);
      return json(204);
    },
  },
];
