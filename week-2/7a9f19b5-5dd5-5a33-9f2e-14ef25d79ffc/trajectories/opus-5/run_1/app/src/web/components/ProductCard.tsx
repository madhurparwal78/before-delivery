/**
 * A product card. It shows the name, a still thumbnail of the 3D model, and the
 * price line and stock badge of the card's shown variant.
 */

import { CATALOGUE } from "../../shared/copy.js";
import { LIMITS } from "../../shared/domain.js";
import type { Product, Variant } from "../../shared/types.js";
import { FittingDrawing } from "../three/FittingDrawing.js";
import { shapeFor } from "../three/fittings.js";
import { AppLink } from "./Shell.js";

/**
 * The shown variant is the product's default variant, except on the clearance
 * family or with "Clearance only" ticked, where it is the clearance variant.
 */
export function shownVariant(product: Product, preferClearance: boolean): Variant {
  const clearance = product.variants.find((variant) => variant.clearance);
  if (preferClearance && clearance) return clearance;
  const fallback = product.variants[0];
  if (!fallback) throw new Error(`${product.slug} has no variants`);
  return product.variants.find((variant) => variant.code === product.default_variant) ?? fallback;
}

/**
 * Price lines read `$<price> + GST`. An approved trade buyer sees the trade price
 * with the RRP below it. A clearance price is followed by the regular retail price
 * struck through.
 */
export function PriceLine({ variant }: { variant: Variant }) {
  const trade = "trade_price_cents" in variant ? variant.trade_price_cents : null;

  return (
    <div className="stack" style={{ gap: 2 }}>
      <span className="price-line">
        {trade === null ? CATALOGUE.priceLine(variant.retail_price_cents) : CATALOGUE.tradePriceLine(trade)}
        {variant.clearance && variant.was_price_cents !== null && (
          <>
            {" "}
            <span className="was-price">{CATALOGUE.priceLine(variant.was_price_cents)}</span>
          </>
        )}
      </span>
      {trade !== null && <span className="price-line muted">{CATALOGUE.rrpLine(variant.retail_price_cents)}</span>}
    </div>
  );
}

export function StockBadge({ variant }: { variant: Variant }) {
  if (!variant.clearance || variant.stock_on_hand === null) return null;
  if (variant.stock_on_hand === 0) {
    return <span className="badge badge-out">{CATALOGUE.stockBadgeSoldOut}</span>;
  }
  if (variant.stock_on_hand <= LIMITS.stockBadgeThreshold) {
    return <span className="badge">{CATALOGUE.stockBadgeLeft(variant.stock_on_hand)}</span>;
  }
  return null;
}

export interface ProductCardProps {
  product: Product;
  variant: Variant;
  inTray: boolean;
  saved: boolean;
  onCompare: () => void;
  onSave: () => void;
}

export function ProductCard({ product, variant, inTray, saved, onCompare, onSave }: ProductCardProps) {
  return (
    <article className="card" aria-label={product.name}>
      <FittingDrawing
        shape={shapeFor(product.family, product.slug)}
        finish={variant.finish}
        beamDeg={variant.beam_deg}
        cctK={variant.cct_k}
        label={`${product.name} drawing`}
        className="card-figure"
      />
      <div className="card-body">
        <AppLink to={`/products/${product.slug}?variant=${variant.code}`} className="card-title">
          {product.name}
        </AppLink>
        <span className="small muted numeric">{variant.code}</span>
        <PriceLine variant={variant} />
        <StockBadge variant={variant} />
        <div className="card-actions">
          <button
            type="button"
            className="button button-quiet small"
            aria-pressed={inTray}
            onClick={onCompare}
          >
            {`Compare ${product.name}`}
          </button>
          <button type="button" className="button button-quiet small" aria-pressed={saved} onClick={onSave}>
            {`Save ${product.name}`}
          </button>
        </div>
      </div>
    </article>
  );
}
