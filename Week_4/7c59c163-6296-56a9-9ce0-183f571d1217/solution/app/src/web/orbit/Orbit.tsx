import { useEffect, useRef, useState, type ReactNode } from "react";
import { priceLabel, type MarketKind } from "../../shared/rules";
import type { Book } from "../api";
import { OrbitScene, type RingLevel } from "./scene";

/** Book levels as rings on the YES scale (events) or the pair's price scale. */
export function ringLevels(book: Book | null): RingLevel[] {
  if (!book) return [];
  return [
    ...book.asks.map((l) => ({ key: `ask:${l.price}`, side: "ask" as const, price: l.price, quantity: l.quantity })),
    ...book.bids.map((l) => ({ key: `bid:${l.price}`, side: "bid" as const, price: l.price, quantity: l.quantity })),
  ];
}

/** Reduced motion, or a browser without WebGL, gets the flat Depth ladder instead of the orbit. */
export function useFlatBook(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => window.matchMedia(query).matches);
  const [webgl] = useState(() => {
    const probe = document.createElement("canvas");
    return Boolean(probe.getContext("webgl2") ?? probe.getContext("webgl"));
  });
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced || !webgl;
}

interface OrbitProps {
  levels: RingLevel[];
  camera: "scroll" | "fixed";
  highlight: string | null;
  onPick?: (key: string) => void;
  onSettled?: (settled: boolean) => void;
}

export function Orbit({ levels, camera, highlight, onPick, onSettled }: OrbitProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<OrbitScene | null>(null);
  const callbacks = useRef({ onPick, onSettled });
  callbacks.current = { onPick, onSettled };

  useEffect(() => {
    if (!canvas.current) return;
    const created = new OrbitScene(canvas.current, camera, {
      onPick: (key) => callbacks.current.onPick?.(key),
      onSettled: (settled) => callbacks.current.onSettled?.(settled),
    });
    scene.current = created;
    return () => {
      created.dispose();
      scene.current = null;
    };
  }, [camera]);

  useEffect(() => {
    scene.current?.setLevels(levels);
  }, [levels]);

  useEffect(() => {
    scene.current?.setHighlight(highlight);
  }, [highlight, levels]);

  return <canvas ref={canvas} className="orbit-canvas" role="img" aria-label="Orderbook Orbit" data-settled="true" data-highlight="" data-rings="[]" />;
}

interface LadderProps {
  kind: MarketKind;
  levels: RingLevel[];
  highlight: string | null;
  onPick?: (key: string) => void;
}

/** Flat two-column ranked ladder: bids on one side, asks on the other, bars sized by quantity. */
export function DepthLadder({ kind, levels, highlight, onPick }: LadderProps) {
  const max = Math.max(1, ...levels.map((l) => l.quantity));
  const side = (which: "bid" | "ask", label: string) => {
    const ranked = levels.filter((l) => l.side === which).sort((a, b) => (which === "ask" ? a.price - b.price : b.price - a.price));
    return (
      <div className={`ladder-side ladder-${which}`}>
        <h3 className="ladder-heading">{label}</h3>
        <ul aria-label={label}>
          {ranked.map((level) => (
            <li key={level.key} className={level.key === highlight ? "is-highlighted" : ""} onClick={() => onPick?.(level.key)}>
              <span className="ladder-bar" style={{ width: `${(100 * level.quantity) / max}%` }} />
              <span className="ladder-price numeric">{priceLabel(kind, level.price)}</span>
              <span className="ladder-qty numeric">{level.quantity.toLocaleString("en-US")}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  };
  return (
    <section className="ladder" aria-label="Depth ladder">
      {side("bid", "Bids")}
      {side("ask", "Asks")}
    </section>
  );
}

/** The trade numeral: counts from the old last price to the new one once the rings have settled. */
export function LastTrade({ kind, price, settled, animate }: { kind: MarketKind; price: number | null; settled: boolean; animate: boolean }) {
  const [shown, setShown] = useState(price);
  const frame = useRef(0);
  useEffect(() => {
    if (price === shown) return;
    if (!animate || price === null || shown === null) {
      if (!animate || settled) setShown(price);
      return;
    }
    if (!settled) return;
    const from = shown;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 600);
      const eased = 1 - (1 - t) ** 3;
      setShown(t >= 1 ? price : Math.round(from + (price - from) * eased));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [price, settled, animate]);
  return (
    <div className="last-trade numeral" role="region" aria-label="Last trade">
      {shown === null ? "—" : priceLabel(kind, shown)}
    </div>
  );
}

export function OrbitStage({ children, caption }: { children: ReactNode; caption?: ReactNode }) {
  return (
    <section className="orbit-stage" aria-label="Orderbook Orbit">
      {children}
      {caption}
    </section>
  );
}
