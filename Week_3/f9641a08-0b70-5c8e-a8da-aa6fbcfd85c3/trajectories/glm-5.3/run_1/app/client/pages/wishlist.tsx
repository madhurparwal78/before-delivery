import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { store, useStore } from '../lib/store.js';
import { announce, LoadingPanel } from '../app.js';
import { BagLines, Totals } from '../components/baglines.js';

export function Wishlist(): JSX.Element {
  useStore();
  const [cards, setCards] = useState<{ slug: string; name: string; image: string; price: number; badge: string }[] | null>(null);

  useEffect(() => {
    void store.loadWishlist();
  }, []);

  useEffect(() => {
    void (async () => {
      const items = store.wishlist.items;
      const out = [];
      for (const item of items) {
        const detail = await api.get<{ name: string; variants: { sku: string; price: number; badge: string; available: number; images: { url: string }[] }[]; slug: string }>(`/api/products/${item.slug}`).catch(() => null);
        if (detail === null) continue;
        const first = detail.variants[0];
        const stock = detail.variants.reduce((sum, v) => sum + v.available, 0);
        out.push({ slug: item.slug, name: detail.name, image: first.images[0]?.url ?? '', price: first.price, badge: stock <= 0 ? 'Out of stock' : stock <= 3 ? `Only ${stock} left` : 'In stock' });
      }
      setCards(out);
    })();
  }, [store.wishlist.count]);

  const remove = async (slug: string, name: string): Promise<void> => {
    store.wishlist = await api.delete(`/api/wishlist/${slug}`);
    store.emit();
    announce('cart-updates', `Removed ${name} from your wishlist.`);
  };

  if (cards === null) return <LoadingPanel />;

  return (
    <div class="wishlist-page">
      <h1>Wishlist</h1>
      {cards.length === 0 ? (
        <section class="panel empty-panel"><p>Nothing saved yet.</p></section>
      ) : (
        <ul class="product-grid wishlist-grid" role="list">
          {cards.map((card) => (
            <li key={card.slug}>
              <article aria-label={card.name} class="product-card">
                <a href={`/products/${card.slug}`} onClick={(e) => { e.preventDefault(); navigate(`/products/${card.slug}`); }}>
                  <img src={card.image} alt={`${card.name}`} />
                  <h2>{card.name}</h2>
                </a>
                <p class="price">₹{card.price}</p>
                <p class={`badge ${card.badge === 'Out of stock' ? 'out' : ''}`}>{card.badge}</p>
                <button class="secondary" aria-pressed="true" onClick={() => { void remove(card.slug, card.name); }}>Remove from wishlist</button>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Bag(): JSX.Element {
  useStore();
  return (
    <div class="bag-page">
      <h1>Your bag</h1>
      <div class="bag-layout">
        <aside class="left-zone"><Totals /></aside>
        <div class="bag-lines-zone"><BagLines /></div>
      </div>
    </div>
  );
}
