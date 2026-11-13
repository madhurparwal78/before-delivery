import { Star } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { rupees } from "../../shared/format";
import { AddToCart, BuyNow } from "../components/AddToCart";
import { NotFound } from "../components/NotFound";
import { WishlistButton } from "../components/WishlistButton";
import { useCustomCursor } from "../effects/cursor";
import { ApiFailure, get } from "../lib/api";
import { useTitle } from "../lib/hooks";
import { usePincode } from "../lib/pincode";
import type { ListingSnapshot, Offer } from "../lib/types";
import { Delivery, EmiPlans, loadViewer, ProductViewer } from "./catalogue/ProductParts";
import { holdBackNavigation } from "./catalogue/transition";
import "../styles/catalogue.css";

interface ProductDetail {
  id: string;
  title: string;
  brand: string;
  category: string;
  rating: number;
  description: string;
  specs: Record<string, string | number>;
  image_url: string;
  offers_count: number;
  featured_offer: Offer | null;
}

const label = (name: string): string => name.replace(/_/g, " ");

export default function Product(): ReactNode {
  const { id = "" } = useParams();
  const { pin: shopperPin } = usePincode();
  const [params] = useSearchParams();
  const fromUrl = params.get("pin") ?? "";
  const pin = shopperPin ?? (/^[1-9]\d{5}$/.test(fromUrl) ? fromUrl : null);
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [missing, setMissing] = useState(false);

  useCustomCursor();
  useTitle(product?.title ?? "product");

  useEffect(() => {
    void loadViewer();
  }, []);

  useEffect(() => holdBackNavigation(id), [id]);

  useEffect(() => {
    let live = true;
    setMissing(false);
    get<ProductDetail>(`/api/products/${encodeURIComponent(id)}${pin ? `?pin=${pin}` : ""}`).then(
      (found) => live && setProduct(found),
      (error: unknown) => {
        if (!(error instanceof ApiFailure)) throw error;
        if (live) setMissing(true);
      },
    );
    return () => {
      live = false;
    };
  }, [id, pin]);

  if (missing) return <NotFound />;
  if (!product || product.id !== id) {
    return (
      <div className="panel panel--ground" aria-busy="true">
        <div className="skeleton" style={{ minHeight: 480 }} />
      </div>
    );
  }

  const offer = product.featured_offer;
  const listing: ListingSnapshot | null = offer
    ? { listing_id: offer.listing_id, product_id: product.id, title: product.title, seller_name: offer.seller_name, image_url: product.image_url, price_paise: offer.price_paise }
    : null;
  const unavailable = !offer || !offer.in_stock;
  const offers = `/p/${product.id}/offers${pin ? `?pin=${pin}` : ""}`;

  return (
    <div className="product">
      <section className="product__hero panel panel--ground">
        <div className="product__grid">
          <div className="viewer-panel card card--black" style={{ viewTransitionName: "product-hero" }}>
            <ProductViewer productId={product.id} category={product.category} title={product.title} imageUrl={product.image_url} />
          </div>
          <div className="product__details">
            <p className="muted product__kicker">{`${product.brand} · ${product.category}`}</p>
            <h1>{product.title}</h1>
            <p className="product__rating">
              <Star size={20} aria-hidden="true" />
              {product.rating.toFixed(1)} rating
            </p>
            {offer ? (
              <>
                <p className="price">{rupees(offer.price_paise)}</p>
                <p className="muted">
                  {`sold by ${offer.seller_name}`}
                  {offer.delivery_fee_paise > 0 ? `, plus ${rupees(offer.delivery_fee_paise)} delivery` : ", free delivery"}
                </p>
              </>
            ) : (
              <p className="shout shout--small">sold out.</p>
            )}
            {offer && !offer.in_stock && <p className="chip chip--yellow">sold out</p>}
            <div className="product__actions">
              <AddToCart listing={listing} disabled={unavailable} />
              <BuyNow listing={listing} disabled={unavailable} />
              <WishlistButton productId={product.id} listingId={offer?.listing_id ?? null} />
            </div>
            <Delivery offer={offer} pin={pin} />
            <Link className="btn product__offers" to={offers}>
              {`See all ${product.offers_count} offers`}
            </Link>
          </div>
        </div>
      </section>
      <section className="panel panel--black product__about">
        <h2>about this item</h2>
        <p>{product.description}</p>
        <dl className="product__specs">
          {Object.entries(product.specs).map(([name, value]) => (
            <div key={name} className="product__spec">
              <dt className="muted">{label(name)}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="panel panel--raised product__emi">
        <h2>emi plans</h2>
        <EmiPlans listingId={offer?.listing_id ?? null} />
      </section>
    </div>
  );
}
