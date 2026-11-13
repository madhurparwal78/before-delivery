// The lunar disc: the orthographic projection and pointer picking, written
// once and shared by the author console and the share page.

import type { ApiSample } from "./shapes.js";

export interface ProjectedPoint {
  x: number;
  y: number;
  visible: boolean;
}

export function projectPoint(
  lat: number,
  lon: number,
  lon0: number,
  size: number,
): ProjectedPoint {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;
  const latRad = (lat * Math.PI) / 180;
  const lonRad = ((lon - lon0) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(latRad) * Math.sin(lonRad),
    y: cy - r * Math.sin(latRad),
    visible: Math.cos(latRad) * Math.cos(lonRad) > 0,
  };
}

export function pickSample(
  samples: ApiSample[],
  cssX: number,
  cssY: number,
  lon0: number,
  size: number,
  maxDistance = 24,
): number | null {
  let best: number | null = null;
  let bestDistance = maxDistance;
  for (let i = 0; i < samples.length; i++) {
    const p = projectPoint(samples[i].lat_deg, samples[i].lon_deg, lon0, size);
    if (!p.visible) continue;
    const distance = Math.hypot(p.x - cssX, p.y - cssY);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

interface DiscColours {
  ground: string;
  ink: string;
  rust: string;
  rule: string;
  forced: boolean;
}

function resolveColours(): DiscColours {
  const styles = getComputedStyle(document.documentElement);
  const forced = window.matchMedia("(forced-colors: active)").matches;
  return {
    ground: styles.getPropertyValue("--ground").trim() || "#d8d2c8",
    ink: styles.getPropertyValue("--ink").trim() || "#26221c",
    rust: styles.getPropertyValue("--rust").trim() || "#b4551f",
    rule: styles.getPropertyValue("--rule").trim() || "#a89f93",
    forced,
  };
}

export interface DiscDrawOptions {
  samples: ApiSample[];
  lon0: number;
  events: Array<{ met: number }>;
  lines: Array<{ met: number }>;
  landmarks: Array<{ lat_deg: number; lon_deg: number }>;
  showPins: boolean;
  showTicks: boolean;
}

export function drawDisc(canvas: HTMLCanvasElement, options: DiscDrawOptions): void {
  const dpr = window.devicePixelRatio || 1;
  const cssSize = canvas.clientWidth;
  if (cssSize === 0) return;
  const backing = Math.round(cssSize * dpr);
  if (canvas.width !== backing || canvas.height !== backing) {
    canvas.width = backing;
    canvas.height = backing;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssSize, cssSize);

  const colours = resolveColours();
  const discFill = colours.forced ? "Canvas" : colours.ground;
  const trackColour = colours.forced ? "CanvasText" : colours.rust;
  const graticuleColour = colours.forced ? "GrayText" : colours.rule;
  const pinColour = colours.forced ? "LinkText" : colours.rust;

  const r = cssSize / 2;
  ctx.beginPath();
  ctx.arc(r, r, r - 2, 0, Math.PI * 2);
  ctx.fillStyle = discFill;
  ctx.fill();

  // Graticule every 30 degrees.
  ctx.strokeStyle = graticuleColour;
  ctx.lineWidth = 1;
  for (let lat = -60; lat <= 60; lat += 30) {
    ctx.beginPath();
    let started = false;
    for (let lon = -180; lon <= 180; lon += 2) {
      const p = projectPoint(lat, lon, options.lon0, cssSize);
      if (p.visible) {
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else {
          ctx.lineTo(p.x, p.y);
        }
      } else {
        started = false;
      }
    }
    ctx.stroke();
  }
  for (let lon = -180; lon < 180; lon += 30) {
    ctx.beginPath();
    let started = false;
    for (let lat = -90; lat <= 90; lat += 2) {
      const p = projectPoint(lat, lon, options.lon0, cssSize);
      if (p.visible) {
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else {
          ctx.lineTo(p.x, p.y);
        }
      } else {
        started = false;
      }
    }
    ctx.stroke();
  }

  // Ground track: a faint dotted line on the hidden hemisphere.
  const points = options.samples.map((s) => projectPoint(s.lat_deg, s.lon_deg, options.lon0, cssSize));
  ctx.save();
  ctx.setLineDash([2, 4]);
  ctx.strokeStyle = trackColour;
  ctx.globalAlpha = colours.forced ? 1 : 0.35;
  ctx.lineWidth = 1;
  ctx.beginPath();
  let drawing = false;
  for (const p of points) {
    if (!p.visible) {
      drawing = false;
      continue;
    }
    if (!drawing) {
      ctx.moveTo(p.x, p.y);
      drawing = true;
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }
  ctx.stroke();
  ctx.restore();

  // The visible track: 2 pixels.
  ctx.strokeStyle = trackColour;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  drawing = false;
  for (const p of points) {
    if (!p.visible) {
      drawing = false;
      continue;
    }
    if (!drawing) {
      ctx.moveTo(p.x, p.y);
      drawing = true;
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }
  ctx.stroke();

  // Landmark squares.
  ctx.fillStyle = pinColour;
  for (const landmark of options.landmarks) {
    const p = projectPoint(landmark.lat_deg, landmark.lon_deg, options.lon0, cssSize);
    if (!p.visible) continue;
    ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
  }

  // Event pins.
  if (options.showPins) {
    for (const event of options.events) {
      const sample = sampleAtOrBefore(options.samples, event.met);
      if (!sample) continue;
      const p = projectPoint(sample.lat_deg, sample.lon_deg, options.lon0, cssSize);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Transcript ticks.
  if (options.showTicks) {
    ctx.strokeStyle = trackColour;
    for (const line of options.lines) {
      const sample = sampleAtOrBefore(options.samples, line.met);
      if (!sample) continue;
      const p = projectPoint(sample.lat_deg, sample.lon_deg, options.lon0, cssSize);
      if (!p.visible) continue;
      ctx.beginPath();
      ctx.moveTo(p.x - 3, p.y - 3);
      ctx.lineTo(p.x + 3, p.y + 3);
      ctx.stroke();
    }
  }
}

export function sampleAtOrBefore(samples: ApiSample[], met: number): ApiSample | null {
  for (let i = samples.length - 1; i >= 0; i--) {
    if (samples[i].met <= met) return samples[i];
  }
  return samples[0] ?? null;
}

export function drawLens(
  lensCanvas: HTMLCanvasElement,
  source: HTMLCanvasElement,
  centre: { x: number; y: number },
): void {
  const ctx = lensCanvas.getContext("2d");
  if (!ctx) return;
  const size = 160;
  const scale = 4;
  const dpr = window.devicePixelRatio || 1;
  const backing = Math.round(size * dpr);
  if (lensCanvas.width !== backing || lensCanvas.height !== backing) {
    lensCanvas.width = backing;
    lensCanvas.height = backing;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(size / 2, size / 2);
  ctx.scale(scale, scale);
  ctx.translate(-centre.x, -centre.y);
  ctx.drawImage(source, 0, 0, source.clientWidth, source.clientWidth);
  ctx.restore();
  const forced = window.matchMedia("(forced-colors: active)").matches;
  ctx.strokeStyle = forced ? "CanvasText" : "Highlight";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(size / 2 - 10, size / 2);
  ctx.lineTo(size / 2 + 10, size / 2);
  ctx.moveTo(size / 2, size / 2 - 10);
  ctx.lineTo(size / 2, size / 2 + 10);
  ctx.stroke();
}
