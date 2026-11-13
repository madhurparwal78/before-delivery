import { Star } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { promiseText, rupees } from "../../shared/format";
import { Button } from "../components/Button";
import { Empty } from "../components/Empty";
import { NotFound } from "../components/NotFound";
import { ApiFailure, failureMessage, get } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCart } from "../lib/cart";
import { useTitle } from "../lib/hooks";
import { usePincode } from "../lib/pincode";
import type { ListingSnapshot, Offer } from "../lib/types";
import "../styles/catalogue.css";

interface ProductHead {
  id: string;
  title: string;
  image_url: string;
}

export default function Offers(): ReactNode {
  const { id = "" } = useParams();
  const { pin: shopperPin } = usePincode();
  const [params] = useSearchParams();
  const fromUrl = params.get("pin") ?? "";
  const pin = /^[1-9]\d{5}$/.test(fromUrl) ? fromUrl : shopperPin;
  const cart = useCart();
  const waiting = useAuth().status === "loading";
  const [product, setProduct] = useState<ProductHead | null>(null);
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  useTitle(product ? `offers for ${product.title}` : "offers");

  useEffect(() => {
    let live = true;
    const query = pin ? `?pin=${pin}` : "";
    Promise.all([get<ProductHead>(`/api/products/${encodeURIComponent(id)}${query}`), get<{ offers: Offer[] }>(`/api/products/${encodeURIComponent(id)}/offers${query}`)]).then(
      ([head, list]) => {
        if (!live) return;
        setProduct(head);
        setOffers(list.offers);
      },
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

  const choose = async (offer: Offer): Promise<void> => {
    if (!product) return;
    const listing: ListingSnapshot = { listing_id: offer.listing_id, product_id: product.id, title: product.title, seller_name: offer.seller_name, image_url: product.image_url, price_paise: offer.price_paise };
    setChoosing(offer.listing_id);
    setStatus("");
    try {
      await cart.add(listing);
      setStatus(`Added ${product.title} from ${offer.seller_name} to your cart.`);
    } catch (error) {
      setStatus(failureMessage(error));
    } finally {
      setChoosing(null);
    }
  };

  return (
    <div className="offers-page">
      <section className="panel panel--ground">
        <h1>{product ? `offers for ${product.title}` : "offers"}</h1>
        {product && (
          <Link className="btn" to={`/p/${product.id}${pin ? `?pin=${pin}` : ""}`}>
            back to the product
          </Link>
        )}
      </section>
      <section className="panel panel--raised">
        {offers === null ? (
          <div className="skeleton" aria-busy="true" />
        ) : offers.length === 0 ? (
          <Empty tone="pink" sign="box">
            no offers yet.
          </Empty>
        ) : (
          <table className="offers" role="table" aria-label="Seller offers">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Seller</th>
                <th role="columnheader" scope="col">Price</th>
                <th role="columnheader" scope="col">Delivery</th>
                <th role="columnheader" scope="col">Landed price</th>
                <th role="columnheader" scope="col">Arrives by</th>
                <th role="columnheader" scope="col">Cash on delivery</th>
                <th role="columnheader" scope="col">
                  <span className="sr-only">Choose</span>
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {offers.map((offer) => (
                <tr role="row" key={offer.listing_id} className={offer.featured ? "offers__featured" : undefined}>
                  <td role="cell" data-label="Seller">
                    <strong>{offer.seller_name}</strong>
                    <span className="offers__rating">
                      <Star size={16} aria-hidden="true" />
                      {offer.seller_rating.toFixed(1)}
                    </span>
                    {offer.featured && <span className="chip">featured offer</span>}
                  </td>
                  <td role="cell" data-label="Price" className="amount">{rupees(offer.price_paise)}</td>
                  <td role="cell" data-label="Delivery" className="amount">{offer.delivery_fee_paise === 0 ? "free" : rupees(offer.delivery_fee_paise)}</td>
                  <td role="cell" data-label="Landed price" className="amount">{rupees(offer.landed_paise)}</td>
                  <td role="cell" data-label="Arrives by">{offer.promise_date ? promiseText(offer.promise_date) : "set a pincode"}</td>
                  <td role="cell" data-label="Cash on delivery">{offer.cod_available ? "available" : "not available"}</td>
                  <td role="cell" data-label="">
                    {offer.in_stock ? (
                      <Button variant={offer.featured ? "dark" : "primary"} busy={choosing === offer.listing_id} disabled={waiting} onClick={() => void choose(offer)}>
                        {`Choose ${offer.seller_name}`}
                      </Button>
                    ) : (
                      <span className="chip chip--pink">sold out</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="status" role="status">
          {status}
        </p>
      </section>
    </div>
  );
}
