import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Status } from "../controls";
import { api } from "../lib/api";
import { Figure } from "../lib/figure";
import { focusById, focusIdOf } from "../lib/focus";
import { formatMilli } from "../lib/format";
import { useLatestRequest } from "../lib/hooks";
import { MOTION, commit, easeOutCubic, reducedMotion } from "../lib/motion";
import { loadScreen, saveScreen } from "../lib/persist";
import { useMe } from "../session";
import { CART_ERROR, cartTotalCopy, useCart } from "../cartState";
import type { AvailabilityShop, Cart, Product } from "../types";

const AREAS = [
  { name: "Lisboa", lat: 38.7223, lon: -9.1393 },
  { name: "Porto", lat: 41.1579, lon: -8.6291 },
  { name: "Faro", lat: 37.0194, lon: -7.9304 },
  { name: "Coimbra", lat: 40.2033, lon: -8.4103 },
  { name: "Braga", lat: 41.5454, lon: -8.4265 },
  { name: "Ponta Delgada", lat: 37.7412, lon: -25.6756 },
  { name: "Angra do Heroísmo", lat: 38.655, lon: -27.221 },
] as const;

const QUANTITY_ERROR = "Enter a whole number from 1 to 999.";

interface Memory {
  quantity: string;
  focus: string | null;
}

