// The still drawing of the crate, used without WebGL and while the WebGL context is lost: the same
// box at the home view, projected through the same camera and painted back to front.
import { Vector3 } from "three";
import { homeCamera } from "./camera.js";
import { BOX, type CrateView, LID_OPEN_DEG, palette, slotSpot, type StampKind, unitRadius, unitShape } from "./model.js";
import type { Pose } from "./pose.js";
import { displayFaceReady, kraftCanvas, stampCanvas } from "./textures.js";

const INSIDE = "#ebddbc";
const SLOT_MARK = "#d8c698";
const INK = "#1e1a15";
const FRONT = "#b78f58";

type Point = [number, number];

const camera = homeCamera(4 / 3);
const stamps = new Map<StampKind, HTMLCanvasElement>();
let fronts: HTMLCanvasElement | null = null;
let lids: HTMLCanvasElement | null = null;

function hull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (list: Point[]) => {
    const out: Point[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...build(sorted), ...build([...sorted].reverse())];
}

function fill(ctx: CanvasRenderingContext2D, points: Point[], colour: string, stroke?: string): void {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

export function drawStill(ctx: CanvasRenderingContext2D, view: CrateView, pose: Pose, w: number, h: number): void {
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const at = (x: number, y: number, z: number): Point => {
    const q = new Vector3(x, y, z).project(camera);
    return [((q.x + 1) / 2) * w, ((1 - q.y) / 2) * h];
  };
  const { w: bw, d: bd, h: bh } = BOX;
  ctx.clearRect(0, 0, w, h);

  // inside: floor, then the three far walls
  fill(ctx, [at(-bw / 2, 0, -bd / 2), at(bw / 2, 0, -bd / 2), at(bw / 2, 0, bd / 2), at(-bw / 2, 0, bd / 2)], INSIDE, INK);
  fill(ctx, [at(-bw / 2, 0, -bd / 2), at(bw / 2, 0, -bd / 2), at(bw / 2, bh, -bd / 2), at(-bw / 2, bh, -bd / 2)], INSIDE, INK);
  fill(ctx, [at(-bw / 2, 0, -bd / 2), at(-bw / 2, 0, bd / 2), at(-bw / 2, bh, bd / 2), at(-bw / 2, bh, -bd / 2)], INSIDE, INK);
  fill(ctx, [at(bw / 2, 0, -bd / 2), at(bw / 2, 0, bd / 2), at(bw / 2, bh, bd / 2), at(bw / 2, bh, -bd / 2)], INSIDE, INK);

  const r = unitRadius(view.cols, view.rows);
  const shape = unitShape(view.unit, r);
  const tones = palette();
  const order = view.slots.map((_, i) => i).sort((a, b) => slotSpot(a, view.cols, view.rows).z - slotSpot(b, view.cols, view.rows).z);
  for (const i of order) {
    const spot = slotSpot(i, view.cols, view.rows);
    const ring = (radius: number, y: number, dx = 0): Point[] =>
      Array.from({ length: 20 }, (_, k) => at(spot.x + dx + radius * Math.cos((k / 20) * Math.PI * 2), y, spot.z + radius * Math.sin((k / 20) * Math.PI * 2)));
    fill(ctx, ring(r * 1.05, 0.005), SLOT_MARK);
    const unit = pose.slots[i]!;
    if (unit.tone === null) continue;
    for (const part of shape.parts) {
      const points: Point[] =
        part.shape === "cyl"
          ? [...ring(part.r, part.y0 + unit.lift, part.dx ?? 0), ...ring(part.r, part.y1 + unit.lift, part.dx ?? 0)]
          : ([0, 1] as const).flatMap((yy) =>
              [-1, 1].flatMap((sx) => [-1, 1].map((sz) => at(spot.x + (sx * part.w) / 2, (yy ? part.y1 : part.y0) + unit.lift, spot.z + (sz * part.d) / 2))),
            );
      fill(ctx, hull(points), part.body, "rgba(30,26,21,.45)");
    }
    const top = shape.top;
    const outline: Point[] =
      top.shape === "disc"
        ? ring(top.r, top.y + unit.lift)
        : [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => at(spot.x + sx! * top.r, top.y + unit.lift, spot.z + sz! * top.r));
    fill(ctx, outline, tones[unit.tone]);
  }

  // the front wall hides the foot of the units
  const frontWall = [at(-bw / 2, 0, bd / 2), at(bw / 2, 0, bd / 2), at(bw / 2, bh, bd / 2), at(-bw / 2, bh, bd / 2)];
  fill(ctx, frontWall, FRONT, INK);
  fronts ??= kraftCanvas(FRONT, "#6b4f2a", "across");
  const [bl, br, , tl] = frontWall as [Point, Point, Point, Point];
  ctx.save();
  ctx.beginPath();
  frontWall.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.clip();
  ctx.transform((br[0] - bl[0]) / 256, (br[1] - bl[1]) / 256, (tl[0] - bl[0]) / 128, (tl[1] - bl[1]) / 128, bl[0], bl[1]);
  ctx.drawImage(fronts, 0, 0, 256, 128, 0, 0, 256, 128);
  ctx.restore();

  const stamp = (kind: StampKind, corner: Point, across: Point, down: Point, alpha: number) => {
    if (!displayFaceReady()) return;
    let art = stamps.get(kind);
    if (!art) {
      art = stampCanvas(kind);
      stamps.set(kind, art);
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.transform((across[0] - corner[0]) / 512, (across[1] - corner[1]) / 512, (down[0] - corner[0]) / 192, (down[1] - corner[1]) / 192, corner[0], corner[1]);
    ctx.drawImage(art, 0, 0);
    ctx.restore();
  };
  if (pose.stamp?.kind === "dropped") {
    const sw = 2.5;
    const sh = 0.94;
    stamp("dropped", at(-sw / 2, bh / 2 + sh / 2, bd / 2), at(sw / 2, bh / 2 + sh / 2, bd / 2), at(-sw / 2, bh / 2 - sh / 2, bd / 2), pose.stamp.alpha);
  }

  if (pose.lidShown) {
    const angle = ((LID_OPEN_DEG * Math.PI) / 180) * (1 - pose.lid);
    const corner = (x: number, reach: number): Point => at(x, bh + 0.012 + reach * Math.sin(angle), -bd / 2 + reach * Math.cos(angle));
    const quad: Point[] = [corner(-bw / 2, 0), corner(bw / 2, 0), corner(bw / 2, bd), corner(-bw / 2, bd)];
    fill(ctx, quad, pose.lid >= 0.99 ? "#c4a063" : INSIDE, INK);
    if (pose.lid >= 0.99) {
      lids ??= kraftCanvas("#c4a063", "#6b4f2a", "across");
      const [bk, , , fr] = quad as [Point, Point, Point, Point];
      ctx.save();
      ctx.beginPath();
      quad.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.clip();
      ctx.transform((quad[1]![0] - bk[0]) / 256, (quad[1]![1] - bk[1]) / 256, (fr[0] - bk[0]) / 128, (fr[1] - bk[1]) / 128, bk[0], bk[1]);
      ctx.drawImage(lids, 0, 0);
      ctx.restore();
    }
    if (pose.stamp && pose.stamp.kind !== "dropped") {
      const sw = 2.4;
      const sd = 0.9;
      const y = bh + 0.02;
      stamp(pose.stamp.kind, at(-sw / 2, y, -sd / 2), at(sw / 2, y, -sd / 2), at(-sw / 2, y, sd / 2), pose.stamp.alpha);
    }
  }
}
