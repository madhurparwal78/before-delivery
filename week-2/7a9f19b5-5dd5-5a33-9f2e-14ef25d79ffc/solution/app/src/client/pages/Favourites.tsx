import { useEffect, useState } from "react";
import type { Product } from "../../shared/types";
import { EmptyDrawing } from "../components/Drawings";
import { ProductCard } from "../components/ProductCard";
import { request } from "../lib/api";
import { useFavourites } from "../lib/favourites";
import { Link } from "../lib/router";
import { useSession } from "../lib/session";

export function Favourites() {
  const { user, ready, seesTrade } = useSession();
  const favourites = useFavourites();
  const [products, setProducts] = useState<Product[]>([]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    document.title = "Favourites · Lightfall";
    void request<{ products: Product[] }>("/api/catalogue").then((reply) => reply.ok && setProducts(reply.data.products));
  }, [user]);

  return (
    <div className="favourites">
      <header className="page-head">
        <p className="eyebrow">Saved fittings</p>
        <h1>Favourites</h1>
      </header>
      {ready && !user && (
        <div className="empty-state">
          <EmptyDrawing />
          <p>Sign in to see the fittings you have saved.</p>
          <Link href="/signin?next=/favourites" className="button button--primary">
            Sign in
          </Link>
        </div>
      )}
      {user && favourites.items.length === 0 && (
        <div className="empty-state">
          <EmptyDrawing />
          <p>Nothing saved yet. Choose Save on any fitting to keep it here.</p>
          <Link href="/catalogue" className="button button--primary">
            Browse the catalogue
          </Link>
        </div>
      )}
      {user && favourites.items.length > 0 && (
        <div className="card-grid card-grid--wide">
          {favourites.items.map((item) => {
            const product = products.find((p) => p.slug === item.product_slug);
            const variant = product?.variants.find((v) => v.code === item.code);
            if (!product || !variant) return null;
            return (
              <ProductCard
                key={item.code}
                product={product}
                variant={variant}
                seesTrade={seesTrade}
                saved
                onToggleSave={(v) => void favourites.toggle(product.slug, v).then(setNotice)}
              />
            );
          })}
        </div>
      )}
      <p role="status" className="page-notice">
        {notice}
      </p>
    </div>
  );
}
