import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MarkTile, TILES, Tile } from "../home/Tiles.tsx";
import { HeroContent, PromiseContent } from "../home/Parts.tsx";
import { STAGE_SCROLL, TILE_IDS, clamp, stageLayout, type Line, type Placed, type TileId } from "../home/layout.ts";
import { useChapters } from "../home/useChapters.ts";
import { useLive } from "../lib/live.ts";
import { useDesktop, useReducedMotion } from "../lib/motion.ts";
import { useSession } from "../lib/session.tsx";
import { useTitle } from "../lib/focus.ts";
import { FrameGrid } from "../ui/FrameGrid.tsx";
import "../home/home.css";

const LINE_POOL = 24;

function place(el: HTMLElement, r: Placed): void {
  const s = el.style;
  s.left = `${r.x}px`;
  s.top = `${r.y}px`;
  s.width = `${r.w}px`;
  s.height = `${r.h}px`;
  s.opacity = String(r.opacity);
}

/** Keeps the chapter tile lines current when a chapter changes while someone is signed in. */
function LiveChapters({ reload }: { reload: () => void }): ReactNode {
  useLive(["chapter.updated"], reload);
  return null;
}

/** Desktop without reduced motion: a pinned stage whose every block is a direct function of scroll progress. */
function StageHome({ data }: { data: ReturnType<typeof useChapters>["data"] }): ReactNode {
  const stage = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLElement>(null);
  const statement = useRef<HTMLParagraphElement>(null);
  const tiles = useRef<Partial<Record<TileId, HTMLAnchorElement | null>>>({});
  const lines = useRef<(HTMLElement | null)[]>([]);

  const apply = useCallback((): void => {
    const root = stage.current;
    if (!root || !hero.current || !card.current || !statement.current) return;
    const width = root.clientWidth;
    const height = root.clientHeight;
    const layout = stageLayout(width, height, clamp(window.scrollY / STAGE_SCROLL));
    place(hero.current, layout.hero);
    hero.current.style.visibility = layout.hero.opacity <= 0.001 ? "hidden" : "visible";
    place(card.current, layout.card);
    card.current.style.visibility = layout.card.opacity <= 0.001 ? "hidden" : "visible";
    statement.current.style.opacity = String(layout.statement);
    const radius = `${layout.radius}px`;
    for (const id of TILE_IDS) {
      const el = tiles.current[id];
      if (!el) continue;
      const placed = layout.tiles[id];
      place(el, placed);
      el.style.zIndex = String(TILE_LAYER[id]);
      el.style.pointerEvents = placed.opacity < 0.5 ? "none" : "auto";
      el.style.clipPath = placed.reveal < 1 ? `inset(${(1 - placed.reveal) * 50}%)` : "none";
      el.style.setProperty("--r-tl", id === "logo" ? radius : "0px");
      el.style.setProperty("--r-tr", id === "typography" ? radius : "0px");
      el.style.setProperty("--r-bl", id === "iconography" ? radius : "0px");
      el.style.setProperty("--r-br", id === "rules" ? radius : "0px");
    }
    const byAxis = (axis: Line["axis"]): Line[] => layout.lines.filter((l) => l.axis === axis);
    (["x", "y"] as const).forEach((axis, offset) => {
      const wanted = byAxis(axis);
      for (let i = 0; i < LINE_POOL; i++) {
        const el = lines.current[offset * LINE_POOL + i];
        if (!el) continue;
        const line = wanted[i];
        el.style.display = line ? "block" : "none";
        if (line) {
          el.style[axis === "x" ? "left" : "top"] = `${line.at}px`;
          el.style.opacity = String(line.opacity);
        }
      }
    });
  }, []);

  useLayoutEffect(() => {
    apply();
    window.addEventListener("scroll", apply, { passive: true });
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
    };
  }, [apply]);

  const finishStage = (): void => {
    if (window.scrollY < STAGE_SCROLL - 1) window.scrollTo({ top: STAGE_SCROLL, behavior: "instant" });
    apply();
  };

  return (
    <main className="home home-stage" style={{ height: `calc(100vh + ${STAGE_SCROLL}px)` }}>
      <div className="stage" ref={stage}>
        <div className="stage-lines" aria-hidden="true">
          {Array.from({ length: LINE_POOL * 2 }, (_, i) => (
            <i key={i} className={i < LINE_POOL ? "line hair-x" : "line hair-y"} ref={(el) => void (lines.current[i] = el)} />
          ))}
        </div>
        <div className="hero" ref={hero}>
          <HeroContent
            onJump={() => {
              finishStage();
              tiles.current.logo?.focus({ preventScroll: true });
            }}
          />
        </div>
        <section className="promise" aria-label="Brand promise" ref={card}>
          <PromiseContent statementRef={statement} />
        </section>
        <nav className="mosaic" aria-label="Chapters">
          {TILES.map((spec) => (
            <Tile key={spec.id} spec={spec} data={data} innerRef={(el) => void (tiles.current[spec.id] = el)} onFocus={finishStage} />
          ))}
        </nav>
      </div>
    </main>
  );
}

/** Phones and reduced motion: three static sections in normal flow, each fading in by opacity only. */
function StackHome({ data }: { data: ReturnType<typeof useChapters>["data"] }): ReactNode {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const logo = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    if (!root) return;
    const watcher = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("seen");
          watcher.unobserve(entry.target);
        }
      }
    });
    root.querySelectorAll(".reveal").forEach((el) => watcher.observe(el));
    return () => watcher.disconnect();
  }, [root]);

  return (
    <div className="shell">
      <FrameGrid watch={root} />
      <main className="home home-stack" ref={setRoot}>
        <section className="stack-section stack-hero">
          <div className="hero reveal" data-frame>
            <HeroContent onJump={() => logo.current?.focus()} />
          </div>
        </section>
        <section className="stack-section stack-promise">
          <section className="promise reveal" aria-label="Brand promise" data-frame>
            <PromiseContent />
          </section>
        </section>
        <section className="stack-section stack-mosaic">
          <nav className="mosaic reveal" aria-label="Chapters">
            {TILES.map((spec) => (
              <Tile key={spec.id} spec={spec} data={data} innerRef={spec.id === "logo" ? logo : undefined} />
            ))}
            <MarkTile />
          </nav>
        </section>
      </main>
    </div>
  );
}

const TILE_LAYER: Record<TileId, number> = { colour: 1, logo: 2, typography: 3, iconography: 3, motion: 3, library: 3, voice: 4, rules: 4 };

export function Home(_props: { params: string[] }): ReactNode {
  useTitle("Quenby & Co. rulebook");
  const desktop = useDesktop();
  const reduced = useReducedMotion();
  const { me } = useSession();
  const { data, reload } = useChapters();
  return (
    <>
      {me ? <LiveChapters reload={reload} /> : null}
      {desktop && !reduced ? <StageHome data={data} /> : <StackHome data={data} />}
    </>
  );
}
