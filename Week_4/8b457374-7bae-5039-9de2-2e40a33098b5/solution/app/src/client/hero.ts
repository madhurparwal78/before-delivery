import { s } from "./dom.js";

// The home hero's disc (brief: Visual design › Hero): a flat teal disc about 1.2 x the window height across,
// centred near three quarters across and a little below the middle, cropped top, right and bottom; its left
// edge breaks into a hex halftone ramp of shrinking dots that fades into paper. On phones it sits at the
// bottom, about 1.3 x the screen width across, its top a little below the middle, and the ramp rises from
// its top edge (it rings the whole disc; the crop hides the rest). The SVG element's own box is exactly the disc; the ramp is drawn outside it.

const RAMP = 0.14;
const HEADLINE_CLEAR = 48;

function phoneHero(): boolean {
  return innerWidth < 768 || innerWidth < innerHeight;
}

/** Draws the disc into `host` (the hero section) for the current window size. */
export function drawDisc(host: HTMLElement): void {
  host.querySelector(".hero-disc")?.remove();
  const top = host.getBoundingClientRect().top + scrollY;
  const phone = phoneHero();
  const R = phone ? innerWidth * 0.65 : innerHeight * 0.6;
  const cx = phone ? innerWidth * 0.56 : innerWidth * 0.75;
  const cy = (phone ? innerHeight * 0.6 + R : innerHeight * 0.55) - top;
  const height = host.offsetHeight;
  const pitch = Math.min(16, Math.max(8, R / 38));
  const row = (pitch * Math.sqrt(3)) / 2;
  const outer = R * (1 + RAMP);
  const dots: SVGElement[] = [];
  for (let j = Math.floor(-outer / row); j <= Math.ceil(outer / row); j++) {
    const y = j * row;
    const shift = j % 2 ? pitch / 2 : 0;
    for (let i = Math.floor(-outer / pitch) - 1; i <= Math.ceil(outer / pitch); i++) {
      const x = i * pitch + shift;
      const d = Math.hypot(x, y);
      if (d < R - pitch || d > outer) continue;
      const tone = Math.min(1, (0.95 * (outer - d)) / (outer - R));
      if (tone < 0.01) continue;
      const r = (pitch * 1.155 * Math.sqrt(tone)) / 2;
      // A ramp dot the hero's edges would slice is left out, so the window crops the solid disc only.
      if (d > R && (cy + y - r < 0 || cy + y + r > height || cx + x + r > innerWidth)) continue;
      dots.push(s("circle", { cx: (R + x).toFixed(1), cy: (R + y).toFixed(1), r: r.toFixed(2) }));
    }
  }
  const disc = s("svg", { class: "hero-disc", viewBox: `0 0 ${2 * R} ${2 * R}`, "aria-hidden": "true", focusable: "false" },
    s("circle", { cx: R, cy: R, r: R }), ...dots);
  disc.style.left = `${cx - R}px`;
  disc.style.top = `${cy - R}px`;
  disc.style.width = `${2 * R}px`;
  disc.style.height = `${2 * R}px`;
  host.prepend(disc);
  if (!phone) fitHeadline(host, cx, cy, outer);
}

/** Keeps the headline's right edge HEADLINE_CLEAR px short of the ramp's outermost dots beside it. */
function fitHeadline(host: HTMLElement, cx: number, cy: number, outer: number): void {
  const headline = host.querySelector<HTMLElement>(".hero-title");
  if (!headline) return;
  headline.style.fontSize = "";
  const hostBox = host.getBoundingClientRect();
  const lines = [...headline.children].map((line) => line.getBoundingClientRect());
  const top = Math.min(...lines.map((b) => b.top)) - hostBox.top;
  const bottom = Math.max(...lines.map((b) => b.bottom)) - hostBox.top;
  const nearest = Math.min(Math.max(cy, top), bottom) - cy;
  const rampEdge = cx - Math.sqrt(Math.max(0, outer * outer - nearest * nearest));
  const right = Math.max(...lines.map((b) => b.right)) - hostBox.left;
  const left = Math.min(...lines.map((b) => b.left)) - hostBox.left;
  const room = rampEdge - HEADLINE_CLEAR - left;
  if (right - left > room) headline.style.fontSize = `${Math.max(32, (parseFloat(getComputedStyle(headline).fontSize) * room) / (right - left))}px`;
}
