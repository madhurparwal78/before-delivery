import { useEffect, useState } from "react";
import type { FavouriteItem, Variant } from "../../shared/types";
import { request } from "./api";
import { useSession } from "./session";

/** Favourites a signed-in shopper has saved, kept on the server so they follow the account across devices. */
export function useFavourites() {
  const { user } = useSession();
  const [items, setItems] = useState<FavouriteItem[]>([]);
  useEffect(() => {
    if (!user) {
      setItems([]);
      return;
    }
    void request<{ items: FavouriteItem[] }>("/api/favourites").then((reply) => reply.ok && setItems(reply.data.items));
  }, [user]);
  const isSaved = (slug: string) => items.some((item) => item.product_slug === slug);
  /** Saves the variant, or removes the product's saved variants; returns the brief's status copy. */
  const toggle = async (slug: string, variant: Variant): Promise<string> => {
    if (!user) return "Sign in to save favourites.";
    if (isSaved(slug)) {
      const removing = items.filter((item) => item.product_slug === slug);
      await Promise.all(removing.map((item) => request(`/api/favourites/${encodeURIComponent(item.code)}`, { method: "DELETE" })));
      setItems((current) => current.filter((item) => item.product_slug !== slug));
      return "Removed from favourites.";
    }
    await request(`/api/favourites/${encodeURIComponent(variant.code)}`, { method: "PUT" });
    const reply = await request<{ items: FavouriteItem[] }>("/api/favourites");
    if (reply.ok) setItems(reply.data.items);
    return "Saved to favourites.";
  };
  return { items, isSaved, toggle };
}
