import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { derive, readoutLine, trainOf } from "../../shared/optics";
import { rowPage } from "../../shared/packet-page";
import { projectSky } from "../../shared/projection";
import type { Derived, StrokeFile } from "../../shared/types";
import { drawEyepieceView, HERO_OBJECTS, type HeroObject } from "../field/hero";
import { navigate } from "../lib/router";
import { app } from "../state/model";
import { Footer } from "../ui/layout";

const HOLD_MS = 6000;
const FADE_MS = 1000;

function useReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function Hero() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [name, setName] = useState<HeroObject>("M13");
  const layers = useRef<HTMLCanvasElement[]>([]);
  const reduced = useReducedMotion();

  const size = () => {
    const rect = box.current?.getBoundingClientRect();
    return { w: Math.max(1, Math.round(rect?.width ?? 520)), h: Math.max(1, Math.round(rect?.height ?? 440)) };
  };

  const prepare = () => {
    const { w, h } = size();
    layers.current = HERO_OBJECTS.map((which) => {
      const layer = document.createElement("canvas");
      drawEyepieceView(layer, w, h, which);
      return layer;
    });
  };

  const show = (a: number, b: number, mix: number) => {
    const target = canvas.current;
    const { w, h } = size();
    if (!target || layers.current.length === 0) return;
    const first = layers.current[a]!;
    target.width = first.width;
    target.height = first.height;
    const ctx = target.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.globalAlpha = 1 - mix;
    ctx.drawImage(first, 0, 0);
    if (mix > 0) {
      ctx.globalAlpha = mix;
      ctx.drawImage(layers.current[b]!, 0, 0);
    }
    ctx.globalAlpha = 1;
    void w;
    void h;
  };

  useLayoutEffect(() => {
    prepare();
    show(0, 0, 0);
    const observer = new ResizeObserver(() => {
      prepare();
      show(0, 0, 0);
    });
    if (box.current) observer.observe(box.current);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (reduced) return;
    const start = performance.now();
    let raf = 0;
    let shown = 0;
    const tick = () => {
      const elapsed = performance.now() - start;
      const cycle = Math.floor(elapsed / HOLD_MS);
      const within = elapsed - cycle * HOLD_MS;
      const to = cycle % HERO_OBJECTS.length;
      const from = (cycle + HERO_OBJECTS.length - 1) % HERO_OBJECTS.length;
      const mix = cycle > 0 && within < FADE_MS ? within / FADE_MS : 1;
      const current = mix >= 0.5 ? to : from;
      if (current !== shown) {
        shown = current;
        setName(HERO_OBJECTS[current]!);
      }
      show(from, to, mix);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  return (
    <div class="plinth" ref={box}>
      <canvas ref={canvas} role="img" aria-label={`Eyepiece view of ${name}`} />
    </div>
  );
}

const SAMPLE: Derived = derive({
  telescope: { aperture_mm: 254, focal_length_mm: 1200 },
  eyepiece: { focal_length_mm: 10, apparent_field_deg: 67 },
  barlow: null,
  train: "straight",
});

function MiniCompass({ train }: { train: "straight" | "mirror_diagonal" }) {
  const t = trainOf(train);
  const point = (east: number, north: number) => projectSky(east, north, t.rotation_deg, t.mirrored ? -1 : 1);
  const [nx, ny] = point(0, 1);
  const [ex, ey] = point(1, 0);
  const L = 26;
  return (
    <figure class="demo-compass">
      <svg viewBox="0 0 80 80" width="80" height="80" role="img" aria-label={`Compass: ${t.sentence}`}>
        <circle cx="40" cy="40" r="2" fill="currentColor" />
        <line x1="40" y1="40" x2={40 + nx * L} y2={40 - ny * L} stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        <line x1="40" y1="40" x2={40 + ex * L} y2={40 - ey * L} stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        <text x={40 + nx * 35} y={40 - ny * 35 + 4} text-anchor="middle" font-size="12" fill="currentColor">
          N
        </text>
        <text x={40 + ex * 35} y={40 - ey * 35 + 4} text-anchor="middle" font-size="12" fill="currentColor">
          E
        </text>
      </svg>
      <figcaption>
        {t.name}
        <br />
        {t.sentence}
      </figcaption>
    </figure>
  );
}

const SAMPLE_STROKES: StrokeFile = {
  format: "lowlamp-strokes/1",
  strokes: [{ width: "fine", points: [[-6, -9], [-3, -4], [0, 1], [3, 4], [7, 8]] }],
  stars: [
    { at: [0, 10], brightness: 5 },
    { at: [-8, 3], brightness: 3 },
    { at: [5, -6], brightness: 4 },
    { at: [-3, -11], brightness: 2 },
    { at: [10, 4], brightness: 3 },
  ],
};

function SamplePage() {
  const html = rowPage({
    designation: "M13",
    objectName: "Great Globular Cluster in Hercules",
    kind: "globular",
    observedAt: "2026-07-18T03:20:00Z",
    localTime: "21:20",
    localOffset: "-06:00",
    timeZone: "America/Denver",
    siteName: "Hollow Field",
    seeing: 8,
    transparencyNelm: 6.5,
    telescopeName: "10-inch Dobsonian",
    eyepieceName: "10 mm wide",
    barlowName: null,
    derived: SAMPLE,
    edition: 1,
    concentrationClass: "V",
    pair: null,
    description: "Core resolved at 120x with chains of stars spilling to the northwest.",
    strokes: SAMPLE_STROKES,
  });
  return <figure class="demo-page lp-page" role="img" aria-label="A packet page in graphite on white" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Landing() {
  const startHref = () => (app.get().auth === "in" ? "/tonight" : "/signup");
  const [href, setHref] = useState(startHref);
  useLayoutEffect(() => app.subscribe(() => setHref(startHref())), []);
  return (
    <div class="landing">
      <section class="hero">
        <div class="hero-top">
          <h1 class="wordmark">Lowlamp</h1>
          <p class="tagline">A field log for people who still draw what they see.</p>
        </div>
        <div class="hero-column">
          <Hero />
          <a
            class="btn primary start"
            href={href}
            onClick={(event) => {
              event.preventDefault();
              const go = () => navigate(app.get().auth === "in" ? "/tonight" : "/signup");
              if (app.get().phase === "ready") go();
              else {
                const stop = app.subscribe(() => {
                  if (app.get().phase === "ready") {
                    stop();
                    go();
                  }
                });
              }
            }}
          >
            Start a log
          </a>
        </div>
      </section>
      <section class="white-field">
        <div class="hero-column demos">
          <div class="demo">
            <h2>Optics, worked out</h2>
            <p class="demo-readout">{readoutLine(SAMPLE)}</p>
            <p class="demo-caption">A 10-inch Dobsonian with a 10 mm eyepiece: magnification, true field and exit pupil update as you pick.</p>
          </div>
          <div class="demo">
            <h2>North and east, for your train</h2>
            <div class="demo-compasses">
              <MiniCompass train="straight" />
              <MiniCompass train="mirror_diagonal" />
            </div>
          </div>
          <div class="demo">
            <h2>A page the coordinator can read</h2>
            <SamplePage />
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
}
