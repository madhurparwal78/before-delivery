import { mulberry32 } from "../../shared/sampling.ts";

export type StrandVariant = "card" | "stage" | "wave" | "faint";

const COLOURS = ["139,124,246", "201,194,255", "122,138,160"];
const SETTINGS: Record<StrandVariant, { curves: number; alpha: number; dots: number }> = {
  card: { curves: 320, alpha: 0.14, dots: 24 },
  stage: { curves: 200, alpha: 0.07, dots: 60 },
  wave: { curves: 520, alpha: 0.07, dots: 140 },
  faint: { curves: 70, alpha: 0.03, dots: 0 },
};

/** A stable 32-bit seed from text such as the hex of real shares. */
export function seedFrom(text: string): number {
  let seed = 2166136261;
  for (let i = 0; i < text.length; i++) seed = Math.imul(seed ^ text.charCodeAt(i), 16777619);
  return seed >>> 0;
}

/** Draws bundles of thin luminous strands once, sized to the canvas box. */
export function drawStrands(canvas: HTMLCanvasElement, seed: number, variant: StrandVariant): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  // The faint canvas is the first thing a page paints, ahead of the live channel: it stays off the GPU, whose first
  // canvas can hold the main thread for seconds on a software renderer, and a socket opened that late misses live events.
  const context = canvas.getContext("2d", variant === "faint" ? { willReadFrequently: true } : undefined);
  if (!context || width === 0 || height === 0) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.globalCompositeOperation = "lighter";
  const random = mulberry32(seed);
  const { curves, alpha, dots } = SETTINGS[variant];
  const crest = variant === "wave" ? 0.28 : 0.18;
  const groups = variant === "card" ? 3 + Math.floor(random() * 2) : variant === "stage" ? 2 : 1;
  const flows = Array.from({ length: groups }, () => ({
    baseline: variant === "wave" ? 0.62 : variant === "card" ? 0.2 + random() * 0.6 : 0.35 + random() * 0.3,
    reach: variant === "card" ? 0.5 + random() * 0.6 : 1,
    colour: Math.floor(random() * COLOURS.length),
    cp1: 0.15 + random() * 0.25,
    cp2: 0.5 + random() * 0.3,
    drift: (random() - 0.5) * height * (variant === "card" ? 0.9 : 0.5),
  }));
  for (let i = 0; i < curves; i++) {
    const flow = flows[i % groups] as (typeof flows)[number];
    const colour = COLOURS[random() < 0.6 ? flow.colour : Math.floor(random() * COLOURS.length)] as string;
    const offset = (random() - 0.5) * height * 0.22;
    const baseline = height * flow.baseline + offset;
    const lift = height * crest * flow.reach * (random() - 0.2);
    context.beginPath();
    context.moveTo(-10, baseline + (random() - 0.5) * height * 0.1);
    context.bezierCurveTo(
      width * flow.cp1, baseline - lift * 1.6,
      width * flow.cp2, baseline + lift * (0.4 + random()),
      width + 10, baseline + flow.drift + (random() - 0.5) * height * 0.3,
    );
    context.strokeStyle = `rgba(${colour},${alpha * (0.5 + random())})`;
    context.lineWidth = 0.5 + random() * 0.6;
    context.stroke();
  }
  context.fillStyle = "rgba(253,252,255,0.7)";
  for (let i = 0; i < dots; i++) {
    context.fillRect(random() * width, random() * height * 0.8, 1 + random(), 1 + random());
  }
}
