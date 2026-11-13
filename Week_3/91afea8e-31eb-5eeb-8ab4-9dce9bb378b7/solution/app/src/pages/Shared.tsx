import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Empty } from "../components/Empty";
import { ApiFailure, get } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCart } from "../lib/cart";
import { useTitle } from "../lib/hooks";
import type { Offer } from "../lib/types";
import { ItemGrid, ItemTile } from "./ItemGrid";

interface SharedItem {
  product_id: string;
  listing_id: string;
  title: string;
  image_url: string;
  price_paise: number;
}

interface SharedView {
  kind: "wishlist" | "cart";
  display_name: string;
  items: SharedItem[];
}

type Loaded = { view: SharedView } | { gone: string };

export default function Shared(): ReactNode {
  const { token = "" } = useParams();
  const auth = useAuth();
  const cart = useCart();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  useTitle(loaded && "view" in loaded ? `${loaded.view.display_name}'s ${loaded.view.kind}` : "shared link");

  useEffect(() => {
    setLoaded(null);
    get<SharedView>(`/api/shared/${token}`).then(
      (view) => setLoaded({ view }),
      (error: unknown) => {
        if (!(error instanceof ApiFailure)) throw error;
        setLoaded({ gone: error.body.message });
      },
    );
  }, [token]);

  const shopper = auth.status === "signedIn" && auth.account?.role === "shopper";

  const add = async (item: SharedItem): Promise<void> => {
    setBusy(item.listing_id);
    setStatus("");
    try {
      const offers = shopper ? null : await get<{ offers: Offer[] }>(`/api/products/${item.product_id}/offers`);
      const seller = offers?.offers.find((offer) => offer.listing_id === item.listing_id)?.seller_name ?? "";
      await cart.add({ listing_id: item.listing_id, product_id: item.product_id, title: item.title, seller_name: seller, image_url: item.image_url, price_paise: item.price_paise });
      setStatus(`${item.title} added to your cart.`);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      setStatus(error.body.message);
    } finally {
      setBusy(null);
    }
  };

  if (loaded === null) {
    return (
      <section className="panel panel--ground" aria-busy="true">
        <h1 className="sr-only">shared link</h1>
        <div className="skeleton" style={{ minHeight: 280 }} />
      </section>
    );
  }

  if ("gone" in loaded) {
    return (
      <div className="shared-gone">
        <Empty tone="black" sign="lost" as="h1">
          {loaded.gone}
        </Empty>
      </div>
    );
  }

  const { view } = loaded;
  return (
    <div className="listing">
      <section className="panel panel--raised listing__head">
        <h1>{`${view.display_name}'s ${view.kind}`}</h1>
      </section>
      <section className="panel panel--ground" aria-label={`Shared ${view.kind}`}>
        <p role="status" aria-label="Shared link updates" className="status">
          {status}
        </p>
        {view.items.length === 0 ? (
          <Empty tone="pink" sign="box">
            nothing here yet.
          </Empty>
        ) : (
          <ItemGrid label={`Shared ${view.kind} items`}>
            {view.items.map((item, index) => (
              <ItemTile key={item.listing_id} index={index} tile={{ key: item.listing_id, ...item }}>
                <Button variant="primary" small busy={busy === item.listing_id} onClick={() => void add(item)}>
                  {`Add ${item.title} to my cart`}
                </Button>
              </ItemTile>
            ))}
          </ItemGrid>
        )}
      </section>
    </div>
  );
}