function RankedList({ shops, chosen, onCollect }: { shops: AvailabilityShop[]; chosen: string | null; onCollect: (id: string) => void }) {
  const nodes = useRef(new Map<string, HTMLLIElement>());
  const before = useRef(new Map<string, number>());
  const [phase, setPhase] = useState<"moving" | "settled">("settled");
  const frame = useRef(0);

  // each shop keeps its node and travels from its old place to its new rank
  useLayoutEffect(() => {
    const after = new Map<string, number>();
    for (const [id, node] of nodes.current) after.set(id, node.offsetTop);
    const moves = new Map<string, number>();
    if (!reducedMotion()) {
      for (const id of nodes.current.keys()) {
        const was = before.current.get(id);
        const now = after.get(id);
        if (was !== undefined && now !== undefined && was !== now) moves.set(id, was - now);
      }
    }
    before.current = after;
    if (moves.size === 0) return undefined;
    window.cancelAnimationFrame(frame.current);
    for (const [id, delta] of moves) nodes.current.get(id)?.style.setProperty("transform", `translateY(${delta}px)`);
    setPhase("moving");
    let started: number | null = null;
    const step = (now: number) => {
      started ??= now;
      const progress = Math.min(1, (now - started) / MOTION.rankTravelMs);
      for (const [id, delta] of moves) {
        nodes.current.get(id)?.style.setProperty("transform", progress >= 1 ? "none" : `translateY(${delta * (1 - easeOutCubic(progress))}px)`);
      }
      if (progress >= 1) commit(() => setPhase("settled"));
      else frame.current = window.requestAnimationFrame(step);
    };
    frame.current = window.requestAnimationFrame(step);
    return undefined;
  }, [shops]);

  return (
    <ul className="ranked" aria-label="Shops with this item" data-phase={phase}>
      {shops.map((shop, index) => (
        <li
          key={shop.store_id} data-store-id={shop.store_id} data-rank={index + 1}
          ref={(node) => { if (node) nodes.current.set(shop.store_id, node); else nodes.current.delete(shop.store_id); }}
        >
          <div className="ranked-name">
            <strong>{shop.name}</strong>
            <span>{shop.city}</span>
          </div>
          <p className="ranked-figures">
            <Figure kind="distance" value={shop.distance_km} unit="km" /> km · <Figure kind="shop-available" value={shop.available} /> available
          </p>
          <p className="ranked-state"><span className="word" style={{ visibility: shop.holdable ? "hidden" : "visible" }}>Suspended</span></p>
          <button
            type="button" className="btn" aria-pressed={chosen === shop.store_id} data-focus-id={`collect:${shop.store_id}`}
            onClick={() => onCollect(shop.store_id)}
          >
            Collect from {shop.name}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ProductPage({ sku }: { sku: string }) {
  const me = useMe();
  const key = `product:${sku}`;
  const saved = useMemo(() => loadScreen<Memory>(me.user.id, key), [me.user.id, key]);
  const [product, setProduct] = useState<Product | null>(null);
  const [ready, setReady] = useState(false);
  const [shops, setShops] = useState<AvailabilityShop[]>([]);
  const [areaName, setAreaName] = useState("");
  const [quantity, setQuantity] = useState(saved?.quantity ?? "1");
  const [quantityError, setQuantityError] = useState("");
  const [updates, setUpdates] = useState("");
  const [ranking, setRanking] = useState("");
  const adding = useRef(false);
  const root = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(saved?.focus ?? null);
  const memory = useRef<Memory>({ quantity: saved?.quantity ?? "1", focus: saved?.focus ?? null });
  const rankings = useLatestRequest();
  const { cart, latest, apply, change } = useCart(setUpdates);

  const remember = (patch: Partial<Memory>) => {
    memory.current = { ...memory.current, ...patch };
    saveScreen(me.user.id, key, memory.current);
  };

  const rank = useCallback(async (area: { lat: number; lon: number }, label: string, save: boolean) => {
    const token = rankings.begin();
    setRanking("Ranking shops...");
    try {
      if (save) await api<Cart>("PUT", "/api/cart/area", area).then(apply);
      const answer = await api<{ shops: AvailabilityShop[] }>("GET", `/api/products/${sku}/availability?lat=${area.lat}&lon=${area.lon}`);
      if (!rankings.isLatest(token)) return;
      setShops(answer.shops);
      setRanking(`${answer.shops.length} shops ranked from ${label}.`);
    } catch {
      if (rankings.isLatest(token)) setRanking(CART_ERROR);
    }
  }, [apply, rankings, sku]);

  useEffect(() => {
    const productAnswer = api<Product>("GET", `/api/products/${sku}`).then(setProduct, () => undefined);
    const cartAnswer = api<Cart>("GET", "/api/cart").then((answer) => {
      apply(answer);
      if (answer.area) {
        const named = AREAS.find((area) => area.lat === answer.area?.lat && area.lon === answer.area?.lon);
        setAreaName(named?.name ?? "");
        void rank(answer.area, named?.name ?? "your location", false);
      }
    }, () => undefined);
    void Promise.allSettled([productAnswer, cartAnswer]).then(() => setReady(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sku]);

  useEffect(() => {
    if (ready && restoreFocus.current && product && cart && root.current && (shops.length > 0 || !restoreFocus.current.startsWith("collect:"))) {
      focusById(root.current, restoreFocus.current);
      restoreFocus.current = null;
    }
  }, [ready, product, cart, shops]);

  function chooseArea(name: string) {
    setAreaName(name);
    const area = AREAS.find((candidate) => candidate.name === name);
    if (area) void rank(area, area.name, true);
  }

  function locate() {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setAreaName("");
        void rank({ lat: position.coords.latitude, lon: position.coords.longitude }, "your location", true);
      },
      () => setRanking(CART_ERROR),
    );
  }

  async function collect(shopId: string) {
    const applied = await change(() => api<Cart>("PUT", "/api/cart/store", { store_id: shopId }), false);
    if (applied && latest.current && latest.current.lines.length > 0) setUpdates(cartTotalCopy(latest.current.total_cents));
  }

  async function add() {
    const typed = quantity.trim();
    const amount = Number(typed);
    if (!/^\d+$/.test(typed) || amount < 1 || amount > 999) {
      setQuantityError(QUANTITY_ERROR);
      return;
    }
    setQuantityError("");
    if (adding.current) return;
    adding.current = true;
    const existing = latest.current?.lines.find((line) => line.sku === sku)?.quantity ?? 0;
    await change(() => api<Cart>("PUT", `/api/cart/lines/${sku}`, { quantity: existing + amount }));
    adding.current = false;
  }

  if (!ready) return <main className="storefront product-page" ref={root} aria-busy="true" />;
  return (
    <main className="storefront product-page" ref={root} onFocusCapture={(event) => remember({ focus: focusIdOf(event) })}>
      <section className="product-item charcoal-panel">
        <h1>{product?.name ?? ""}</h1>
        <p className="sku">{sku}</p>
        <p className="price">{product ? formatMilli(product.unit_price_milli) : ""}</p>
        <label className="field-label" htmlFor="quantity">Quantity</label>
        <input
          id="quantity" className="field" type="number" min={1} max={999} step={1} value={quantity} data-focus-id="quantity"
          aria-invalid={quantityError ? true : undefined} aria-describedby={quantityError ? "quantity-error" : undefined}
          onChange={(event) => { setQuantity(event.target.value); remember({ quantity: event.target.value }); }}
        />
        {quantityError ? <p id="quantity-error" className="field-error">{quantityError}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="btn" data-focus-id="add" onClick={() => void add()}>Add to cart</button>
        </div>
        <p className="total-line">Cart total {cart ? <Figure kind="cart-total" value={cart.total_cents} unit="euro" className="big" /> : null}</p>
        <Status label="Cart updates" text={updates} />
      </section>
      <section className="product-area">
        <label className="field-label" htmlFor="area">Your area</label>
        <select id="area" className="field" value={areaName} data-focus-id="area" onChange={(event) => chooseArea(event.target.value)}>
          <option value="">Choose your area</option>
          {AREAS.map((area) => <option key={area.name} value={area.name}>{area.name}</option>)}
        </select>
        <div className="dialog-actions">
          <button type="button" className="btn" data-focus-id="location" onClick={locate}>Use my location</button>
        </div>
        <Status label="Shop ranking" text={ranking} />
        <RankedList shops={shops} chosen={cart?.store_id ?? null} onCollect={(id) => void collect(id)} />
      </section>
    </main>
  );
}
