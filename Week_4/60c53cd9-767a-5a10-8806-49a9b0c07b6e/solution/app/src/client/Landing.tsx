/** The landing page: a camera that descends the tower as the page scrolls, swapping the field colour at each floor band. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { TowerAssets, TowerCell } from "../shared/api-types.js";
import { COPY } from "../shared/copy.js";
import { api, NetworkError } from "./api.js";
import { TOP_FLOOR } from "../shared/domain.js";
import { prefersReducedMotion } from "./motion.js";
import { Link } from "./router.js";
import { LandingScene, loadModels, webglAvailable, type LandingPose } from "./tower/scene.js";

const SCROLL_SPAN = 4800;
const BAND_SCROLL = 960;
const FLOOR_SPAN = 35;
const BAND_TOP_FLOORS = [38, 35, 29, 19, 9] as const;

const BANDS = [
  { label: "Floors 36-38", numeral: "38", field: "field-surface", copy: "The crown of the tower: the horizon at its lowest and the harbour fully open." },
  { label: "Floors 30-35", numeral: "35", field: "field-ink", copy: "Clear of Calder House on every side, with the harbour from the south-west and west homes." },
  { label: "Floors 20-29", numeral: "29", field: "field-ground", copy: "The harbour opens up above the Calder House roofline. Park, city and ridge views fill the other stacks." },
  { label: "Floors 10-19", numeral: "19", field: "field-ink", copy: "Calder House covers part of the harbour from the south-west and west stacks." },
  { label: "Floors 3-9", numeral: "9", field: "field-ground", copy: "Park and city views close to the podium, and the lowest prices in the tower." },
] as const;

/** The band whose section fills most of the window at this scroll position. The hero fills the first window and shows the roof band's pose. */
const bandAt = (scrollY: number): number => {
  const height = window.innerHeight;
  let best = 0;
  let bestOverlap = height - scrollY;
  BANDS.forEach((_, index) => {
    const top = height + index * BAND_SCROLL;
    const overlap = Math.min(scrollY + height, top + BAND_SCROLL) - Math.max(scrollY, top);
    if (overlap > bestOverlap) {
      best = index;
      bestOverlap = overlap;
    }
  });
  return best;
};

const StillTower = ({ inverted, floor }: { inverted: boolean; floor: number }): ReactNode => {
  const wall = inverted ? "#FFFFFF" : "#2A1FD0";
  const pane = inverted ? "#2A1FD0" : "#FFFFFF";
  const rows = Array.from({ length: 24 }, (_, row) => row);
  return (
    <svg className="still-tower" viewBox="0 0 240 480" role="img" aria-label={`Highwater tower at floor ${floor}`} preserveAspectRatio="xMidYMid slice">
      <rect width="240" height="480" fill={wall} />
      <rect x="66" y="20" width="108" height="440" fill={wall} stroke={pane} strokeWidth="3" />
      <rect x="40" y="410" width="160" height="50" fill={wall} stroke={pane} strokeWidth="3" />
      {rows.map((row) =>
        [0, 1, 2].map((column) => <rect key={`${row}-${column}`} x={76 + column * 32} y={30 + row * 16.5} width="24" height="9" fill={pane} />),
      )}
      <rect x="86" y="8" width="68" height="12" fill={wall} stroke={pane} strokeWidth="3" />
    </svg>
  );
};

