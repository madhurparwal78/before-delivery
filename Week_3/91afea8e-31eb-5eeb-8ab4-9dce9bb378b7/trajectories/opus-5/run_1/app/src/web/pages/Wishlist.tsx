/** The wishlist and its one share link. */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api.ts';
import { Link } from '../router.tsx';
import { useCart } from '../state.tsx';
import { Amount, PendingButton } from '../components/ui.tsx';
import { ShareDialog } from '../components/ShareDialog.tsx';
import { ProductImage } from '../effects/visuals.tsx';
import type { WishlistItem } from '../../shared/types.js';

export function WishlistPage(): ReactNode {
  const { addToCart } = useCart();
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [shareOpen, setShareOpen] = useState(false);

  const load = async (): Promise<void> => {
    const response = await api<{ items: WishlistItem[] }>('/api/wishlist');
    setItems(response.items);
  };

  useEffect(() => {
    void load().catch(() => setItems([]));
  }, []);

  return (
    <>
      <h1>wishlist</h1>
      <button type="button" className="btn btn-quiet" onClick={() => setShareOpen(true)}>
        Share wishlist
      </button>
      <ul className="plain grid grid-2 grid-3">
        {items.map((item) => (
          <li key={item.item_id}>
            <article className="panel" aria-label={item.title}>
              <Link to={`/p/${item.product_id}`}>
                <ProductImage src={item.image_url} alt={item.title} />
              </Link>
              <h4>{item.title}</h4>
              <p className="price">
                <Amount paise={item.price_paise} />
              </p>
              <PendingButton
                label={`Add ${item.title} to my cart`}
                onPress={() =>
                  addToCart({
                    listing_id: item.listing_id,
                    product_id: item.product_id,
                    title: item.title,
                    price_paise: item.price_paise,
                    quantity: 1,
                  })
                }
              />
              <PendingButton
                label={`Remove ${item.title}`}
                className="btn btn-pink"
                onPress={async () => {
                  await api(`/api/wishlist/${item.item_id}`, { method: 'DELETE' });
                  await load();
                }}
              />
            </article>
          </li>
        ))}
      </ul>
      {items.length === 0 ? <p className="muted">nothing saved yet</p> : null}
      <ShareDialog kind="wishlist" open={shareOpen} onClose={() => setShareOpen(false)} />
    </>
  );
}
