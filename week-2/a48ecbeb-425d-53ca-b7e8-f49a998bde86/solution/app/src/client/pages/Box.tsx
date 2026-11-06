import { ArrowLeft, ArrowRight, Radio } from "lucide-react";
import { useEffect, useRef } from "react";
import { Border } from "../components/Border";
import { Crate } from "../crate/Crate";
import { FlavourCard } from "../crate/FlavourCard";
import { DESKTOP, prefersReduced, useMedia } from "../lib/media";
import { FLAVOUR_NAMES } from "../../shared/format";
import { useShop } from "../state/shop";

export function StockNotices() {
  const { liveDown, stockUnavailable } = useShop();
  return (
    <>
      {stockUnavailable && <p className="notice notice-warn">Stock is unavailable right now.</p>}
      {liveDown && !stockUnavailable && (
        <p className="notice">
          <Radio size={18} aria-hidden="true" />
          Live stock paused. Counts refresh when you add a can.
        </p>
      )}
    </>
  );
}

/** Placeholder cards while flavours load, or names only when stock can't load. */
function SkeletonCards() {
  return (
    <>
      {Object.keys(FLAVOUR_NAMES).map((slug) => (
        <li key={slug} className="flavour-card is-loading" aria-hidden="true">
          <div className="skeleton" style={{ height: 180 }} />
          <div className="skeleton" style={{ height: 24, width: "60%", marginTop: 16 }} />
          <div className="skeleton" style={{ height: 44, marginTop: 16 }} />
        </li>
      ))}
    </>
  );
}

export function BoxPage() {
  const { flavours, watchLive } = useShop();
  const desktop = useMedia(DESKTOP);
  useEffect(watchLive, [watchLive]);
  const track = useRef<HTMLUListElement>(null);
  const page = (direction: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>(".flavour-card");
    el.scrollBy({ left: direction * ((card?.offsetWidth ?? 300) + 24), behavior: prefersReduced() ? "auto" : "smooth" });
  };
  return (
    <div className="shop-layout">
      <div className="shop-main">
        <header className="shop-intro">
          <p className="eyebrow">The box</p>
          <h1>Build your crate</h1>
          <p className="lede">
            Mix any 12 cans, or fill the crate with one flavour. Your cans are held for you while you shop, and the total below is exact for your
            province.
          </p>
          <Border seed={77} className="intro-border" />
        </header>
        <StockNotices />
        <div className="carousel">
          {desktop && (
            <div className="carousel-controls">
              <button type="button" className="btn btn-cream icon-btn" aria-label="Previous flavours" onClick={() => page(-1)}>
                <ArrowLeft size={20} aria-hidden="true" />
              </button>
              <button type="button" className="btn btn-cream icon-btn" aria-label="Next flavours" onClick={() => page(1)}>
                <ArrowRight size={20} aria-hidden="true" />
              </button>
            </div>
          )}
          <ul className="flavour-list" aria-label="Flavours" ref={track}>
            {flavours ? flavours.map((f, i) => <FlavourCard key={f.slug} flavour={f} first={i === 0} />) : <SkeletonCards />}
          </ul>
        </div>
      </div>
      <Crate />
    </div>
  );
}
