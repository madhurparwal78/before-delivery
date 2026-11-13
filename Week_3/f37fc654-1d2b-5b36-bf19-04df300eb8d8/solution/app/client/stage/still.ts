// The stage without WebGL: the same scene drawn once per change on a 2D canvas, from the same camera
// poses, so the still frame shows the bowed grid, plus markers, dust, the light field and the pieces.
import { PerspectiveCamera, Vector3 } from "three";
import { BOW, LIGHT, cellSize, targetPose, type StageState } from "./state";
import { silhouetteBoxes, type Box } from "./silhouettes";

const DUST = Array.from({ length: 220 }, (_, i) => {
  const r = (n: number): number => (Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1;
  const f = (n: number): number => Math.abs(r(n));
  return { x: (f(1) - 0.5) * 26, y: 0.3 + f(2) * 4.2, z: (f(3) - 0.7) * 24, size: 2 + f(4) * 6 };
});

export class StillStage {
  private state: StageState | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
  ) {
    addEventListener("resize", () => this.draw());
  }

  update(state: StageState): void {
    this.state = state;
    this.draw();
  }

  private draw(): void {
    const s = this.state;
    if (!s) return;
    const { ctx } = this;
    const w = innerWidth;
    const h = innerHeight;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(w * ratio);
    this.canvas.height = Math.floor(h * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.light(w, h, LIGHT[s.scene]);

    const camera = new PerspectiveCamera(w < 768 ? 52 : 38, w / h, 0.1, 200);
    const pose = targetPose(s, w / h);
    camera.position.set(...pose.position);
    camera.lookAt(new Vector3(...pose.target));
    camera.rotateZ(pose.roll);
    camera.updateMatrixWorld();
    const project = (x: number, y: number, z: number): [number, number] | null => {
      const v = new Vector3(x, y, z).project(camera);
      return v.z > 1 || v.z < -1 ? null : [(v.x + 1) * 0.5 * w, (1 - v.y) * 0.5 * h];
    };
    const floor = (x: number, z: number): [number, number] | null => project(x, -BOW * (x * x + z * z), z);

    const cell = cellSize(s);
    ctx.lineWidth = 1;
    for (const axis of [0, 1]) {
      for (let k = -22; k <= 22; k++) {
        ctx.beginPath();
        let open = false;
        for (let step = -45; step <= 45; step += 1.5) {
          const p = axis ? floor(k * cell, step) : floor(step, k * cell);
          if (!p) {
            open = false;
            continue;
          }
          if (open) ctx.lineTo(p[0], p[1]);
          else ctx.moveTo(p[0], p[1]);
          open = true;
        }
        ctx.strokeStyle = "rgba(255,255,255,0.16)";
        ctx.stroke();
      }
    }
    ctx.strokeStyle = "rgba(255,255,255,0.34)";
    ctx.lineWidth = 2;
    for (let i = -10; i <= 10; i++) {
      for (let j = -10; j <= 10; j++) {
        const x = i * 2 * cell;
        const z = j * 2 * cell;
        const arm = 0.17 * cell;
        for (const [a, b] of [[floor(x - arm, z), floor(x + arm, z)], [floor(x, z - arm), floor(x, z + arm)]]) {
          if (!a || !b) continue;
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.stroke();
        }
      }
    }
    if (s.roomW && s.roomD && s.scene === "brief") {
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => floor((a * s.roomW!) / 2, (b * s.roomD!) / 2));
      if (corners.every(Boolean)) {
        ctx.strokeStyle = "rgba(168,206,255,0.8)";
        ctx.beginPath();
        corners.forEach((p, i) => (i ? ctx.lineTo(p![0], p![1]) : ctx.moveTo(p![0], p![1])));
        ctx.closePath();
        ctx.stroke();
      }
    }
    for (const mote of DUST.slice(0, s.dust)) {
      const p = project(mote.x, mote.y, mote.z);
      if (!p) continue;
      const depth = camera.position.distanceTo(new Vector3(mote.x, mote.y, mote.z));
      ctx.fillStyle = "rgba(220,234,255,0.4)";
      ctx.beginPath();
      ctx.arc(p[0], p[1], Math.max(0.8, (mote.size * h) / 40 / depth), 0, Math.PI * 2);
      ctx.fill();
    }
    if (s.scene === "landing") this.wall(project);
    else if (s.scene === "brief") for (const box of silhouetteBoxes(s.silhouette)) this.box(box, project);
  }

  private light(w: number, h: number, strength: number): void {
    const { ctx } = this;
    ctx.fillStyle = "#03060f";
    ctx.fillRect(0, 0, w, h);
    const top = ctx.createLinearGradient(0, 0, 0, h * 0.24);
    top.addColorStop(0, `rgba(47,123,255,${0.85 * strength})`);
    top.addColorStop(1, "rgba(34,113,227,0)");
    ctx.fillStyle = top;
    ctx.fillRect(w * 0.15, 0, w * 0.85, h * 0.24);
    const side = ctx.createRadialGradient(w * 1.05, h * 0.2, 0, w * 1.05, h * 0.2, Math.max(w, h) * 0.6);
    side.addColorStop(0, `rgba(47,123,255,${0.9 * strength})`);
    side.addColorStop(0.55, `rgba(34,113,227,${0.35 * strength})`);
    side.addColorStop(1, "rgba(34,113,227,0)");
    ctx.fillStyle = side;
    ctx.fillRect(0, 0, w, h);
    const hot = ctx.createRadialGradient(w, 0, 0, w, 0, Math.min(w, h) * 0.38);
    hot.addColorStop(0, `rgba(232,238,255,${0.95 * strength})`);
    hot.addColorStop(1, "rgba(232,238,255,0)");
    ctx.fillStyle = hot;
    ctx.fillRect(0, 0, w, h);
    const wedge = ctx.createLinearGradient(0, h, w * 0.7, h * 0.15);
    wedge.addColorStop(0, "rgba(3,6,15,0.95)");
    wedge.addColorStop(0.6, "rgba(3,6,15,0.55)");
    wedge.addColorStop(1, "rgba(3,6,15,0)");
    ctx.fillStyle = wedge;
    ctx.fillRect(0, 0, w, h);
  }

  private box(box: Box, project: (x: number, y: number, z: number) => [number, number] | null): void {
    const [sx, sy, sz] = box.size.map((v) => v / 2);
    const [cx, cy, cz] = box.at;
    const corner = (i: number): [number, number] | null => project(cx + (i & 1 ? sx : -sx), cy + (i & 2 ? sy : -sy), cz + (i & 4 ? sz : -sz));
    const pairs = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    this.ctx.strokeStyle = "rgba(255,255,255,0.85)";
    this.ctx.lineWidth = 1.5;
    for (const [a, b] of pairs) {
      const p = corner(a);
      const q = corner(b);
      if (!p || !q) continue;
      this.ctx.beginPath();
      this.ctx.moveTo(p[0], p[1]);
      this.ctx.lineTo(q[0], q[1]);
      this.ctx.stroke();
    }
  }

  private wall(project: (x: number, y: number, z: number) => [number, number] | null): void {
    const { ctx } = this;
    const face = [[-2, 0], [2, 0], [2, 2.6], [-2, 2.6]].map(([x, y]) => project(x, y, 0.2));
    if (!face.every(Boolean)) return;
    ctx.fillStyle = "#081428";
    ctx.beginPath();
    face.forEach((p, i) => (i ? ctx.lineTo(p![0], p![1]) : ctx.moveTo(p![0], p![1])));
    ctx.closePath();
    ctx.fill();
    for (let band = 0; band < 7; band++) {
      const y0 = 0.2 + band * 0.34;
      const strip = [[-2, y0], [2, y0 + 0.12], [2, y0 + 0.24], [-2, y0 + 0.1]].map(([x, y]) => project(x, y, 0.21));
      if (!strip.every(Boolean)) continue;
      ctx.fillStyle = band % 2 ? "rgba(34,113,227,0.55)" : "rgba(120,190,255,0.32)";
      ctx.beginPath();
      strip.forEach((p, i) => (i ? ctx.lineTo(p![0], p![1]) : ctx.moveTo(p![0], p![1])));
      ctx.closePath();
      ctx.fill();
    }
    this.box({ size: [4, 2.6, 0.4], at: [0, 1.3, 0] }, project);
  }
}
