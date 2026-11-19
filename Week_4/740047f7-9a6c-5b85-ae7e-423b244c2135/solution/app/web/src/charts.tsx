// Procedural 2D drawings of a pen: the card still (net rings and white pins on black water) and the flat net chart
// (metre-true panel grid, diamond hatch, white pins). Both draw only from stored pen data.
import { useEffect, useRef } from "react";
import type { Grid } from "./api";

export interface ChartPin { id: string; chart_x_m: number; depth_m: number; bearing_deg: number }
export interface ChartGeo { circumference_m: number; net_depth_m: number; grid: Grid }

function sizeCanvas(canvas: HTMLCanvasElement): [number, number, CanvasRenderingContext2D | null] {
  const box = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(box.width));
  const h = Math.max(1, Math.round(box.height));
  canvas.width = Math.round(w * ratio);
  canvas.height = Math.round(h * ratio);
  const ctx = canvas.getContext("2d");
  ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
  return [w, h, ctx];
}

function drawStill(canvas: HTMLCanvasElement, geo: ChartGeo, pins: ChartPin[], seed: number): void {
  const [w, h, ctx] = sizeCanvas(canvas);
  if (!ctx) return;
  ctx.fillStyle = "#010101";
  ctx.fillRect(0, 0, w, h);
  const water = ctx.createLinearGradient(0, 0, 0, h);
  water.addColorStop(0, `rgba(${24 + seed * 3},${104 + seed * 4},${116 - seed * 2},0.5)`);
  water.addColorStop(0.55, "rgba(4,22,26,0.18)");
  water.addColorStop(1, "rgba(1,1,1,0)");
  ctx.fillStyle = water;
  ctx.fillRect(0, 0, w, h);
  const rx = Math.min(w * 0.34, h * 0.62);
  const ry = rx * 0.2;
  const cx = w / 2;
  const top = h * 0.27;
  const height = Math.min(h * 0.52, rx * 1.15);
  const rows = Math.max(4, geo.grid.rows * 2 + 1);
  ctx.lineWidth = 1;
  for (let i = 0; i <= rows; i++) {
    const y = top + (height * i) / rows;
    const strength = 0.55 - (i / rows) * 0.38;
    ctx.strokeStyle = `rgba(111,196,206,${strength * 0.5})`;
    ctx.beginPath();
    ctx.ellipse(cx, y, rx, ry, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(111,196,206,${strength})`;
    ctx.beginPath();
    ctx.ellipse(cx, y, rx, ry, 0, 0, Math.PI);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(111,196,206,0.26)";
  const ribs = 18;
  ctx.beginPath();
  for (let r = 0; r <= ribs; r++) {
    const a = Math.PI * (r / ribs);
    const x = cx + rx * Math.cos(a);
    const y = ry * Math.sin(a);
    ctx.moveTo(x, top + y);
    ctx.lineTo(x, top + height + y);
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(190,236,240,0.85)";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.ellipse(cx, top, rx * 1.02, ry * 1.1, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  for (const pin of pins) {
    const theta = (pin.bearing_deg * Math.PI) / 180;
    const x = cx - rx * Math.sin(theta);
    const y = top + (height * pin.depth_m) / geo.net_depth_m + ry * Math.cos(theta);
    ctx.globalAlpha = Math.cos(theta) >= 0 ? 1 : 0.55;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(2.4, w * 0.008), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function useRedraw(draw: (canvas: HTMLCanvasElement) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    draw(canvas);
    const observer = new ResizeObserver(() => draw(canvas));
    observer.observe(canvas);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

export function TwinStill({ name, geo, pins, seed }: { name: string; geo: ChartGeo; pins: ChartPin[]; seed: number }) {
  const key = JSON.stringify([geo, pins.map((p) => [p.id, p.bearing_deg, p.depth_m])]);
  const ref = useRedraw((canvas) => drawStill(canvas, geo, pins, seed), [key, seed]);
  return <canvas ref={ref} role="img" aria-label={`${name} twin still`} className="still" />;
}

function drawFlat(canvas: HTMLCanvasElement, geo: ChartGeo, pins: ChartPin[], labels: boolean): void {
  const [w, h, ctx] = sizeCanvas(canvas);
  if (!ctx) return;
  const frame = ctx.createLinearGradient(0, 0, 0, h);
  frame.addColorStop(0, "#04161a");
  frame.addColorStop(1, "#010101");
  ctx.fillStyle = frame;
  ctx.fillRect(0, 0, w, h);
  const C = geo.circumference_m;
  const D = geo.net_depth_m;
  const padX = labels ? 22 : 8;
  const padTop = labels ? 22 : 8;
  const scale = Math.min((w - padX * 2) / C, (h - padTop - 8) / D);
  const ox = (w - C * scale) / 2;
  const oy = padTop;
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const mesh = Math.max(8, Math.round(C / 1.7));
  const step = (C * scale) / mesh;
  const rows = Math.max(3, Math.round((D * scale) / step));
  for (let i = 0; i < mesh; i++) {
    for (let j = 0; j < rows; j++) {
      const x = ox + i * step;
      const y = oy + (j * D * scale) / rows;
      const dy = (D * scale) / rows;
      if ((i + j) % 2) { ctx.moveTo(x, y); ctx.lineTo(x + step, y + dy); } else { ctx.moveTo(x, y + dy); ctx.lineTo(x + step, y); }
    }
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.beginPath();
  for (let c = 0; c <= geo.grid.columns; c++) {
    const x = ox + c * geo.grid.panel_width_m * scale;
    ctx.moveTo(x, oy);
    ctx.lineTo(x, oy + D * scale);
  }
  for (let r = 0; r <= geo.grid.rows; r++) {
    const y = oy + r * geo.grid.panel_height_m * scale;
    ctx.moveTo(ox, y);
    ctx.lineTo(ox + C * scale, y);
  }
  ctx.stroke();
  if (labels) {
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = "500 11px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (let c = 0; c < geo.grid.columns; c++) ctx.fillText(String.fromCharCode(65 + c), ox + (c + 0.5) * geo.grid.panel_width_m * scale, oy - 4);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    if (geo.grid.panel_height_m * scale >= 12) {
      for (let r = 0; r < geo.grid.rows; r++) ctx.fillText(String(r + 1), ox - 5, oy + (r + 0.5) * geo.grid.panel_height_m * scale);
    }
  }
  ctx.fillStyle = "#ffffff";
  for (const pin of pins) {
    ctx.beginPath();
    ctx.arc(ox + pin.chart_x_m * scale, oy + pin.depth_m * scale, Math.max(2.2, h * 0.018), 0, Math.PI * 2);
    ctx.fill();
  }
}

export function FlatChart({ name, geo, pins, labels = true }: { name: string; geo: ChartGeo; pins: ChartPin[]; labels?: boolean }) {
  const key = JSON.stringify([geo, pins.map((p) => [p.id, p.chart_x_m, p.depth_m]), labels]);
  const ref = useRedraw((canvas) => drawFlat(canvas, geo, pins, labels), [key]);
  return <canvas ref={ref} role="img" aria-label={`${name} flat chart`} className="flat-chart" />;
}
