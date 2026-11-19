import { hasWebGL } from "../render";
import { fitCanvas } from "./gl";
import { useLoop } from "./loop";
import { BUILD_FINISHED_MS, BUILD_LOOP_MS, sharedToyRig } from "./toyRig";
import { ToyStill } from "./stills";
import { HERO_LOOKS, breakpointOf } from "./views";
import { useBreakpoint } from "./useBreakpoint";

const GRID_WIDTH = 1440;
const GRID_HEIGHT = 560;
const VANISH = { x: GRID_WIDTH / 2, y: GRID_HEIGHT * 0.46 } as const;
/** How far from the vanishing point each ray starts, as a share of its length, so the centre stays clear. */
const RAY_START = 0.06;
const FRAMES = [0.08, 0.16, 0.32, 0.64, 1.28] as const;

function rayEnds(): [number, number][] {
  const ends: [number, number][] = [];
  for (let step = -6; step <= 6; step += 1) {
    const x = VANISH.x + (step * GRID_WIDTH) / 12;
    ends.push([x, 0], [x, GRID_HEIGHT]);
  }
  for (let step = -4; step <= 4; step += 1) {
    const y = VANISH.y + (step * GRID_HEIGHT) / 5;
    ends.push([0, y], [GRID_WIDTH, y]);
  }
  return ends;
}

/** Thin white lines that converge on a vanishing point near the centre: a corridor of rays and receding frames. */
function BlueprintGrid() {
  return (
    <svg className="hero-grid" viewBox={`0 0 ${GRID_WIDTH} ${GRID_HEIGHT}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1">
        {rayEnds().map(([x, y]) => (
          <line key={`${x}-${y}`} x1={VANISH.x + (x - VANISH.x) * RAY_START} y1={VANISH.y + (y - VANISH.y) * RAY_START} x2={x} y2={y} vectorEffect="non-scaling-stroke" />
        ))}
        {FRAMES.map((scale) => (
          <rect key={scale} x={VANISH.x - (GRID_WIDTH / 2) * scale} y={VANISH.y - (GRID_HEIGHT / 2) * scale} width={GRID_WIDTH * scale} height={GRID_HEIGHT * scale} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
    </svg>
  );
}

/** The hero's toy scene: still, drawn once and again when the hero is resized. */
function HeroScene() {
  const live = hasWebGL();
  const breakpoint = useBreakpoint();
  const { ref } = useLoop<HTMLCanvasElement>({
    playing: false, periodMs: BUILD_LOOP_MS, restMs: BUILD_FINISHED_MS, frameGapMs: 0,
    paint: (ms, canvas) => {
      if (!fitCanvas(canvas)) return;
      sharedToyRig().draw(canvas, HERO_LOOKS[breakpointOf(canvas.clientWidth)].view, ms);
    },
  });
  if (live) return <canvas ref={ref} className="hero-scene" aria-hidden="true" />;
  const { view, box } = HERO_LOOKS[breakpoint];
  return <ToyStill className="hero-scene" layout={view.layout} framing={view.framing} width={box.width} height={box.height} ground="var(--cobalt)" preserveAspectRatio="xMidYMax slice" />;
}

export function Hero() {
  return (
    <section className="hero">
      <BlueprintGrid />
      <HeroScene />
      <div className="column hero-copy">
        <h1>Make a thing you can hold by Friday.</h1>
      </div>
    </section>
  );
}
