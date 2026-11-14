import { useMemo, useState } from "react";
import { EMPTY_PRICE_FILTER, filterPrices, PRICE_TYPES, parsePriceQuery, priceCounts, queryOfPrices, type PriceFilter } from "../../shared/prices";
import type { PriceItem } from "../../shared/types";
import { catalog } from "../boot";
import { Link, navigate, useLocation } from "../router";

const PAYMENT_LINES = { fixed: "Payment: half to start, half on handover.", custom: "Quoted after a 30-minute call." };

function Item({ item, open, onToggle }: { item: PriceItem; open: boolean; onToggle: () => void }) {
  const label = PRICE_TYPES.find((type) => type.id === item.type)?.label;
  return (
    <article className="price-item">
      <h2>{item.name}</h2>
      <p className="price-badge">{label}</p>
      <p className="price-text numeric">{item.price_text}</p>
      <p>Delivery: {item.delivery}</p>
      <p>Revisions: {item.revisions}</p>
      <button type="button" className="button button--quiet" aria-expanded={open} aria-controls={`details-${item.id}`} onClick={onToggle}>Details for {item.name}</button>
      <div id={`details-${item.id}`} hidden={!open} className="price-details">
        <ul>
          {item.inclusions.map((inclusion) => <li key={inclusion}>{inclusion}</li>)}
        </ul>
        <p>{PAYMENT_LINES[item.type]}</p>
        <Link href={`/contact?service=${item.category}&item=${item.id}`}>Enquire about {item.name}</Link>
      </div>
    </article>
  );
}

export function PricingPage() {
  const location = useLocation();
  const filter = useMemo(() => parsePriceQuery(location.search, catalog.services), [location.search]);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<string[]>([]);

  const shown = filterPrices(catalog.prices, filter);
  const counts = priceCounts(catalog.prices, catalog.services, filter);

  const apply = (next: PriceFilter) => {
    navigate(`/pricing${queryOfPrices(next)}`, { replace: true });
    const total = filterPrices(catalog.prices, next).length;
    setStatus(total === 0 ? "No items match these filters." : `Showing ${total} of ${catalog.prices.length} items`);
  };

  const toggle = (id: string) => setOpen((ids) => (ids.includes(id) ? ids.filter((candidate) => candidate !== id) : [...ids, id]));

  return (
    <section className="page" data-section="pricing">
      <h1 tabIndex={-1}>Price list</h1>
      <p className="lede prose">Illustrative prices in Indian rupees for a fictional studio. They are not a quote and not any real studio's published prices.</p>
      <div className="price-filters">
        <div role="radiogroup" aria-labelledby="category-label" className="radio-group">
          <p id="category-label" className="group-label" aria-hidden="true">Category</p>
          <label className="radio"><input type="radio" name="category" checked={filter.category === null} onChange={() => apply({ ...filter, category: null })} /><span>All ({counts.allCategories})</span></label>
          {catalog.services.map((service) => (
            <label key={service.id} className="radio">
              <input type="radio" name="category" checked={filter.category === service.id} onChange={() => apply({ ...filter, category: service.id })} />
              <span>{service.name} ({counts.categories[service.id]})</span>
            </label>
          ))}
        </div>
        <div role="radiogroup" aria-labelledby="type-label" className="radio-group">
          <p id="type-label" className="group-label" aria-hidden="true">Price type</p>
          <label className="radio"><input type="radio" name="type" checked={filter.type === null} onChange={() => apply({ ...filter, type: null })} /><span>All types ({counts.allTypes})</span></label>
          {PRICE_TYPES.map((type) => (
            <label key={type.id} className="radio">
              <input type="radio" name="type" checked={filter.type === type.id} onChange={() => apply({ ...filter, type: type.id })} />
              <span>{type.label} ({counts.types[type.id]})</span>
            </label>
          ))}
        </div>
      </div>
      <div role="status" aria-label="Price results" className="status">{status}</div>
      {shown.length === 0 && <button type="button" className="button button--primary" onClick={() => apply(EMPTY_PRICE_FILTER)}>Show all items</button>}
      <div className="price-grid">
        {shown.map((item) => <Item key={item.id} item={item} open={open.includes(item.id)} onToggle={() => toggle(item.id)} />)}
      </div>
    </section>
  );
}
