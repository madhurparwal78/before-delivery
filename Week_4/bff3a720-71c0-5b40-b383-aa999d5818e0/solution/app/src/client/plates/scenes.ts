/** Seeded scene renderer for the route plates. Draws muted road-trip scenes with fine film grain; never any lettering. */

export type SceneName = "coast-road" | "rear-seat" | "fields" | "ramp" | "coast" | "long-road";

const SCENES: readonly SceneName[] = ["coast-road", "rear-seat", "fields", "ramp", "coast", "long-road"];

type Rand = () => number;

function hash(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry(seed: number): Rand {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sceneFor(seed: string): SceneName {
  return SCENES[hash(seed) % SCENES.length] ?? "coast-road";
}

interface Palette {
  skyTop: string;
  skyLow: string;
  haze: string;
  sea: string;
  seaLight: string;
  land: string;
  landDark: string;
  asphalt: string;
  warm: string;
  cloth: string;
}

const PALETTES: readonly Palette[] = [
  { skyTop: "#9aa3a0", skyLow: "#d4cfc1", haze: "#c9c6bb", sea: "#6f8584", seaLight: "#a9b8b2", land: "#7c8461", landDark: "#4c523d", asphalt: "#3d403f", warm: "#b78d5f", cloth: "#8f5b3d" },
  { skyTop: "#a9a79c", skyLow: "#dccfb4", haze: "#d3c8b0", sea: "#78807a", seaLight: "#b4b5a4", land: "#8a8a5b", landDark: "#575a3c", asphalt: "#45423d", warm: "#c09a62", cloth: "#6e6a4b" },
  { skyTop: "#8d9aa0", skyLow: "#cfd0c8", haze: "#bfc4bd", sea: "#5f7a80", seaLight: "#9db2b3", land: "#6e7a62", landDark: "#414a40", asphalt: "#363b3d", warm: "#a98466", cloth: "#7a4f46" },
  { skyTop: "#a59c92", skyLow: "#e0cfb7", haze: "#d8c7ac", sea: "#7d8480", seaLight: "#bdb7a3", land: "#92866a", landDark: "#5e5744", asphalt: "#43403b", warm: "#c5a070", cloth: "#5f6a5c" },
];

function channels(color: string): number[] {
  if (color.startsWith("#")) return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return (color.match(/\d+/g) ?? ["0", "0", "0"]).slice(0, 3).map(Number);
}

function lerpColor(a: string, b: string, t: number): string {
  const pa = channels(a);
  const pb = channels(b);
  const out = pa.map((v, i) => Math.round(v + ((pb[i] ?? v) - v) * t));
  return `rgb(${out[0]},${out[1]},${out[2]})`;
}

function noise1(seedNum: number): (x: number) => number {
  const r = mulberry(seedNum);
  const values = Array.from({ length: 64 }, () => r());
  const at = (i: number): number => values[((i % 64) + 64) % 64] ?? 0;
  return (x: number) => {
    const i = Math.floor(x);
    const f = x - i;
    const s = f * f * (3 - 2 * f);
    return at(i) * (1 - s) + at(i + 1) * s;
  };
}

function fbm(n: (x: number) => number, x: number): number {
  return n(x) * 0.55 + n(x * 2.1 + 7) * 0.3 + n(x * 4.3 + 13) * 0.15;
}

function sky(c: CanvasRenderingContext2D, w: number, p: Palette, horizon: number): void {
  const g = c.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, p.skyTop);
  g.addColorStop(1, p.skyLow);
  c.fillStyle = g;
  c.fillRect(0, 0, w, horizon + 2);
}

function clouds(c: CanvasRenderingContext2D, w: number, h: number, r: Rand, horizon: number, tone: string, count: number): void {
  c.save();
  for (let i = 0; i < count; i += 1) {
    const x = r() * w;
    const y = r() * horizon * 0.7;
    const rw = w * (0.18 + r() * 0.3);
    const rh = h * (0.025 + r() * 0.05);
    const g = c.createRadialGradient(x, y, 0, x, y, rw);
    g.addColorStop(0, tone);
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.globalAlpha = 0.18 + r() * 0.2;
    c.fillStyle = g;
    c.save();
    c.translate(x, y);
    c.scale(1, rh / rw);
    c.translate(-x, -y);
    c.beginPath();
    c.arc(x, y, rw, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  c.restore();
}

function ridge(
  c: CanvasRenderingContext2D, w: number, base: number, amp: number, freq: number, seedNum: number,
  top: string, bottom: string, bottomY: number,
): void {
  const n = noise1(seedNum);
  c.beginPath();
  c.moveTo(0, bottomY);
  for (let x = 0; x <= w; x += 3) c.lineTo(x, base - fbm(n, (x / w) * freq) * amp);
  c.lineTo(w, bottomY);
  c.closePath();
  const g = c.createLinearGradient(0, base - amp, 0, bottomY);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  c.fillStyle = g;
  c.fill();
}

function rain(c: CanvasRenderingContext2D, w: number, h: number, r: Rand, density: number, alpha: number): void {
  c.save();
  c.strokeStyle = `rgba(235,235,228,${alpha})`;
  c.lineWidth = Math.max(0.6, w / 900);
  for (let i = 0; i < density; i += 1) {
    const x = r() * w;
    const y = r() * h;
    const len = h * (0.02 + r() * 0.035);
    c.globalAlpha = 0.25 + r() * 0.6;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x - len * 0.18, y + len);
    c.stroke();
  }
  c.restore();
}

function seaBand(c: CanvasRenderingContext2D, w: number, y0: number, y1: number, p: Palette, r: Rand, glint: number): void {
  const g = c.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, p.seaLight);
  g.addColorStop(0.35, p.sea);
  g.addColorStop(1, lerpColor(p.sea, "#2c3a3b", 0.55));
  c.fillStyle = g;
  c.fillRect(0, y0, w, y1 - y0);
  c.save();
  for (let i = 0; i < glint; i += 1) {
    const t = Math.pow(r(), 1.6);
    const y = y0 + t * (y1 - y0);
    const len = w * (0.04 + r() * 0.18) * (0.4 + t);
    const x = r() * w;
    c.globalAlpha = 0.1 + r() * 0.28;
    c.fillStyle = r() > 0.35 ? "#e9e4d3" : "#2e3d3e";
    c.fillRect(x, y, len, Math.max(1, (y1 - y0) * 0.006 * (0.5 + t)));
  }
  c.restore();
}

function road(
  c: CanvasRenderingContext2D, w: number, h: number, p: Palette, vx: number, horizon: number,
  nearHalf: number, dashes: boolean, wet: number, sheen: string,
): void {
  const left = vx - nearHalf;
  const right = vx + nearHalf;
  const farHalf = nearHalf * 0.035;
  const g = c.createLinearGradient(0, horizon, 0, h);
  g.addColorStop(0, lerpColor(p.asphalt, p.haze, 0.55));
  g.addColorStop(0.5, p.asphalt);
  g.addColorStop(1, lerpColor(p.asphalt, "#1c1d1d", 0.5));
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(vx - farHalf, horizon);
  c.lineTo(vx + farHalf, horizon);
  c.lineTo(right, h);
  c.lineTo(left, h);
  c.closePath();
  c.fill();
  if (wet > 0) {
    const s = c.createLinearGradient(0, horizon, 0, h);
    s.addColorStop(0, sheen);
    s.addColorStop(0.6, "rgba(255,255,255,0.06)");
    s.addColorStop(1, "rgba(255,255,255,0)");
    c.save();
    c.globalAlpha = wet;
    c.fillStyle = s;
    c.beginPath();
    c.moveTo(vx - farHalf, horizon);
    c.lineTo(vx + farHalf, horizon);
    c.lineTo(vx + nearHalf * 0.55, h);
    c.lineTo(vx - nearHalf * 0.55, h);
    c.closePath();
    c.fill();
    c.restore();
  }
  c.strokeStyle = "rgba(226,220,200,0.55)";
  c.lineWidth = Math.max(1, w / 400);
  for (const side of [-1, 1]) {
    c.beginPath();
    c.moveTo(vx + side * farHalf * 0.88, horizon);
    c.lineTo(vx + side * nearHalf * 0.92, h);
    c.stroke();
  }
  if (dashes) {
    c.fillStyle = "rgba(226,214,170,0.6)";
    for (let i = 0; i < 9; i += 1) {
      const t0 = Math.pow(i / 9, 1.9);
      const t1 = Math.pow((i + 0.5) / 9, 1.9);
      const y0 = horizon + t0 * (h - horizon);
      const y1 = horizon + t1 * (h - horizon);
      const w0 = 0.6 + t0 * nearHalf * 0.03;
      const w1 = 0.6 + t1 * nearHalf * 0.03;
      c.beginPath();
      c.moveTo(vx - w0, y0);
      c.lineTo(vx + w0, y0);
      c.lineTo(vx + w1, y1);
      c.lineTo(vx - w1, y1);
      c.closePath();
      c.fill();
    }
  }
}

function trees(c: CanvasRenderingContext2D, r: Rand, x0: number, x1: number, baseY: number, size: number, count: number, tone: string): void {
  for (let i = 0; i < count; i += 1) {
    const x = x0 + r() * (x1 - x0);
    const s = size * (0.5 + r() * 0.8);
    const g = c.createRadialGradient(x - s * 0.2, baseY - s * 1.1, s * 0.1, x, baseY - s, s);
    g.addColorStop(0, lerpColor(tone, "#a9ad8d", 0.25));
    g.addColorStop(1, tone);
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(x, baseY - s * 0.95, s * 0.8, s * 0.95, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "rgba(40,36,30,0.7)";
    c.fillRect(x - s * 0.04, baseY - s * 0.3, s * 0.08, s * 0.3);
  }
}

function coastRoad(c: CanvasRenderingContext2D, w: number, h: number, r: Rand, p: Palette): void {
  const horizon = h * 0.46;
  sky(c, w, p, horizon);
  clouds(c, w, h, r, horizon, "rgba(250,248,240,0.9)", 9);
  const seedBase = Math.floor(r() * 1e6);
  ridge(c, w, horizon + h * 0.02, h * 0.16, 2.4, seedBase, lerpColor(p.haze, p.sea, 0.35), lerpColor(p.haze, p.sea, 0.6), horizon + h * 0.04);
  seaBand(c, w, horizon, horizon + h * 0.2, p, r, 60);
  ridge(c, w, horizon + h * 0.2, h * 0.1, 3.2, seedBase + 5, lerpColor(p.land, p.haze, 0.35), p.land, h);
  const vx = w * (0.52 + r() * 0.08);
  ridge(c, w, horizon + h * 0.3, h * 0.09, 4, seedBase + 9, p.land, p.landDark, h);
  road(c, w, h, p, vx, horizon + h * 0.12, w * 0.62, true, 0.9, "rgba(222,226,220,0.7)");
  trees(c, r, 0, vx - w * 0.2, horizon + h * 0.36, h * 0.05, 7, p.landDark);
  c.save();
  c.globalAlpha = 0.5;
  const mist = c.createLinearGradient(0, horizon - h * 0.05, 0, horizon + h * 0.2);
  mist.addColorStop(0, "rgba(220,218,206,0)");
  mist.addColorStop(0.5, "rgba(220,218,206,0.55)");
  mist.addColorStop(1, "rgba(220,218,206,0)");
  c.fillStyle = mist;
  c.fillRect(0, horizon - h * 0.05, w, h * 0.25);
  c.restore();
  rain(c, w, h, r, Math.round((w * h) / 2600), 0.5);
}

function fieldsScene(c: CanvasRenderingContext2D, w: number, h: number, r: Rand, p: Palette): void {
  const horizon = h * 0.4;
  sky(c, w, p, horizon);
  clouds(c, w, h, r, horizon, "rgba(250,246,236,0.9)", 8);
  const seedBase = Math.floor(r() * 1e6);
  ridge(c, w, horizon + 2, h * 0.09, 2.6, seedBase, lerpColor(p.haze, p.land, 0.35), lerpColor(p.haze, p.land, 0.55), horizon + h * 0.06);
  const bands = 7;
  for (let i = 0; i < bands; i += 1) {
    const t0 = i / bands;
    const y0 = horizon + Math.pow(t0, 1.7) * (h - horizon);
    const y1 = horizon + Math.pow((i + 1) / bands, 1.7) * (h - horizon) + 1;
    const hue = r();
    const base = hue > 0.65 ? p.warm : hue > 0.3 ? p.land : lerpColor(p.land, p.landDark, 0.4);
    const g = c.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, lerpColor(base, p.haze, 0.45 * (1 - t0)));
    g.addColorStop(1, lerpColor(base, p.landDark, 0.3));
    c.fillStyle = g;
    const n = noise1(seedBase + i * 11);
    c.beginPath();
    c.moveTo(0, y1);
    for (let x = 0; x <= w; x += 4) c.lineTo(x, y0 - fbm(n, (x / w) * 3) * (y1 - y0) * 0.35);
    c.lineTo(w, y1);
    c.closePath();
    c.fill();
    c.strokeStyle = "rgba(40,38,28,0.18)";
    c.lineWidth = Math.max(1, (y1 - y0) / 40);
    const rows = 4 + i * 2;
    for (let k = 1; k < rows; k += 1) {
      const yy = y0 + ((y1 - y0) * k) / rows;
      c.beginPath();
      c.moveTo(0, yy);
      c.lineTo(w, yy + (r() - 0.5) * 2);
      c.stroke();
    }
    if (i % 2 === 1) {
      c.fillStyle = lerpColor(p.landDark, "#1f2a1f", 0.3);
      c.fillRect(0, y1 - (y1 - y0) * 0.12, w, (y1 - y0) * 0.12);
      trees(c, r, 0, w, y1 - (y1 - y0) * 0.06, (y1 - y0) * 0.5, 5 + i, p.landDark);
    }
  }
  const vx = w * (0.3 + r() * 0.4);
  c.strokeStyle = "rgba(214,200,164,0.55)";
  c.lineWidth = Math.max(2, w / 160);
  c.beginPath();
  c.moveTo(vx, horizon + h * 0.04);
  c.bezierCurveTo(vx - w * 0.05, h * 0.62, vx + w * 0.2, h * 0.78, vx + w * 0.1, h);
  c.stroke();
}

function rampScene(c: CanvasRenderingContext2D, w: number, h: number, r: Rand, p: Palette): void {
  const horizon = h * 0.42;
  sky(c, w, p, horizon);
  clouds(c, w, h, r, horizon, "rgba(250,246,236,0.9)", 7);
  seaBand(c, w, horizon, h, p, r, 80);
  const seedBase = Math.floor(r() * 1e6);
  ridge(c, w, horizon + 1, h * 0.07, 2, seedBase, lerpColor(p.haze, p.sea, 0.4), lerpColor(p.haze, p.sea, 0.6), horizon + 6);
  const fx = w * (0.1 + r() * 0.3);
  const fw = w * 0.34;
  c.fillStyle = lerpColor("#4b514f", p.haze, 0.35);
  c.fillRect(fx, horizon - h * 0.12, fw, h * 0.15);
  c.fillStyle = lerpColor("#9a9a90", p.haze, 0.3);
  c.fillRect(fx + fw * 0.06, horizon - h * 0.2, fw * 0.5, h * 0.09);
  c.fillStyle = "rgba(40,44,44,0.65)";
  for (let i = 0; i < 6; i += 1) c.fillRect(fx + fw * (0.1 + i * 0.07), horizon - h * 0.18, fw * 0.035, h * 0.04);
  const g = c.createLinearGradient(0, h * 0.55, 0, h);
  g.addColorStop(0, "#a29f95");
  g.addColorStop(1, "#6f6d65");
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(w * 0.2, h * 0.58);
  c.lineTo(w * 0.62, h * 0.58);
  c.lineTo(w * 1.1, h);
  c.lineTo(-w * 0.05, h);
  c.closePath();
  c.fill();
  c.strokeStyle = "rgba(60,58,52,0.35)";
  c.lineWidth = Math.max(1, w / 500);
  for (let i = 0; i < 12; i += 1) {
    const t = Math.pow(i / 12, 1.6);
    const y = h * 0.58 + t * h * 0.42;
    const inset = (1 - t) * w * 0.0;
    c.beginPath();
    c.moveTo(w * 0.2 - t * w * 0.25 + inset, y);
    c.lineTo(w * 0.62 + t * w * 0.48 - inset, y);
    c.stroke();
  }
  c.fillStyle = "#c4a45a";
  for (let i = 0; i < 3; i += 1) {
    const t = 0.15 + i * 0.3;
    const x = w * 0.2 - t * w * 0.2 + 6;
    const y = h * 0.58 + t * h * 0.42;
    c.fillRect(x, y - h * 0.05 * (0.5 + t), w * 0.012 * (0.6 + t), h * 0.05 * (0.5 + t));
  }
  c.fillStyle = "rgba(40,50,52,0.55)";
  c.fillRect(0, h * 0.9, w, h * 0.1);
  rain(c, w, h, r, Math.round((w * h) / 5200), 0.35);
}

function coastScene(c: CanvasRenderingContext2D, w: number, h: number, r: Rand, p: Palette): void {
  const horizon = h * 0.5;
  sky(c, w, p, horizon);
  const sun = c.createRadialGradient(w * (0.3 + r() * 0.4), horizon, 0, w * 0.5, horizon, w * 0.5);
  sun.addColorStop(0, "rgba(255,244,214,0.75)");
  sun.addColorStop(1, "rgba(255,244,214,0)");
  c.fillStyle = sun;
  c.fillRect(0, 0, w, horizon);
  clouds(c, w, h, r, horizon, "rgba(250,242,226,0.95)", 7);
  seaBand(c, w, horizon, h * 0.86, p, r, 120);
  const seedBase = Math.floor(r() * 1e6);
  const n = noise1(seedBase);
  c.beginPath();
  c.moveTo(0, h);
  c.lineTo(0, h * 0.62);
  for (let x = 0; x <= w; x += 3) c.lineTo(x, h * 0.72 + fbm(n, (x / w) * 3) * h * 0.18 - (x / w) * h * 0.08);
  c.lineTo(w, h);
  c.closePath();
  const land = c.createLinearGradient(0, h * 0.6, 0, h);
  land.addColorStop(0, p.land);
  land.addColorStop(1, p.landDark);
  c.fillStyle = land;
  c.fill();
  c.strokeStyle = "rgba(244,240,226,0.5)";
  c.lineWidth = Math.max(1, w / 300);
  for (let i = 0; i < 5; i += 1) {
    const y = h * (0.6 + i * 0.04);
    c.beginPath();
    c.moveTo(w * 0.3, y);
    c.bezierCurveTo(w * 0.5, y - 5, w * 0.7, y + 5, w, y - 2);
    c.stroke();
  }
}

function longRoad(c: CanvasRenderingContext2D, w: number, h: number, r: Rand, p: Palette): void {
  const horizon = h * 0.44;
  sky(c, w, p, horizon);
  clouds(c, w, h, r, horizon, "rgba(250,246,236,0.9)", 8);
  const seedBase = Math.floor(r() * 1e6);
  ridge(c, w, horizon + 2, h * 0.08, 2.2, seedBase, lerpColor(p.haze, p.land, 0.4), lerpColor(p.haze, p.land, 0.6), horizon + h * 0.05);
  c.fillStyle = lerpColor(p.land, p.haze, 0.2);
  c.fillRect(0, horizon + h * 0.03, w, h);
  const vx = w * (0.45 + r() * 0.15);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 9; i += 1) {
      const t = Math.pow((i + 1) / 9, 1.8);
      const x = vx + side * (w * 0.03 + t * w * 0.5);
      const y = horizon + h * 0.05 + t * h * 0.5;
      const s = h * (0.03 + t * 0.2);
      trees(c, r, x, x + 1, y, s, 1, lerpColor(p.landDark, p.haze, 0.35 * (1 - t)));
    }
  }
  road(c, w, h, p, vx, horizon + h * 0.04, w * 0.5, true, 0.35, "rgba(228,224,210,0.5)");
  c.save();
  const mist = c.createLinearGradient(0, horizon - h * 0.04, 0, horizon + h * 0.22);
  mist.addColorStop(0, "rgba(222,216,200,0)");
  mist.addColorStop(0.55, "rgba(222,216,200,0.6)");
  mist.addColorStop(1, "rgba(222,216,200,0)");
  c.fillStyle = mist;
  c.fillRect(0, horizon - h * 0.04, w, h * 0.26);
  c.restore();
}

