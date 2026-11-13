import { useEffect, useMemo, useRef, useState } from "react";
import type { Product as ProductData, StockBadge, Variant } from "../../shared/api";
import { SIZE_LABELS, inr } from "../../shared/format";
import { Gallery } from "../components/Gallery";
import { GateGauge, type GaugeBag } from "../components/GateGauge";
import { Loading, ServerError } from "../components/Panel";
import { addToBag, toggleSave } from "../lib/actions";
import { colourHex } from "../lib/colours";
import { hasCabinFit } from "../../shared/cabin";
import { useLive, useLiveReset } from "../lib/live";
import { navigate, useParams, withQuery } from "../lib/router";
import { useApp } from "../lib/store";
import { useData } from "../lib/useData";
import "../styles/store.css";
import { NotFound } from "./NotFound";


function badgeTone(badge: string): string {
  if (badge === "Out of stock") return "tone-red";
  return badge === "In stock" ? "tone-teal" : "tone-yellow";
}

export function Product({ slug }: { slug: string }) {
  const product = useData<ProductData>(`/api/products/${slug}`);
  const params = useParams();
  const { wishlistSlugs } = useApp();
  const [updates, setUpdates] = useState("");
  const [adding, setAdding] = useState(false);
  const [patch, setPatch] = useState<Record<string, Partial<Variant>>>({});

  const data = product.data;
  const variants = useMemo(() => (data ? data.variants.map((v) => ({ ...v, ...patch[v.sku] })) : []), [data, patch]);
  const selected = variants.find((v) => v.sku === params.get("sku")) ?? variants[0];

  useEffect(() => setPatch({}), [data]);

  // Events that arrive while the product is still loading are announced once it lands, then re-read.
  const early = useRef<{ sku: string; text: string }[]>([]);
  useEffect(() => {
    if (!data || early.current.length === 0) return;
    const sku = params.get("sku") ?? data.variants[0]?.sku;
    const mine = early.current.filter((e) => data.variants.some((v) => v.sku === e.sku));
    early.current = [];
    const last = mine.filter((e) => e.sku === sku).at(-1);
    if (last) setUpdates(last.text);
    if (mine.length > 0) void product.reload();
  }, [data]);

  useLive("stock", (event) => {
    if (!data) {
      early.current.push({ sku: event.sku, text: event.badge });
      return;
    }
    if (!variants.some((v) => v.sku === event.sku)) return;
    setPatch((current) => ({ ...current, [event.sku]: { ...current[event.sku], available: event.available, badge: event.badge } }));
    if (event.sku === selected?.sku) setUpdates(event.badge);
  });
  useLive("price", (event) => {
    if (!data) {
      early.current.push({ sku: event.sku, text: `Price updated to ${inr(event.price)}.` });
      return;
    }
    if (!variants.some((v) => v.sku === event.sku)) return;
    setPatch((current) => ({ ...current, [event.sku]: { ...current[event.sku], price: event.price, compare_at: event.compare_at } }));
    if (event.sku === selected?.sku) setUpdates(`Price updated to ${inr(event.price)}.`);
    void product.reload();
  });
  useLiveReset(() => void product.reload());

  if (product.error?.status === 404) return <NotFound />;
  if (product.error && !data) return <ServerError />;
  if (!data || !selected) return <Loading />;

  const choose = (variant: Variant | undefined) => {
    if (!variant) return;
    const next = new URLSearchParams(window.location.search);
    next.set("sku", variant.sku);
    navigate(withQuery(window.location.pathname, Object.fromEntries(next)), { replace: true });
  };
  const colours = variants.filter((v, i) => variants.findIndex((w) => w.colour_slug === v.colour_slug) === i);
  const sizes = variants.filter((v) => v.colour_slug === selected.colour_slug);
  const pickColour = (colourSlug: string) =>
    choose(variants.find((v) => v.colour_slug === colourSlug && v.size_slug === selected.size_slug) ?? variants.find((v) => v.colour_slug === colourSlug));
  const out = selected.available === 0;
  const saved = wishlistSlugs.includes(data.slug);
  const airline = params.get("airline") ?? "skyline-indus";
  const bag: GaugeBag = {
    id: selected.sku,
    sku: selected.sku,
    label: data.name,
    colour: colourHex(selected.colour_slug),
    dimensions: selected.dimensions_cm,
    weight: selected.weight_kg,
  };

  const add = async () => {
    setAdding(true);
    try {
      await addToBag(selected.sku);
    } finally {
      setAdding(false);
    }
  };
  const changeAirline = (code: string) => {
    const next = new URLSearchParams(window.location.search);
    next.set("airline", code);
    navigate(withQuery(window.location.pathname, Object.fromEntries(next)), { replace: true });
  };
  const flip = async () => {
    await toggleSave(data.slug, data.name, saved);
    await product.reload();
  };

  return (
    <div className="page product">
      <div className="axis">
        <div className="main">
          <div className="product-top">
            <Gallery key={selected.colour_slug} images={selected.images} />
            <div className="product-info">
              <h1>{data.name}</h1>
              <p className="price">
                <span className="price-now">{inr(selected.price)}</span>
                {selected.compare_at !== null && (
                  <>
                    {" "}
                    <s className="price-was">{inr(selected.compare_at)}</s>{" "}
                    <span className="block tone-yellow">Save {selected.save_percent}%</span>
                  </>
                )}
              </p>
              <div role="radiogroup" aria-label="Colour" className="pills">
                {colours.map((v) => (
                  <label key={v.colour_slug} className="pill pill-colour">
                    <input type="radio" name="colour" checked={v.colour_slug === selected.colour_slug} onChange={() => pickColour(v.colour_slug)} aria-label={v.colour} />
                    <span>
                      <span className="chip" style={{ background: colourHex(v.colour_slug) }} />
                      {v.colour}
                    </span>
                  </label>
                ))}
              </div>
              <div role="radiogroup" aria-label="Size" className="pills">
                {sizes.map((v) => (
                  <label key={v.size_slug} className="pill">
                    <input type="radio" name="size" checked={v.size_slug === selected.size_slug} onChange={() => choose(v)} aria-label={SIZE_LABELS[v.size_slug] ?? v.size} />
                    <span>{SIZE_LABELS[v.size_slug] ?? v.size}</span>
                  </label>
                ))}
              </div>
              <p role="status" aria-label="Selected variant" className="selected-variant">
                {`SKU ${selected.sku} · ${inr(selected.price)} · ${selected.badge}`}
              </p>
              <p role="status" aria-label="Product updates" className="sr-only">
                {updates}
              </p>
              <p className="badge-line">
                <span className={`block ${badgeTone(selected.badge as StockBadge)}`}>{selected.badge}</span>
              </p>
              <button
                type="button"
                className="btn btn-primary add-to-bag"
                disabled={out || adding}
                aria-label={adding ? undefined : out ? "Add to bag, Out of stock" : "Add to bag"}
                onClick={() => void add()}
              >
                {adding ? "Adding" : out ? "Out of stock" : "Add to bag"}
              </button>
            </div>
          </div>
          {hasCabinFit(data.category) && (
            <GateGauge bags={[bag]} selectedId={bag.id} airline={airline} onAirline={changeAirline} />
          )}
        </div>
        <div className="zone">
          <table aria-label="Specifications" className="specs">
            <tbody>
              <tr>
                <th scope="row">Dimensions</th>
                <td>
                  {selected.dimensions_cm.height} × {selected.dimensions_cm.width} × {selected.dimensions_cm.depth} cm
                </td>
              </tr>
              <tr>
                <th scope="row">Weight</th>
                <td>{selected.weight_kg} kg</td>
              </tr>
              <tr>
                <th scope="row">Material</th>
                <td>{data.material}</td>
              </tr>
              <tr>
                <th scope="row">Warranty</th>
                <td>
                  {data.warranty_years} {data.warranty_years === 1 ? "year" : "years"}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="saves">Saved by {data.saves}</p>
          <button
            type="button"
            className="btn"
            aria-pressed={saved}
            aria-label={`Save ${data.name} to wishlist`}
            onClick={() => void flip()}
          >
            {saved && <span aria-hidden="true">✓ </span>}Save
          </button>
        </div>
      </div>
    </div>
  );
}
