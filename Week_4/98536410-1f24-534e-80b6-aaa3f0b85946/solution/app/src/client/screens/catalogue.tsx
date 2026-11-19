import { useEffect, useState } from "react";
import { Status } from "../controls";
import { api } from "../lib/api";
import { formatMilli } from "../lib/format";
import { SEARCH_DEBOUNCE_MS, useDebounced, useLatestRequest } from "../lib/hooks";
import { Link } from "../lib/router";
import type { Product } from "../types";

const ERROR_COPY = "Something went wrong. Try again.";

export function Catalogue() {
  const [term, setTerm] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [message, setMessage] = useState("");
  const requests = useLatestRequest();

  function search(text: string) {
    const token = requests.begin();
    setMessage("Searching...");
    api<{ count: number; products: Product[] }>("GET", `/api/products?q=${encodeURIComponent(text.trim())}`).then((answer) => {
      if (!requests.isLatest(token)) return;
      setProducts(answer.products);
      setMessage(`${answer.count} products found.`);
    }, () => {
      if (requests.isLatest(token)) setMessage(ERROR_COPY);
    });
  }

  const later = useDebounced(() => search(term), SEARCH_DEBOUNCE_MS);
  useEffect(() => search(""), []);

  return (
    <main className="storefront">
      <h1>Catalogue</h1>
      <label className="field-label" htmlFor="product-search">Search products</label>
      <input
        id="product-search" type="search" className="field" value={term}
        onChange={(event) => { setTerm(event.target.value); later(); }}
      />
      <Status label="Catalogue results" text={message} />
      <ul className="product-grid">
        {products.map((product) => (
          <li key={product.sku} className="product-card charcoal-panel">
            <Link to={`/products/${product.sku}`} className="product-link">{product.name}</Link>
            <p className="sku">{product.sku}</p>
            <p className="price">{formatMilli(product.unit_price_milli)}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
