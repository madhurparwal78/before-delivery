import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { del, failureMessage, get, post } from "../lib/api";
import { signInHref, useAuth } from "../lib/auth";
import { HeartMorphIcon } from "../effects/morph";
import { Button } from "./Button";

interface WishlistItem {
  item_id: string;
  product_id: string;
}

interface WishlistButtonProps {
  productId: string;
  listingId: string | null;
}

/** The heart. The name stays "Add to wishlist"; `aria-pressed` says whether the product is saved. */
export function WishlistButton({ productId, listingId }: WishlistButtonProps): ReactNode {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [itemId, setItemId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const shopper = auth.status === "signedIn" && auth.account?.role === "shopper";

  useEffect(() => {
    if (!shopper) {
      setItemId(null);
      return;
    }
    void get<{ items: WishlistItem[] }>("/api/wishlist").then(
      (list) => setItemId(list.items.find((item) => item.product_id === productId)?.item_id ?? null),
      () => undefined,
    );
  }, [shopper, productId]);

  const toggle = async (): Promise<void> => {
    if (auth.status !== "signedIn") {
      navigate(signInHref(`${location.pathname}${location.search}`));
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      if (itemId) {
        await del(`/api/wishlist/${itemId}`);
        setItemId(null);
      } else {
        const saved = await post<WishlistItem>("/api/wishlist", listingId ? { product_id: productId, listing_id: listingId } : { product_id: productId });
        setItemId(saved.item_id);
      }
    } catch (error) {
      setMessage(failureMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const saved = itemId !== null;
  return (
    <>
      <Button aria-label="Add to wishlist" aria-pressed={saved} busy={busy} disabled={auth.status === "loading"} onClick={() => void toggle()}>
        <HeartMorphIcon saved={saved} />
        <span aria-hidden="true">{saved ? "saved to wishlist" : "wishlist"}</span>
      </Button>
      {message !== "" && (
        <p className="status" role="status">
          {message}
        </p>
      )}
    </>
  );
}
