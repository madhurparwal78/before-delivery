import { GitCompareArrows, Heart } from "lucide-react";
import type { Product, Variant } from "../../shared/types";
import { familyLabel } from "../lib/format";
import { Link } from "../lib/router";
import { addToTray, removeFromTray, useTray } from "../lib/tray";
import { FittingThumb } from "./Fitting3D";
import { PriceLine } from "./PriceLine";

interface CardProps {
  product: Product;
  variant: Variant;
  seesTrade: boolean;
  saved: boolean;
  onToggleSave: (variant: Variant) => void;
}

export function ProductCard({ product, variant, seesTrade, saved, onToggleSave }: CardProps) {
  const { items } = useTray();
  const inTray = items.find((item) => item.product_slug === product.slug);
  return (
    <article aria-label={product.name} className="card">
      <div className="card__media">
        <FittingThumb code={variant.code} finish={variant.finish} beam={variant.beam_deg} cct={variant.cct_k} />
      </div>
      <div className="card__body">
        <p className="card__family">{familyLabel(product.family)}</p>
        <h2 className="card__name">
          <Link href={`/products/${product.slug}?variant=${variant.code}`}>{product.name}</Link>
        </h2>
        <p className="card__spec mono">
          {variant.code} · {variant.beam_deg}° · {variant.cct_k}K
        </p>
        <PriceLine variant={variant} seesTrade={seesTrade} />
      </div>
      <div className="card__actions">
        <button
          type="button"
          className="chip-button"
          aria-pressed={Boolean(inTray)}
          aria-label={`Compare ${product.name}`}
          onClick={() =>
            inTray
              ? removeFromTray(inTray.code)
              : addToTray({ code: variant.code, product_slug: product.slug, product_name: product.name })
          }
        >
          <GitCompareArrows aria-hidden="true" size={16} strokeWidth={1.5} />
          Compare
        </button>
        <button
          type="button"
          className="chip-button"
          aria-pressed={saved}
          aria-label={`Save ${product.name}`}
          onClick={() => onToggleSave(variant)}
        >
          <Heart aria-hidden="true" size={16} strokeWidth={1.5} fill={saved ? "currentColor" : "none"} />
          Save
        </button>
      </div>
    </article>
  );
}
