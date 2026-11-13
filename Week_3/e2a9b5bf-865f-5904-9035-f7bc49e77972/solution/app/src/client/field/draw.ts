import { projectSky } from "../../shared/projection";
import type { Point } from "../../shared/types";
import type { Sketch, Width } from "./sketch";

/** What the circle currently shows: its radius in arcminutes and the train's rotation and flip. */
export interface View {
  half: number;
  rot: number;
  sx: number;
}

const LINE: Record<Width, number> = { fine: 1.5, medium: 3, broad: 5 };
const STAR_RADIUS = [1.5, 2.5, 3.5, 4.5, 6];

function screenPoint(p: Point, view: View, size: number): Point {
  const scale = size / 2 / view.half;
  const [x, y] = projectSky(p[0], p[1], view.rot, view.sx);
  return [size / 2 + x * scale, size / 2 - y * scale];
}

function fitCanvas(canvas: HTMLCanvasElement, size: number): CanvasRenderingContext2D | null {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pixels = Math.max(1, Math.round(size * dpr));
  if (canvas.width !== pixels || canvas.height !== pixels) {
    canvas.width = pixels;
    canvas.height = pixels;
  }
  const ctx = canvas.getContext("2d");
  ctx?.setTransform(pixels / size, 0, 0, pixels / size, 0, 0);
  return ctx;
}

export function drawField(canvas: HTMLCanvasElement, size: number, view: View, sketch: Sketch, showCursor: boolean): void {
  const ctx = fitCanvas(canvas, size);
  if (!ctx || size <= 0) return;
  const R = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(R, R, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#0B060D";
  ctx.fillRect(0, 0, size, size);
  const glow = ctx.createRadialGradient(R, R, 0, R, R, R);
  glow.addColorStop(0, "rgba(255,255,255,0.07)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#FFFFFF";
  const strokes = sketch.live ? [...sketch.strokes, sketch.live] : sketch.strokes;
  for (const stroke of strokes) {
    ctx.lineWidth = LINE[stroke.width];
    ctx.beginPath();
    stroke.points.forEach((p, i) => {
      const [x, y] = screenPoint(p, view, size);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  for (const star of sketch.stars) {
    const [x, y] = screenPoint(star.at, view, size);
    const r = STAR_RADIUS[star.brightness - 1] ?? 3;
    const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
    halo.addColorStop(0, "rgba(255,255,255,0.28)");
    halo.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, r * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const marks = sketch.pairMarks.map((p) => screenPoint(p, view, size));
  const [first, second] = marks;
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 1;
  if (first && second) {
    ctx.beginPath();
    ctx.moveTo(first[0], first[1]);
    ctx.lineTo(second[0], second[1]);
    ctx.stroke();
  }
  ctx.lineWidth = 1.25;
  for (const [x, y] of marks) {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (showCursor) {
    const [x, y] = screenPoint(sketch.cursor, view, size);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 11, y);
    ctx.lineTo(x - 3, y);
    ctx.moveTo(x + 3, y);
    ctx.lineTo(x + 11, y);
    ctx.moveTo(x, y - 11);
    ctx.lineTo(x, y - 3);
    ctx.moveTo(x, y + 3);
    ctx.lineTo(x, y + 11);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(185,169,191,0.55)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(R, R, R - 0.75, 0, Math.PI * 2);
  ctx.stroke();
}
