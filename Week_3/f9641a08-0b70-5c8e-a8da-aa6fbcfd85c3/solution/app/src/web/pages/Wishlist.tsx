import { useEffect, useState } from "react";
import type { Product, Wishlist as WishlistData } from "../../shared/api";
import { ProductCard } from "../components/ProductCard";
import { Loading } from "../components/Panel";
import { api } from "../lib/api";
import { cardFromProduct } from "../lib/cardModel";
import { rememberCompare, useApp } from "../lib/store";
import { useParams } from "../lib/router";
import "../styles/store.css";

export function Wishlist() {
  const { wishlistSlugs } = useApp();
  const compare = useParams().get("compare") ?? "";
  const [order, setOrder] = useState<string[] | null>(null);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const slugKey = wishlistSlugs.join(",");

  useEffect(() => rememberCompare(compare), [compare]);

  useEffect(() => {
    let current = true;
    (async () => {
      const list = await api.get<WishlistData>("/api/wishlist");
      const newest = [...list.items].sort((a, b) => b.saved_at.localeCompare(a.saved_at)).map((i) => i.slug);
      const missing = newest.filter((slug) => !products[slug]);
      const loaded = await Promise.all(missing.map((slug) => api.get<Product>(`/api/products/${slug}`)));
      if (!current) return;
      setProducts((old) => ({ ...old, ...Object.fromEntries(loaded.map((p) => [p.slug, p])) }));
      setOrder(newest);
    })();
    return () => {
      current = false;
    };
  }, [slugKey]);

  if (order === null) return <Loading />;
  const shown = order.filter((slug) => wishlistSlugs.includes(slug) && products[slug]);

  if (shown.length === 0) {
    return (
      <div className="page">
        <section className="panel tone-teal" data-page="teal">
          <div>
            <h1 className="panel-kicker">Wishlist</h1>
            <p className="panel-text">Nothing saved yet.</p>
          </div>
        </section>
      </div>
    );
  }
  return (
    <div className="page wishlist">
      <div className="axis">
        <div className="main">
          <h1>Wishlist</h1>
          <div className="grid-cards">
            {shown.map((slug) => (
              <ProductCard key={slug} product={cardFromProduct(products[slug]!)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
