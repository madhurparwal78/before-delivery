/**
 * Catalogue, product, comparison, favourites and spec sheets. Every response
 * carries exactly the field list the caller's role publishes.
 */

import { query, queryOne } from "../db/pool.js";
import { LIMITS } from "../../shared/domain.js";
import { projectVariant, type Viewer } from "../../shared/projection.js";
import type { FavouriteItem } from "../../shared/types.js";
import { sendJson, sendNoContent, type Ctx } from "../http/context.js";
import { notFound, storageUnavailable, unknownVariant, validation } from "../http/errors.js";
import { requireUser, viewerOf } from "../http/router.js";
import {
  filterCatalogue,
  loadAllVariants,
  loadProduct,
  loadProducts,
  loadVariant,
  parseCatalogueFilters,
  toComparisonItem,
  type VariantRecord,
} from "../domain/catalogue.js";
import { getObject, objectKeys, putObject } from "../services/storage.js";
import { buildSpecSheet } from "../pdf/specSheet.js";
import { ProviderUnavailable } from "../services/provider.js";

export async function catalogue(ctx: Ctx): Promise<void> {
  const viewer = viewerOf(ctx);
  const filters = parseCatalogueFilters(ctx.query);
  const [products, variants] = await Promise.all([loadProducts(), loadAllVariants()]);
  sendJson(ctx.res, 200, { products: filterCatalogue(products, variants, filters, viewer) });
}

export async function product(ctx: Ctx): Promise<void> {
  const slug = ctx.params.slug ?? "";
  const found = await loadProduct(slug, viewerOf(ctx));
  if (!found) throw notFound();
  sendJson(ctx.res, 200, { product: found });
}

export async function compare(ctx: Ctx): Promise<void> {
  const codes = (ctx.query.get("codes") ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter((code) => code.length > 0);

  if (codes.length > LIMITS.compareCodes.max) throw validation({ codes: "too_many" });
  if (codes.length < LIMITS.compareCodes.min) throw validation({ codes: "required" });

  const viewer = viewerOf(ctx);
  const items = [];
  for (const code of codes) {
    const variant = await loadVariant(code);
    if (!variant) throw unknownVariant();
    items.push(toComparisonItem(variant, viewer));
  }
  sendJson(ctx.res, 200, { items });
}

export async function listFavourites(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const viewer: Viewer = { role: user.role, trade_status: user.trade_status };
  const rows = await query<VariantRecord>(
    `SELECT v.code, v.finish, v.finish_name, v.beam_deg, v.cct_k, v.lumens, v.candela,
            v.retail_price_cents, v.trade_price_cents, v.was_price_cents, v.clearance, v.sort_order,
            v.product_slug, p.name AS product_name, p.family AS product_family, p.watts, p.cri, p.ip_rating,
            COALESCE((SELECT SUM(m.delta) FROM stock_movements m WHERE m.variant_code = v.code), 0)::int
              AS stock_on_hand
     FROM favourites f
     JOIN variants v ON v.code = f.variant_code
     JOIN products p ON p.slug = v.product_slug
     WHERE f.user_id = $1
     ORDER BY f.created_at`,
    [user.id],
  );

  const items: FavouriteItem[] = rows.map((variant) => ({
    ...projectVariant(variant, viewer),
    product_name: variant.product_name,
    product_slug: variant.product_slug,
  }));
  sendJson(ctx.res, 200, { items });
}

export async function saveFavourite(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const code = ctx.params.code ?? "";
  const variant = await queryOne<{ code: string }>("SELECT code FROM variants WHERE code = $1", [code]);
  if (!variant) throw notFound();

  await query("INSERT INTO favourites (user_id, variant_code) VALUES ($1,$2) ON CONFLICT DO NOTHING", [
    user.id,
    code,
  ]);
  sendJson(ctx.res, 200, { saved: true });
}

export async function removeFavourite(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  await query("DELETE FROM favourites WHERE user_id = $1 AND variant_code = $2", [user.id, ctx.params.code ?? ""]);
  sendNoContent(ctx.res);
}

/** Each variant's spec sheet is generated once, stored in MinIO and reused after that. */
export async function specSheet(ctx: Ctx): Promise<void> {
  const code = ctx.params.code ?? "";
  const variant = await loadVariant(code);
  if (!variant) throw notFound();

  const key = objectKeys.specSheet(code);
  try {
    const existing = await getObject(key);
    const pdf = existing ?? (await generateAndStore(key, variant));
    ctx.res.writeHead(200, {
      "content-type": "application/pdf",
      "content-length": pdf.length,
      "content-disposition": `inline; filename="lightfall-${code}.pdf"`,
      "cache-control": "no-store",
    });
    ctx.res.end(pdf);
  } catch (error) {
    if (error instanceof ProviderUnavailable) throw storageUnavailable();
    throw error;
  }
}

async function generateAndStore(key: string, variant: VariantRecord): Promise<Buffer> {
  const pdf = buildSpecSheet(variant);
  await putObject(key, pdf, "application/pdf");
  return pdf;
}