function coat(c: CanvasRenderingContext2D, x: number, y: number, s: number, p: Palette): void {
  c.save();
  c.translate(x, y);
  c.rotate(-0.08);
  const g = c.createLinearGradient(0, -s * 0.3, 0, s * 0.35);
  g.addColorStop(0, lerpColor(p.cloth, "#d9cdb3", 0.18));
  g.addColorStop(1, lerpColor(p.cloth, "#1f1a15", 0.35));
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(-s * 0.55, s * 0.2);
  c.bezierCurveTo(-s * 0.6, -s * 0.2, -s * 0.3, -s * 0.34, 0, -s * 0.3);
  c.bezierCurveTo(s * 0.35, -s * 0.34, s * 0.62, -s * 0.18, s * 0.58, s * 0.22);
  c.bezierCurveTo(s * 0.3, s * 0.34, -s * 0.2, s * 0.32, -s * 0.55, s * 0.2);
  c.closePath();
  c.fill();
  c.strokeStyle = "rgba(25,18,12,0.45)";
  c.lineWidth = Math.max(1.5, s / 60);
  for (const k of [-0.25, 0, 0.22]) {
    c.beginPath();
    c.moveTo(s * k - s * 0.08, -s * 0.28);
    c.bezierCurveTo(s * k + s * 0.1, -s * 0.05, s * k - s * 0.1, s * 0.1, s * k + s * 0.04, s * 0.3);
    c.stroke();
  }
  c.fillStyle = "rgba(240,226,196,0.14)";
  c.beginPath();
  c.ellipse(-s * 0.1, -s * 0.18, s * 0.28, s * 0.07, -0.1, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "rgba(30,24,18,0.8)";
  c.beginPath();
  c.ellipse(s * 0.5, s * 0.02, s * 0.06, s * 0.1, 0.2, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

function rearSeat(c: CanvasRenderingContext2D, w: number, h: number, r: Rand, p: Palette): void {
  c.fillStyle = "#26231f";
  c.fillRect(0, 0, w, h);
  const wx = w * 0.12;
  const wy = h * 0.06;
  const ww = w * 0.76;
  const wh = h * 0.46;
  c.save();
  c.beginPath();
  c.moveTo(wx + ww * 0.04, wy);
  c.lineTo(wx + ww, wy + wh * 0.04);
  c.lineTo(wx + ww * 0.97, wy + wh);
  c.lineTo(wx, wy + wh * 0.97);
  c.closePath();
  c.clip();
  const horizon = wy + wh * 0.5;
  sky(c, w, p, horizon);
  clouds(c, w, h, r, horizon, "rgba(250,246,236,0.9)", 4);
  seaBand(c, w, horizon, wy + wh, p, r, 40);
  const fx = wx + ww * 0.52;
  c.fillStyle = lerpColor("#4b514f", p.haze, 0.3);
  c.fillRect(fx, horizon - wh * 0.22, ww * 0.36, wh * 0.26);
  c.fillStyle = lerpColor("#9a9a90", p.haze, 0.3);
  c.fillRect(fx + ww * 0.05, horizon - wh * 0.38, ww * 0.16, wh * 0.16);
  const g = c.createLinearGradient(0, horizon, 0, wy + wh);
  g.addColorStop(0, "#9b988d");
  g.addColorStop(1, "#6d6a62");
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(wx, horizon + wh * 0.18);
  c.lineTo(wx + ww * 0.5, horizon + wh * 0.18);
  c.lineTo(wx + ww * 0.62, wy + wh);
  c.lineTo(wx, wy + wh);
  c.closePath();
  c.fill();
  c.strokeStyle = "rgba(240,240,230,0.35)";
  c.lineWidth = 1;
  for (let i = 0; i < 20; i += 1) {
    c.beginPath();
    c.moveTo(wx + r() * ww, wy + r() * wh);
    c.lineTo(wx + r() * ww - 6, wy + r() * wh + wh * 0.07);
    c.stroke();
  }
  c.restore();
  const sheen = c.createLinearGradient(wx, wy, wx + ww, wy + wh);
  sheen.addColorStop(0, "rgba(255,255,255,0.1)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0)");
  sheen.addColorStop(1, "rgba(255,255,255,0.06)");
  c.fillStyle = sheen;
  c.fillRect(wx, wy, ww, wh);
  const seatTop = h * 0.5;
  const back = c.createLinearGradient(0, seatTop, 0, h);
  back.addColorStop(0, lerpColor("#3e3b34", p.cloth, 0.12));
  back.addColorStop(1, "#1d1a16");
  c.fillStyle = back;
  c.beginPath();
  c.moveTo(0, seatTop + h * 0.04);
  c.bezierCurveTo(w * 0.25, seatTop - h * 0.02, w * 0.75, seatTop - h * 0.02, w, seatTop + h * 0.04);
  c.lineTo(w, h);
  c.lineTo(0, h);
  c.closePath();
  c.fill();
  for (const hx of [0.2, 0.5, 0.8]) {
    const x = w * hx;
    const hg = c.createLinearGradient(0, seatTop - h * 0.1, 0, seatTop + h * 0.06);
    hg.addColorStop(0, "#4a463d");
    hg.addColorStop(1, "#2a2722");
    c.fillStyle = hg;
    c.beginPath();
    c.roundRect(x - w * 0.07, seatTop - h * 0.08, w * 0.14, h * 0.13, w * 0.025);
    c.fill();
  }
  c.strokeStyle = "rgba(220,205,170,0.22)";
  c.lineWidth = Math.max(1, w / 400);
  for (const hx of [0.35, 0.65]) {
    c.beginPath();
    c.moveTo(w * hx, seatTop + h * 0.04);
    c.lineTo(w * hx, h);
    c.stroke();
  }
  for (let i = 1; i < 6; i += 1) {
    c.beginPath();
    c.moveTo(0, seatTop + h * (0.08 + i * 0.08));
    c.bezierCurveTo(w * 0.3, seatTop + h * (0.075 + i * 0.08), w * 0.7, seatTop + h * (0.085 + i * 0.08), w, seatTop + h * (0.08 + i * 0.08));
    c.stroke();
  }
  coat(c, w * 0.42, h * 0.74, Math.min(w, h * 1.1) * 0.7, p);
  c.strokeStyle = "rgba(15,14,12,0.85)";
  c.lineWidth = Math.max(4, w / 40);
  c.beginPath();
  c.moveTo(w * 0.86, wy);
  c.lineTo(w * 0.72, seatTop + h * 0.05);
  c.lineTo(w * 0.78, h);
  c.stroke();
  c.fillStyle = "#15130f";
  c.fillRect(0, 0, wx * 0.8, h * 0.52);
  c.fillRect(w - wx * 0.6, 0, wx * 0.6, h * 0.52);
}

function vignette(c: CanvasRenderingContext2D, w: number, h: number): void {
  const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, "rgba(30,26,20,0)");
  g.addColorStop(1, "rgba(30,26,20,0.28)");
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
}

function grain(c: CanvasRenderingContext2D, w: number, h: number, r: Rand): void {
  const image = c.getImageData(0, 0, w, h);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (r() + r() + r() - 1.5) * 26;
    data[i] = Math.max(0, Math.min(255, (data[i] ?? 0) + n));
    data[i + 1] = Math.max(0, Math.min(255, (data[i + 1] ?? 0) + n * 0.96));
    data[i + 2] = Math.max(0, Math.min(255, (data[i + 2] ?? 0) + n * 0.9));
  }
  c.putImageData(image, 0, 0);
}

export function drawScene(canvas: HTMLCanvasElement, scene: SceneName, seed: string, width: number, height: number): void {
  const w = Math.max(32, Math.round(width));
  const h = Math.max(32, Math.round(height));
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d", { willReadFrequently: true });
  if (!c) return;
  const r = mulberry(hash(`${scene}:${seed}`));
  const p = PALETTES[hash(seed) % PALETTES.length] ?? PALETTES[0]!;
  switch (scene) {
    case "coast-road": coastRoad(c, w, h, r, p); break;
    case "rear-seat": rearSeat(c, w, h, r, p); break;
    case "fields": fieldsScene(c, w, h, r, p); break;
    case "ramp": rampScene(c, w, h, r, p); break;
    case "coast": coastScene(c, w, h, r, p); break;
    case "long-road": longRoad(c, w, h, r, p); break;
  }
  vignette(c, w, h);
  grain(c, w, h, r);
}
