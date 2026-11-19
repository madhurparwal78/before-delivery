import type { ReactNode } from "react";
import { TOY_COLOURS } from "../starters";
import { hasWebGL } from "../render";
import { clamp01, easeOutBack, easeOutCubic, lerp } from "./ease";
import { fitCanvas } from "./gl";
import { LoopToggle } from "./LoopToggle";
import { usePlayback, useLoop } from "./loop";
import { PART_FRAMING, PART_REST_MS, PART_TURN_MS, partTurn, sharedPartScene } from "./partScene";
import { PartStill } from "./stills";

const PREVIEW_BOX = { width: 520, height: 340 } as const;

interface FrameProps {
  playing: boolean;
  onToggle: () => void;
  label: string;
  /** False hides the toggle: a preview that cannot loop here has nothing to pause. */
  loops: boolean;
  children: ReactNode;
}

/** The white media panel of a feature row: the picture, and its own pause toggle in the corner. */
function PreviewFrame({ playing, onToggle, label, loops, children }: FrameProps) {
  return (
    <div className="feature-media card">
      <div className="preview-stage" data-playing={String(playing)}>{children}</div>
      {loops ? <LoopToggle label={label} playing={playing} onToggle={onToggle} className="loop-toggle--corner" /> : null}
    </div>
  );
}

export function WorkshopPreview() {
  const live = hasWebGL();
  const { playing, toggle } = usePlayback(live);
  const { ref } = useLoop<HTMLCanvasElement>({
    playing, periodMs: PART_TURN_MS, restMs: PART_REST_MS, frameGapMs: 33,
    paint: (ms, canvas) => {
      if (fitCanvas(canvas)) sharedPartScene().draw(canvas, ms);
    },
  });
  return (
    <PreviewFrame playing={playing} onToggle={toggle} label="Pause 3D Workshop preview" loops={live}>
      {live
        ? <canvas ref={ref} className="preview-canvas" aria-hidden="true" />
        : <PartStill framing={PART_FRAMING} turn={partTurn(PART_REST_MS)} width={PREVIEW_BOX.width} height={PREVIEW_BOX.height} />}
    </PreviewFrame>
  );
}

/** One resistor value of the circuit demo with the LED reading it gives (the brief's worked values for 330 and 1000 ohms). */
const RESISTOR_STEPS = [
  { ohms: "1000", milliamps: "6.8", brightness: 0.34, at: 1000 },
  { ohms: "680", milliamps: "9.9", brightness: 0.5, at: 3200 },
  { ohms: "470", milliamps: "14.1", brightness: 0.71, at: 5400 },
  { ohms: "330", milliamps: "19.7", brightness: 0.99, at: 7600 },
] as const;
const CIRCUIT_LOOP_MS = 10000;
const CIRCUIT_REST_MS = 8800;
const BRIGHTEN_MS = 600;
const RESET_AT_MS = 9600;

function circuitBrightness(ms: number): { step: (typeof RESISTOR_STEPS)[number]; brightness: number } {
  let index = 0;
  RESISTOR_STEPS.forEach((step, at) => {
    if (ms >= step.at) index = at;
  });
  const step = RESISTOR_STEPS[index] ?? RESISTOR_STEPS[0];
  const before = RESISTOR_STEPS[Math.max(0, index - 1)] ?? RESISTOR_STEPS[0];
  const base = index === 0 ? step.brightness : lerp(before.brightness, step.brightness, clamp01((ms - step.at) / BRIGHTEN_MS));
  const last = RESISTOR_STEPS[RESISTOR_STEPS.length - 1] ?? step;
  const brightness = ms >= RESET_AT_MS ? lerp(last.brightness, RESISTOR_STEPS[0].brightness, clamp01((ms - RESET_AT_MS) / (CIRCUIT_LOOP_MS - RESET_AT_MS))) : base;
  return { step, brightness };
}

