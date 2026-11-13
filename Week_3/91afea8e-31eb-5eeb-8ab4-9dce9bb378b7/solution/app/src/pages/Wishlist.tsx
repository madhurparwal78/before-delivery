import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Button } from "../components/Button";
import { Empty } from "../components/Empty";
import { NotFound } from "../components/NotFound";
import { ShareDialog } from "../components/ShareDialog";
import { ApiFailure, del, failureMessage, get } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCart } from "../lib/cart";
import { useTitle } from "../lib/hooks";
import { ItemGrid, ItemTile } from "./ItemGrid";

interface WishlistItem {
  item_id: string;
  product_id: string;
  listing_id: string;
  title: string;
  image_url: string;
  price_paise: number;
}

function WishlistBody(): ReactNode {
  const cart = useCart();
  const [items, setItems] = useState<WishlistItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [updates, setUpdates] = useState("");
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    get<{ items: WishlistItem[] }>("/api/wishlist").then(
      (reply) => setItems(reply.items),
      (error: unknown) => {
        if (!(error instanceof ApiFailure)) throw error;
        setItems([]);
        setUpdates(failureMessage(error));
      },
    );
  }, []);

  const drop = async (item: WishlistItem): Promise<void> => {
    await del(`/api/wishlist/${item.item_id}`);
    setItems((list) => (list ?? []).filter((entry) => entry.item_id !== item.item_id));
  };

  const act = async (item: WishlistItem, work: () => Promise<string>): Promise<void> => {
    setBusy(item.item_id);
    try {
      setUpdates(await work());
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      setUpdates(error.body.message);
    } finally {
      setBusy(null);
    }
  };

  const remove = (item: WishlistItem): Promise<void> =>
    act(item, async () => {
      await drop(item);
      return `${item.title} removed from your wishlist.`;
    });

  const move = (item: WishlistItem): Promise<void> =>
    act(item, async () => {
      await cart.add({ listing_id: item.listing_id, product_id: item.product_id, title: item.title, seller_name: "", image_url: item.image_url, price_paise: item.price_paise });
      await drop(item);
      return `${item.title} moved to your cart.`;
    });

  return (
    <div className="listing">
      <section className="panel panel--raised listing__head">
        <h1>wishlist</h1>
        <Button variant="yellow" onClick={() => setSharing(true)}>
          Share wishlist
        </Button>
      </section>
      <section className="panel panel--ground" aria-label="Saved items">
        <p role="status" aria-label="Wishlist updates" className="status">
          {updates}
        </p>
        {items === null && <div className="skeleton" aria-busy="true" style={{ minHeight: 280 }} />}
        {items !== null && items.length === 0 && (
          <Empty tone="pink" sign="box">
            nothing saved yet. the bazaar is waiting.
          </Empty>
        )}
        {items !== null && items.length > 0 && (
          <ItemGrid label="Wishlist items">
            {items.map((item, index) => (
              <ItemTile key={item.item_id} index={index} tile={{ key: item.item_id, ...item }}>
                <Button variant="primary" small busy={busy === item.item_id} onClick={() => void move(item)}>
                  {`Move ${item.title} to cart`}
                </Button>
                <Button small disabled={busy === item.item_id} onClick={() => void remove(item)}>
                  {`Remove ${item.title}`}
                </Button>
              </ItemTile>
            ))}
          </ItemGrid>
        )}
      </section>
      {sharing && <ShareDialog kind="wishlist" onClose={() => setSharing(false)} />}
    </div>
  );
}

export default function Wishlist(): ReactNode {
  useTitle("wishlist");
  const auth = useAuth();
  if (auth.status === "loading") {
    return (
      <section className="panel panel--ground" aria-busy="true">
        <div className="skeleton" style={{ minHeight: 240 }} />
      </section>
    );
  }
  if (auth.status === "signedOut" || !auth.account) return <Navigate to="/signin?next=/wishlist" replace />;
  if (auth.account.role !== "shopper") return <NotFound />;
  return <WishlistBody />;
}
