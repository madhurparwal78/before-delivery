import { useEffect, useState } from "react";
import { hasCabinFit } from "../../shared/cabin";
import type { Fit, Product, SearchResponse, Variant } from "../../shared/api";
import { inr } from "../../shared/format";
import { GateGauge, type GaugeBag } from "../components/GateGauge";
import { Panel } from "../components/Panel";
import { ApiFail, api } from "../lib/api";
import { compareUrl } from "../lib/catalogue";
import { colourHex } from "../lib/colours";
import { navigate, useParams, withQuery } from "../lib/router";
import { announceCompare, rememberCompare, useApp } from "../lib/store";
import "../styles/store.css";

interface Item {
  product: Product;
  variant: Variant;
}

const resolved = new Map<string, Promise<Item | null>>();

/** Finds the product that holds `sku` (SKUs are searchable) and its detail. */
function resolve(sku: string): Promise<Item | null> {
  let found = resolved.get(sku);
  if (!found) {
    found = (async () => {
      const search = await api.get<SearchResponse>(`/api/search?q=${encodeURIComponent(sku)}`);
      for (const result of search.results) {
        if (!result.skus.includes(sku)) continue;
        const product = await api.get<Product>(`/api/products/${result.slug}`);
        const variant = product.variants.find((v) => v.sku === sku);
        if (variant) return { product, variant };
      }
      return null;
    })();
    found.then((item) => item ?? resolved.delete(sku), () => resolved.delete(sku));
    resolved.set(sku, found);
  }
  return found;
}

type Verdicts = Record<string, Fit | null>;

export function Compare() {
  const params = useParams();
  const { compareStatus } = useApp();
  const key = params.get("compare") ?? "";
  const set = key.split(",").filter(Boolean);
  const airline = params.get("airline") ?? "skyline-indus";
  const [items, setItems] = useState<Item[] | null>(null);
  const [verdicts, setVerdicts] = useState<Verdicts>({});
  const [chosen, setChosen] = useState("");

  useEffect(() => rememberCompare(key), [key]);

  useEffect(() => {
    let current = true;
    Promise.all(key.split(",").filter(Boolean).map(resolve)).then((list) => {
      if (current) setItems(list.filter((i): i is Item => i !== null));
    });
    return () => {
      current = false;
    };
  }, [key]);

  useEffect(() => {
    if (!items) return;
    let current = true;
    Promise.all(
      items.map(async (item): Promise<[string, Fit | null]> => {
        if (!hasCabinFit(item.product.category)) return [`${item.variant.sku}|${airline}`, null];
        try {
          return [`${item.variant.sku}|${airline}`, await api.get<Fit>(`/api/fit?sku=${encodeURIComponent(item.variant.sku)}&airline=${encodeURIComponent(airline)}`)];
        } catch (failure) {
          if (failure instanceof ApiFail && failure.status === 422) return [`${item.variant.sku}|${airline}`, null];
          throw failure;
        }
      }),
    ).then((pairs) => {
      if (current) setVerdicts((old) => ({ ...old, ...Object.fromEntries(pairs) }));
    });
    return () => {
      current = false;
    };
  }, [items, airline]);

  const fitting = (items ?? []).filter((i) => verdicts[`${i.variant.sku}|${airline}`]);
  const bags: GaugeBag[] = fitting.map((i) => ({
    id: i.variant.sku,
    sku: i.variant.sku,
    label: i.product.name,
    colour: colourHex(i.variant.colour_slug),
    dimensions: i.variant.dimensions_cm,
    weight: i.variant.weight_kg,
  }));
  const selectedId = bags.some((b) => b.id === chosen) ? chosen : (bags[0]?.id ?? "");

  const remove = (item: Item) => {
    navigate(compareUrl(set.filter((sku) => sku !== item.variant.sku)));
    announceCompare(`Removed ${item.product.name} from comparison.`);
  };
  const changeAirline = (code: string) => {
    const next = new URLSearchParams(window.location.search);
    next.set("airline", code);
    navigate(withQuery(window.location.pathname, Object.fromEntries(next)), { replace: true });
  };

  return (
    <div className="page compare">
      <div className="axis">
        <div className="main">
          <h1>Compare</h1>
          <p role="status" aria-label="Compare updates" aria-live="polite" className="sr-only">
            {compareStatus?.text ?? ""}
          </p>
          {set.length === 0 || (items && items.length === 0) ? (
            <Panel tone="surface">Nothing to compare yet.</Panel>
          ) : (
            items && (
              <div className="table-scroll" tabIndex={0} role="region" aria-label="Comparison table">
                <table aria-label="Compare products" className="compare-table">
                  <thead>
                    <tr>
                      <td />
                      {items.map((item) => (
                        <th key={item.variant.sku} scope="col">
                          <span className="compare-name">{item.product.name}</span>
                          <span className="muted compare-variant">
                            {item.variant.colour}, {item.variant.size}
                          </span>
                          <button type="button" className="btn" onClick={() => remove(item)}>
                            Remove {item.product.name} from comparison
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">Image</th>
                      {items.map((item) => (
                        <td key={item.variant.sku}>
                          {item.variant.images[0] && <img src={item.variant.images[0].url} alt={item.variant.images[0].alt} width="160" height="160" />}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row">Price</th>
                      {items.map((item) => (
                        <td key={item.variant.sku}>{inr(item.variant.price)}</td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row">Dimensions</th>
                      {items.map((item) => (
                        <td key={item.variant.sku}>
                          {item.variant.dimensions_cm.height} × {item.variant.dimensions_cm.width} × {item.variant.dimensions_cm.depth} cm
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row">Weight</th>
                      {items.map((item) => (
                        <td key={item.variant.sku}>{item.variant.weight_kg} kg</td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row">Material</th>
                      {items.map((item) => (
                        <td key={item.variant.sku}>{item.product.material}</td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row">Warranty</th>
                      {items.map((item) => (
                        <td key={item.variant.sku}>
                          {item.product.warranty_years} {item.product.warranty_years === 1 ? "year" : "years"}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row">Cabin verdict</th>
                      {items.map((item) => {
                        const key2 = `${item.variant.sku}|${airline}`;
                        const fit = verdicts[key2];
                        return (
                          <td key={item.variant.sku}>
                            {key2 in verdicts ? (fit ? fit.verdict : "No cabin fit for this item.") : ""}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            )
          )}
          {bags.length > 0 && <GateGauge bags={bags} selectedId={selectedId} onSelect={setChosen} airline={airline} onAirline={changeAirline} />}
        </div>
      </div>
    </div>
  );
}