function paintCircuit(ms: number, svg: SVGSVGElement): void {
  const { step, brightness } = circuitBrightness(ms);
  const text = (selector: string, value: string) => {
    const node = svg.querySelector(selector);
    if (node) node.textContent = value;
  };
  const attribute = (selector: string, name: string, value: string) => svg.querySelector(selector)?.setAttribute(name, value);
  text(".cb-ohms", `${step.ohms} Ω`);
  text(".cb-ma", `${step.milliamps} mA`);
  attribute(".cb-glow", "r", String(18 + brightness * 22));
  attribute(".cb-glow", "opacity", String(0.12 + brightness * 0.62));
  attribute(".cb-core", "opacity", String(0.35 + brightness * 0.65));
  attribute(".cb-rays", "opacity", String(Math.max(0, (brightness - 0.2) / 0.8)));
  attribute(".cb-bar", "width", String(8 + brightness * 112));
}

export function CircuitPreview() {
  const { playing, toggle } = usePlayback();
  const { ref } = useLoop<SVGSVGElement>({ playing, periodMs: CIRCUIT_LOOP_MS, restMs: CIRCUIT_REST_MS, frameGapMs: 33, paint: (ms, svg) => paintCircuit(ms, svg) });
  return (
    <PreviewFrame playing={playing} onToggle={toggle} label="Pause Circuit Bench preview" loops>
      <svg ref={ref} className="preview-svg" viewBox={`0 0 ${PREVIEW_BOX.width} ${PREVIEW_BOX.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
        <g className="cb-wire" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M90 78V150M90 166V250H430V196M430 142V78H310M190 78H90" />
        </g>
        <g className="cb-part" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M70 150H110" />
          <path d="M78 166H102" strokeWidth="6" />
          <path d="M190 78l10-14 20 28 20-28 20 28 20-28 20 28 10-14" />
          <path d="M410 142h40l-20 36z" />
          <path d="M408 182h44" />
          <path d="M452 160l10-6M456 172l12 0" className="cb-rays" />
          <path d="M408 160l-10-6M404 172l-12 0" className="cb-rays" />
        </g>
        <circle className="cb-glow" cx="430" cy="160" r="30" fill="#ffc83d" opacity="0.5" />
        <circle className="cb-core" cx="430" cy="160" r="9" fill="#ffc83d" />
        <text x="122" y="164" className="cb-label">BAT-1 · 9 V</text>
        <text x="260" y="50" textAnchor="middle" className="cb-label">R-1</text>
        <text x="260" y="118" textAnchor="middle" className="cb-value cb-ohms">1000 Ω</text>
        <text x="430" y="110" textAnchor="middle" className="cb-label">LED-1</text>
        <rect x="150" y="282" width="220" height="40" rx="8" className="cb-readout" />
        <text x="166" y="307" className="cb-label">Current</text>
        <text x="270" y="307" className="cb-value cb-ma">6.8 mA</text>
        <rect x="166" y="313" className="cb-bar" width="8" height="3" rx="1.5" />
      </svg>
    </PreviewFrame>
  );
}

const CHIP_DROPS = [300, 1100, 1900] as const;
const BALL_POPS = [3300, 4000, 4700] as const;
const BLOCKS_LOOP_MS = 9000;
/** Chips rise into their slot from just below, so a chip in motion never covers the one above it. */
const CHIP_RISE = 18;
const BLOCKS_REST_MS = 7000;
const FADE_OUT_AT = 8200;
const CHIP_DROP_MS = 600;
const BALL_POP_MS = 450;
const BALLS = [
  { colour: TOY_COLOURS.green, y: 262 },
  { colour: TOY_COLOURS.azure, y: 214 },
  { colour: TOY_COLOURS.orange, y: 166 },
] as const;

function paintBlocks(ms: number, svg: SVGSVGElement): void {
  const fade = 1 - clamp01((ms - FADE_OUT_AT) / (BLOCKS_LOOP_MS - FADE_OUT_AT));
  svg.querySelectorAll<SVGGElement>(".bl-chip").forEach((chip, index) => {
    const t = clamp01((ms - (CHIP_DROPS[index] ?? 0)) / CHIP_DROP_MS);
    chip.setAttribute("transform", `translate(0 ${(1 - easeOutCubic(t)) * CHIP_RISE})`);
    chip.setAttribute("opacity", String(Math.min(1, t * 4) * fade));
  });
  svg.querySelectorAll<SVGGElement>(".bl-ball").forEach((ball, index) => {
    const t = clamp01((ms - (BALL_POPS[index] ?? 0)) / BALL_POP_MS);
    const scale = Math.max(easeOutBack(t), 0.001);
    const { y } = BALLS[index] ?? BALLS[0];
    ball.setAttribute("transform", `translate(390 ${y}) scale(${scale})`);
    ball.setAttribute("opacity", String(Math.min(1, t * 4) * fade));
  });
}

const VIEWER = { left: 318, top: 48, right: 480, bottom: 292, horizon: 214 } as const;

/** The Block Lab viewer's workplane: a blueprint grid on the back wall and a floor receding to the horizon. */
function ViewerGrid() {
  const { left, top, right, bottom, horizon } = VIEWER;
  const centre = (left + right) / 2;
  const wall = [];
  for (let x = left + 18; x < right; x += 18) wall.push(<line key={`w${x}`} x1={x} y1={top} x2={x} y2={horizon} />);
  for (let y = top + 18; y < horizon; y += 18) wall.push(<line key={`h${y}`} x1={left} y1={y} x2={right} y2={y} />);
  const floor = [];
  for (let step = -4; step <= 4; step += 1) floor.push(<line key={`r${step}`} x1={centre + step * 14} y1={horizon} x2={centre + step * 46} y2={bottom} />);
  for (const share of [0.18, 0.42, 0.72]) {
    const y = horizon + (bottom - horizon) * share;
    floor.push(<line key={`f${share}`} x1={left} y1={y} x2={right} y2={y} />);
  }
  return (
    <g className="bl-grid">
      <clipPath id="bl-viewer-clip"><rect x={left} y={top} width={right - left} height={bottom - top} rx="8" /></clipPath>
      <g clipPath="url(#bl-viewer-clip)">
        <rect x={left} y={horizon} width={right - left} height={bottom - horizon} className="bl-floor" />
        {wall}
        {floor}
      </g>
      <rect x={left} y={top} width={right - left} height={bottom - top} rx="8" className="bl-frame" />
    </g>
  );
}

export function BlocksPreview() {
  const { playing, toggle } = usePlayback();
  const { ref } = useLoop<SVGSVGElement>({ playing, periodMs: BLOCKS_LOOP_MS, restMs: BLOCKS_REST_MS, startMs: BLOCKS_REST_MS, frameGapMs: 33, paint: (ms, svg) => paintBlocks(ms, svg) });
  return (
    <PreviewFrame playing={playing} onToggle={toggle} label="Pause Block Lab preview" loops>
      <svg ref={ref} className="preview-svg" viewBox={`0 0 ${PREVIEW_BOX.width} ${PREVIEW_BOX.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
        <g className="bl-chip" fill={TOY_COLOURS.purple}>
          <rect x="40" y="48" width="230" height="46" rx="8" />
          <rect x="40" y="82" width="26" height="140" />
          <rect x="40" y="208" width="230" height="22" rx="8" />
          <text x="58" y="78" className="bl-text bl-text--light">Repeat</text>
          <rect x="204" y="59" width="44" height="24" rx="12" fill="#fff" />
          <text x="226" y="77" textAnchor="middle" className="bl-text bl-text--ink">3</text>
        </g>
        <g className="bl-chip">
          <rect x="78" y="104" width="180" height="42" rx="8" fill={TOY_COLOURS.green} />
          <text x="96" y="131" className="bl-text bl-text--ink">Add Sphere</text>
        </g>
        <g className="bl-chip">
          <rect x="78" y="156" width="180" height="42" rx="8" fill={TOY_COLOURS.orange} />
          <text x="96" y="183" className="bl-text bl-text--ink">Move Z by</text>
          <rect x="196" y="165" width="48" height="24" rx="12" fill="#fff" />
          <text x="220" y="183" textAnchor="middle" className="bl-text bl-text--ink">10</text>
        </g>
        <rect x="318" y="48" width="162" height="244" rx="8" className="bl-viewer" />
        <ViewerGrid />
        <ellipse cx="390" cy="286" rx="46" ry="10" className="bl-shadow" />
        {BALLS.map((ball, index) => (
          <g key={index} className="bl-ball">
            <circle r="26" fill={ball.colour} />
            <ellipse cx="-8" cy="-10" rx="8" ry="5" fill="#fff" opacity="0.45" transform="rotate(-30 -8 -10)" />
          </g>
        ))}
      </svg>
    </PreviewFrame>
  );
}
