import { Pause, Play } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "../lib/router";
import { fadeElement } from "../lib/motion";
import { SnapshotStill, hasWebGL } from "../render";
import { STARTERS, starterSnapshot, type StarterId } from "../starters";
import { useDestinations } from "./destinations";
import { fitCanvas } from "./gl";
import { usePlayback, useLoop } from "./loop";
import { createStarterScene, STARTER_REST_MS, STARTER_TURN_MS, type StarterScene } from "./starterScene";

/** Each card starts its turn at a different angle so four models side by side never move in step. */
const STAGGER_MS = 6000;
/** The preview fades in over a quarter of a second when first drawn. */
const FADE_IN_MS = 250;
/** Cards build their scene this far before they scroll into view. */
const BUILD_MARGIN = "300px";

interface CardProps {
  id: StarterId;
  name: string;
  index: number;
  playing: boolean;
  live: boolean;
  to: string;
}

function StarterCard({ id, name, index, playing, live, to }: CardProps) {
  const scene = useRef<StarterScene | null>(null);
  const shown = useRef(false);
  const card = useRef<HTMLLIElement>(null);
  const { ref, repaint } = useLoop<HTMLCanvasElement>({
    playing, periodMs: STARTER_TURN_MS, restMs: STARTER_REST_MS, startMs: index * STAGGER_MS, frameGapMs: 66,
    paint: (ms, canvas) => {
      if (!scene.current || !fitCanvas(canvas)) return;
      scene.current.draw(canvas, ms);
      if (shown.current) return;
      shown.current = true;
      fadeElement(canvas, "in", FADE_IN_MS);
    },
  });

  useEffect(() => {
    const element = card.current;
    const snapshot = starterSnapshot(id);
    if (!live || !element || !snapshot) return undefined;
    let cancelled = false;
    const watcher = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      watcher.disconnect();
      void createStarterScene(snapshot).then((built) => {
        if (cancelled) return;
        scene.current = built;
        repaint();
      });
    }, { rootMargin: BUILD_MARGIN });
    watcher.observe(element);
    return () => {
      cancelled = true;
      watcher.disconnect();
    };
  }, [id, live, repaint]);

  const snapshot = starterSnapshot(id);
  return (
    <li ref={card}>
      <Link to={to} className="card starter-card">
        <span className="starter-render" data-playing={String(playing)}>
          {live ? <canvas ref={ref} className="preview-canvas" aria-hidden="true" /> : snapshot ? <SnapshotStill snapshot={snapshot} className="preview-canvas" /> : null}
        </span>
        <span className="starter-name">{name}</span>
      </Link>
    </li>
  );
}

/** The starter project grid: four procedural renders that turn slowly, one pause toggle for all of them, and a blank-design link. */
export function Starters() {
  const live = hasWebGL();
  const { playing, toggle } = usePlayback(live);
  const { starter, editor } = useDestinations();
  return (
    <section id="starter-projects" className="starters" aria-labelledby="starters-title">
      <div className="column">
        <div className="starters-head">
          <div>
            <h2 id="starters-title">Starter projects</h2>
            <p className="starters-intro">Open one and it lands in the 3D Workshop as an unsaved design, ready to change.</p>
          </div>
          {live ? (
            <button type="button" className="pill pill--outline starters-toggle" aria-pressed={!playing} onClick={toggle}>
              {playing ? <Pause size={16} fill="currentColor" aria-hidden="true" /> : <Play size={16} fill="currentColor" aria-hidden="true" />}
              Pause starter previews
            </button>
          ) : null}
        </div>
        <ul className="card-grid starter-grid">
          {STARTERS.map((item, index) => (
            <StarterCard key={item.id} id={item.id} name={item.name} index={index} playing={playing} live={live} to={starter(item.id)} />
          ))}
        </ul>
        <div className="starters-foot">
          <Link to={editor("3d")} className="pill pill--3d">Start a blank 3D design</Link>
        </div>
      </div>
    </section>
  );
}
