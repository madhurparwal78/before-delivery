import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useReducedMotion } from "../../lib/hooks";
import { CategoryLayer, type LayerName, type Slug } from "./categoryArt";
import { useScrollSync } from "./scrollSync";

const CATEGORIES: { slug: Slug; label: string }[] = [
  { slug: "kitchen", label: "Kitchen" },
  { slug: "fashion", label: "Fashion" },
  { slug: "electronics", label: "Electronics" },
  { slug: "beverages", label: "Beverages" },
];

/** On-screen speed of each layer as a share of scroll speed. */
const SPEED: Record<LayerName, number> = { back: 0.2, middle: 0.5, front: 1 };
const LAYERS: LayerName[] = ["back", "middle", "front"];

/** Per-letter offsets for the scatter, fixed so the heading regroups to the same place. */
function scatterOf(index: number): Record<string, string> {
  return {
    "--dx": `${((index * 37) % 11) * 12 - 60}px`,
    "--dy": `${((index * 53) % 9) * 14 - 56}px`,
    "--turn": `${((index * 29) % 13) * 9 - 54}deg`,
  };
}

/** Each layer is offset by (1 - speed) of the scroll distance from the banner being centred, so it moves on screen at `speed` of the scroll. */
function useParallax(banners: React.RefObject<HTMLDivElement | null>): void {
  const reduced = useReducedMotion();
  const place = useCallback((): void => {
    const root = banners.current;
    if (!root) return;
    for (const layer of root.querySelectorAll<HTMLElement>("[data-layer]")) {
      const banner = (layer.parentElement as HTMLElement).getBoundingClientRect();
      const away = window.innerHeight / 2 - (banner.top + banner.height / 2);
      const speed = SPEED[layer.dataset.layer as LayerName];
      layer.style.transform = `translate3d(0, ${(1 - speed) * away}px, 0)`;
    }
  }, [banners]);
  useScrollSync(!reduced, place);
  useEffect(
    () => () => {
      for (const layer of banners.current?.querySelectorAll<HTMLElement>("[data-layer]") ?? []) layer.style.transform = "";
    },
    [banners, reduced],
  );
}

export function Categories({ counts }: { counts: Record<string, number> }): ReactNode {
  const banners = useRef<HTMLDivElement>(null);
  useParallax(banners);
  return (
    <section className="cats" aria-label="Shop by category" ref={banners}>
      {CATEGORIES.map(({ slug, label }) => {
        const count = counts[slug];
        return (
          <Link key={slug} to={`/search?category=${slug}`} className={`cat cat--${slug}`}>
            {LAYERS.map((layer) => (
              <div key={layer} className={`cat__layer cat__layer--${layer}`} data-layer={layer}>
                <CategoryLayer slug={slug} layer={layer} />
              </div>
            ))}
            <div className="cat__copy">
              <h2 className="cat__title" aria-label={label}>
                {Array.from(label, (letter, index) => (
                  <span key={index} className="cat__letter" style={scatterOf(index)} aria-hidden="true">
                    {letter}
                  </span>
                ))}
              </h2>
              {count !== undefined && <span className="cat__count">{count === 1 ? "1 product" : `${count} products`}</span>}
            </div>
          </Link>
        );
      })}
    </section>
  );
}
