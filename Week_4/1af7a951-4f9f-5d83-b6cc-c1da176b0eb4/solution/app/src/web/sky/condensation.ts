// The sign condensation's flight: a glowing copy of the phrase lifts, breaks into particles and travels
// along a gentle curve to its constellation, then gathers into the new star. Drawn on a transient overlay
// canvas that takes no pointer events, is hidden from assistive tech and is removed when the flight ends.

export const LIFT_AT = 120;
export const GATHER_AT = 760;
export const SETTLE_AT = 1060;
const FADE_MS = 330;
const PARTICLES = 30;

type Point = { x: number; y: number };

interface Flight {
  /** The server confirmed: particles gather into the star at `star` (viewport coordinates) by the settle time. */
  land(star: () => Point | null): void;
  /** The server refused: particles fade out where they are. */
  fade(): void;
}

const ease = (t: number): number => 1 - (1 - Math.max(0, Math.min(1, t))) ** 3;

export function flyPhrase(from: DOMRect, phrase: string, font: string, target: () => Point | null, start: number): Flight {
  const canvas = document.createElement("canvas");
  canvas.className = "condensation";
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", pointerEvents: "none", zIndex: "30" });
  document.body.append(canvas);
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(innerWidth * ratio);
  canvas.height = Math.round(innerHeight * ratio);
  const ctx = canvas.getContext("2d");
  const seeds = Array.from({ length: PARTICLES }, (_, i) => ({
    x: from.left + ((i + 0.5) / PARTICLES) * from.width,
    y: from.top + from.height / 2 + Math.sin(i * 2.4) * from.height * 0.3,
    lag: (i % 7) * 0.035,
    bend: 0.6 + ((i * 37) % 11) / 22,
  }));
  let landing: (() => Point | null) | null = null;
  let fadingFrom: number | null = null;
  let frame = 0;

  const finish = () => {
    cancelAnimationFrame(frame);
    canvas.remove();
  };

  const tick = () => {
    if (!ctx) return finish();
    const t = performance.now() - start;
    const goal = target() ?? { x: from.left, y: from.top };
    const star = landing?.() ?? goal;
    const fadeOut = fadingFrom === null ? 1 : 1 - ease((performance.now() - fadingFrom) / FADE_MS);
    if (fadeOut <= 0 || (landing && t >= SETTLE_AT)) return finish();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (t >= LIFT_AT) {
      const lift = ease((t - LIFT_AT) / 300);
      const copyAlpha = (1 - ease((t - 300) / 160)) * fadeOut;
      if (copyAlpha > 0) {
        ctx.font = font;
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(110, 240, 220, 0.9)";
        ctx.shadowBlur = 14;
        ctx.fillStyle = `rgba(110, 240, 220, ${copyAlpha})`;
        ctx.fillText(phrase, from.left, from.top + from.height / 2 - lift * 14, Math.max(40, from.width));
      }
      ctx.shadowBlur = 10;
      for (const seed of seeds) {
        const travel = ease((t - LIFT_AT - 140 - seed.lag * 1000) / (GATHER_AT - LIFT_AT - 140));
        const gather = ease((t - GATHER_AT) / (SETTLE_AT - GATHER_AT));
        const mid = { x: (seed.x + goal.x) / 2, y: Math.min(seed.y, goal.y) - 120 * seed.bend };
        const u = travel;
        const x = (1 - u) ** 2 * seed.x + 2 * (1 - u) * u * mid.x + u * u * goal.x;
        const y = (1 - u) ** 2 * (seed.y - 14) + 2 * (1 - u) * u * mid.y + u * u * goal.y;
        const px = x + (star.x - x) * gather;
        const py = y + (star.y - y) * gather;
        const alpha = Math.min(1, travel * 3) * (landing ? 1 - gather * 0.85 : 0.9) * fadeOut;
        ctx.fillStyle = `rgba(110, 240, 220, ${alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, 1.6 + (1 - gather) * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return {
    land(star) {
      landing = star;
      if (performance.now() - start >= SETTLE_AT) fadingFrom = performance.now();
    },
    fade() {
      fadingFrom = performance.now();
    },
  };
}
