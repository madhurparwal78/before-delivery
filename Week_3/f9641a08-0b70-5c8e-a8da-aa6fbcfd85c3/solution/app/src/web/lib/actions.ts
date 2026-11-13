import type { Cart, Wishlist } from "../../shared/api";
import { ApiFail, api } from "./api";
import { inr } from "../../shared/format";
import { announce, applyCart, applyWishlist } from "./store";

/** Adds one unit of `sku` to the bag and announces the result in Cart updates. */
export async function addToBag(sku: string): Promise<boolean> {
  try {
    const cart = await api.post<Cart>("/api/cart/lines", { sku, quantity: 1 });
    applyCart(cart);
    const line = cart.lines.find((l) => l.sku === sku);
    const notice = cart.notices[cart.notices.length - 1];
    if (notice) announce(notice);
    else if (line) announce(`Added ${line.product} — ${line.colour}, ${line.size} to your bag. Bag total ${inr(cart.totals.total)}.`);
    return true;
  } catch (failure) {
    if (failure instanceof ApiFail) announce(failure.message);
    else throw failure;
    return false;
  }
}

/** Saves or unsaves a product for the current session. */
export async function toggleSave(slug: string, name: string, saved: boolean): Promise<void> {
  const wishlist = saved ? await api.delete<Wishlist>(`/api/wishlist/${slug}`) : await api.put<Wishlist>(`/api/wishlist/${slug}`);
  applyWishlist(wishlist);
  announce(saved ? `Removed ${name} from your wishlist.` : `Saved ${name} to your wishlist.`);
}
