import { Star } from "lucide-react";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { promiseText, rupees } from "../../shared/format";
import type { Hit } from "../lib/types";
import { bindRipple } from "../effects/ripple";
import { openProduct } from "../pages/catalogue/transition";
import { ProductArt } from "./ProductArt";

export type Field = "raised" | "black" | "pink";

interface ProductCardProps {
  hit: Hit;
  field: Field;
  /** Columns of the 24-column grid this panel spans. */
  span: number;
  /** The pincode the delivery promise is for; empty when none is set. */
  pin: string;
  compared: boolean;
  onCompare: (hit: Hit) => void;
}

const FIELD_CLASS: Record<Field, string> = { raised: "", black: " card--black", pink: " card--pink" };

/** One product panel. The `<img>` stays the first image inside the article: the ripple and the card-to-page morph hang on it. */
export function ProductCard({ hit, field, span, pin, compared, onCompare }: ProductCardProps): ReactNode {
  const navigate = useNavigate();
  const media = useRef<HTMLDivElement>(null);
  const to = `/p/${hit.product_id}${pin ? `?pin=${pin}` : ""}`;

  useEffect(() => {
    const frame = media.current as HTMLDivElement;
    return bindRipple(frame, frame.querySelector("img") as HTMLImageElement);
  }, []);

  const open = (event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault: () => void }): void =>
    openProduct(event, navigate, to, media.current?.querySelector("img") ?? null);

  return (
    <li className="catalogue__cell" style={{ "--span": span } as CSSProperties}>
      <article className={`card product-card${FIELD_CLASS[field]}`} aria-label={hit.title} data-cursor="card">
        <div className="product-card__media" ref={media} data-product={hit.product_id} onClick={open}>
          <ProductArt src={hit.image_url} alt={hit.title} category={hit.category} />
        </div>
        <div className="product-card__body">
          <p className="product-card__brand muted">{hit.brand}</p>
          <h2 className="product-card__title">
            <Link to={to} onClick={open}>
              {hit.title}
            </Link>
          </h2>
          <p className="price">{rupees(hit.price_paise)}</p>
          <p className="product-card__facts">
            <span className="product-card__rating">
              <Star size={18} aria-hidden="true" />
              {hit.rating.toFixed(1)} rating
            </span>
            <span>sold by {hit.seller_name}</span>
          </p>
          {!hit.in_stock && <p className="chip chip--pink product-card__soldout">sold out</p>}
          {pin !== "" && hit.delivers !== null && (
            <p className="product-card__promise">
              {hit.delivers ? `delivers to ${pin}` : `doesn't deliver to ${pin}`}
              {hit.delivers && hit.promise_date && (
                <>
                  <br />
                  <strong>{`arrives by ${promiseText(hit.promise_date)}`}</strong>
                </>
              )}
            </p>
          )}
          <label className="choice product-card__compare">
            <input type="checkbox" aria-label={`Compare ${hit.title}`} checked={compared} onChange={() => onCompare(hit)} />
            <span aria-hidden="true">Compare</span>
          </label>
        </div>
      </article>
    </li>
  );
}