export const Landing = (): ReactNode => {
  const [available, setAvailable] = useState<number | null>(null);
  const [assets, setAssets] = useState<TowerAssets | null>(null);
  const [scrollY, setScrollY] = useState(() => window.scrollY);
  const [webgl, setWebgl] = useState(() => webglAvailable());
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const scene = useRef<LandingScene | null>(null);
  const reduced = useMemo(() => prefersReducedMotion(), []);

  useEffect(() => {
    let live = true;
    void api<{ units: TowerCell[]; assets: TowerAssets }>("GET", "/api/tower")
      .then((result) => {
        if (!live || !result.ok) return;
        setAvailable(result.body.units.filter((cell) => cell.status === "available").length);
        setAssets(result.body.assets);
      })
      .catch((error: unknown) => {
        if (!(error instanceof NetworkError)) throw error;
      });
    return () => {
      live = false;
    };
  }, []);

  // Read once per frame and commit at once, so the camera and the readout always match; an unchanged position renders nothing.
  useEffect(() => {
    let last = window.scrollY;
    let frame = requestAnimationFrame(function follow() {
      if (window.scrollY !== last) {
        last = window.scrollY;
        flushSync(() => setScrollY(last));
      }
      frame = requestAnimationFrame(follow);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const still = reduced || !webgl;
  const progress = Math.min(1, scrollY / SCROLL_SPAN);
  const band = bandAt(scrollY);
  const floor = still ? (BAND_TOP_FLOORS[band] as number) : TOP_FLOOR - Math.round(FLOOR_SPAN * progress);
  const zone = Math.min(4, Math.floor(scrollY / BAND_SCROLL));
  const inverted = (still ? band : zone) % 2 === 1;

  useEffect(() => {
    if (!webgl || assets === null || scene.current !== null) return undefined;
    let live = true;
    void loadModels(assets)
      .then((models) => {
        if (!live || !canvas.current || !stage.current) return;
        const built = new LandingScene(canvas.current, models, () => setWebgl(false));
        scene.current = built;
        const box = stage.current.getBoundingClientRect();
        built.resize(box.width, box.height);
      })
      .catch(() => {
        if (live) setWebgl(false);
      });
    return () => {
      live = false;
    };
  }, [webgl, assets]);

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      const box = stage.current?.getBoundingClientRect();
      if (box) scene.current?.resize(box.width, box.height);
    });
    if (stage.current) observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const pose: LandingPose = still
      ? { floor, progress: band / 4, inverted }
      : { floor: TOP_FLOOR - FLOOR_SPAN * progress, progress, inverted };
    scene.current?.setPose(pose);
  }, [floor, progress, inverted, still, band, webgl, assets]);

  useEffect(
    () => () => {
      scene.current?.dispose();
      scene.current = null;
    },
    [],
  );

  /** A section's numeral slides while the section enters the window, then stops at 8% of the window width. */
  const slideOf = (index: number): number =>
    still ? 0 : Math.min(1, Math.max(0, (scrollY - index * BAND_SCROLL) / BAND_SCROLL)) * 0.08 * window.innerWidth;

  return (
    <main className={`landing zone-${inverted ? "light" : "dark"}`}>
      <div className="landing-stage" ref={stage}>
        {webgl ? (
          <canvas ref={canvas} role="img" aria-label={`Highwater tower at floor ${floor}`} className="landing-canvas" />
        ) : (
          <StillTower inverted={inverted} floor={floor} />
        )}
        <p className="readout figures">Floor {floor}</p>
      </div>
      <section className="landing-hero field-ground" style={{ ["--slide" as string]: `${slideOf(0)}px` }}>
        <p className="giant-numeral" aria-hidden="true" data-numeral="HIGHWATER" />
        <div className="hero-copy">
          <h1>HIGHWATER</h1>
          <p className="hero-line">Look out of the window before you buy it.</p>
          <Link to="/finder" className="button primary">
            Find your floor
          </Link>
        </div>
      </section>
      {BANDS.map((entry, index) => (
        <section key={entry.label} className={`landing-band ${entry.field}`} style={{ ["--slide" as string]: `${slideOf(index)}px` }}>
          <p className="giant-numeral" aria-hidden="true" data-numeral={entry.numeral} />
          <div className="band-copy">
            <h2>{entry.label}</h2>
            <p>{entry.copy}</p>
          </div>
        </section>
      ))}
      <section className="landing-tally" aria-label="Available now">
        <p className="tally-sentence">
          <span className="tally-number figures">{available ?? ""}</span> homes available now
        </p>
      </section>
      <footer className="landing-footer">
        <p>Orrin &amp; Vale Developments. Highwater is a tower under development; every figure on this site is a sales-office figure.</p>
        <p>{COPY.noPayment}</p>
      </footer>
    </main>
  );
};
