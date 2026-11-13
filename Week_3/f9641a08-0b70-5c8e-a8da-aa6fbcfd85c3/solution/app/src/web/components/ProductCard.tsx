import { useState } from "react";
import type { SearchResult } from "../../shared/api";
import { inr } from "../../shared/format";
import { addToBag, toggleSave } from "../lib/actions";
import { compareUrl } from "../lib/catalogue";
import { colourHex } from "../lib/colours";
import { Link, navigate, useParams } from "../lib/router";
import { announceCompare, useApp, useConfig } from "../lib/store";

function badgeTone(badge: string): string {
  if (badge === "Out of stock") return "tone-red";
  return badge === "In stock" ? "tone-teal" : "tone-yellow";
}

export function ProductCard({ product }: { product: SearchResult }) {
  const config = useConfig();
  const { wishlistSlugs } = useApp();
  const params = useParams();
  const set = (params.get("compare") ?? "").split(",").filter(Boolean);
  const [colour, setColour] = useState(product.colours[0]?.slug ?? "");
  const [adding, setAdding] = useState(false);
  const saved = wishlistSlugs.includes(product.slug);
  const compared = set.filter((sku) => product.skus.includes(sku));
  const shown = product.colours.find((c) => c.slug === colour) ?? product.colours[0];
  const groupId = `colour-${product.slug}`;

  const quickAdd = async () => {
    const sku = product.first_skus[colour];
    if (!sku || adding) return;
    setAdding(true);
    try {
      await addToBag(sku);
    } finally {
      setAdding(false);
    }
  };

  const compare = () => {
    if (compared.length) {
      navigate(compareUrl(set.filter((sku) => !compared.includes(sku))));
      announceCompare(`Removed ${product.name} from comparison.`);
      return;
    }
    const sku = product.first_skus[colour];
    if (!sku) return;
    if (set.length >= config.compare_max) {
      announceCompare(`You can compare up to ${config.compare_max} products.`);
      return;
    }
    navigate(compareUrl([...set, sku]));
    announceCompare(`Added ${product.name} to comparison.`);
  };

  return (
    <article className="card" aria-label={product.name}>
      <div className="card-image">{shown && <img src={shown.image_url} alt="" width="600" height="600" loading="lazy" />}</div>
      <div className="card-body">
        <h3 className="card-title">
          <Link href={`/products/${product.slug}`}>{product.name}</Link>
        </h3>
        <div role="radiogroup" aria-label={`Colour for ${product.name}`} className="swatches">
          {product.colours.map((c) => (
            <label key={c.slug} className="swatch">
              <input
                type="radio"
                name={groupId}
                value={c.slug}
                checked={c.slug === colour}
                onChange={() => setColour(c.slug)}
                aria-label={c.name}
              />
              <span className="chip" style={{ background: colourHex(c.slug) }} />
            </label>
          ))}
        </div>
        <p className="card-price">
          <span className="price-now">
            {product.price_varies ? "From " : ""}
            {inr(product.min_price)}
          </span>{" "}
          {product.compare_at !== null && (
            <>
              <s className="price-was">{inr(product.compare_at)}</s>{" "}
              <span className="block tone-yellow">Save {product.save_percent}%</span>
            </>
          )}
        </p>
        <p>
          <span className={`block ${badgeTone(product.badge)}`}>{product.badge}</span>
        </p>
        <div className="card-actions">
          <button type="button" className="btn btn-primary" disabled={adding} aria-label={adding ? undefined : `Quick add ${product.name}`} onClick={() => void quickAdd()}>
            {adding ? "Adding" : "Quick add"}
          </button>
          <button type="button" className="btn" aria-pressed={compared.length > 0} aria-label={`Compare ${product.name}`} onClick={compare}>
            Compare
          </button>
          <button
            type="button"
            className="btn"
            aria-pressed={saved}
            aria-label={`Save ${product.name} to wishlist`}
            onClick={() => void toggleSave(product.slug, product.name, saved)}
          >
            {saved && <span aria-hidden="true">✓ </span>}Save
          </button>
        </div>
      </div>
    </article>
  );
}
