/** The Canvas2D fallback for the solids: flat-shaded triangles through the same camera math. */
import { parseHex } from '../../shared/format';
import { multiplyMatrices } from '../../shared/quaternion';
import { viewMatrix, type Artboard, type Camera, type Mat4 } from '../../shared/projection';
import { num, str } from '../../shared/evaluator/resolve';
import { isGlass } from '../../shared/evaluator/solids';
import { layerMatrix, type DrawItem, type Part } from './display';
import { MATCAP_BASE } from './textures';

interface Triangle {
  pts: [number, number, number, number, number, number];
  depth: number;
  fill: string;
}

const LIGHT: [number, number, number] = [-0.35, 0.55, 0.76];

function transform(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  return [m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!];
}

function itemColour(item: DrawItem): [number, number, number] {
  const { values } = item.solid;
  const tint = parseHex(str(values, 'material.color', '#FFFFFF'));
  if (isGlass(values)) return tint;
  const base = MATCAP_BASE[str(values, 'material.matcap', 'Clay')] ?? MATCAP_BASE['Clay']!;
  return [(base[0] * tint[0]) / 255, (base[1] * tint[1]) / 255, (base[2] * tint[2]) / 255];
}

export class CanvasStage {
  /** Draws every item over what the context already holds. `scale` is canvas pixels per artboard pixel. */
  render(
    ctx: CanvasRenderingContext2D,
    items: readonly DrawItem[],
    partsOf: (item: DrawItem) => Part[],
    camera: Camera,
    artboard: Artboard,
    scale: number,
  ): void {
    const view = viewMatrix(camera);
    const f = 1 / Math.tan((camera.fov * Math.PI) / 360);
    const aspect = artboard.width / artboard.height;
    const project = (p: [number, number, number]): [number, number] => [
      (((f / aspect) * p[0]) / -p[2] + 1) * 0.5 * artboard.width * scale,
      (1 - (f * p[1]) / -p[2]) * 0.5 * artboard.height * scale,
    ];
    const depthTested: Triangle[] = [];
    const sequential: { item: DrawItem; triangles: Triangle[]; extras: (() => void)[] }[] = [];

    for (const item of items) {
      const { values } = item.solid;
      const colour = itemColour(item);
      const glass = isGlass(values);
      const alpha = num(values, 'material.opacity', 1);
      const triangles: Triangle[] = [];
      const extras: (() => void)[] = [];
      const world = multiplyMatrices(view, layerMatrix(item.solid));
      for (const part of items.length ? partsOf(item) : []) {
        if (part.kind === 'mesh') {
          const m = multiplyMatrices(world, part.local);
          const { positions, indices } = part.mesh;
          const count = (indices ? indices.length : positions.length / 3) / 3;
          const vertex = (corner: number): [number, number, number] => {
            const i = (indices ? indices[corner]! : corner) * 3;
            return transform(m, positions[i]!, positions[i + 1]!, positions[i + 2]!);
          };
          for (let t = 0; t < count; t++) {
            const a = vertex(t * 3);
            const b = vertex(t * 3 + 1);
            const c = vertex(t * 3 + 2);
            if (-a[2] < camera.near || -b[2] < camera.near || -c[2] < camera.near) continue;
            const ux = b[0] - a[0];
            const uy = b[1] - a[1];
            const uz = b[2] - a[2];
            const vx = c[0] - a[0];
            const vy = c[1] - a[1];
            const vz = c[2] - a[2];
            let nx = uy * vz - uz * vy;
            let ny = uz * vx - ux * vz;
            let nz = ux * vy - uy * vx;
            const length = Math.hypot(nx, ny, nz) || 1;
            nx /= length;
            ny /= length;
            nz /= length;
            const facing = nx * a[0] + ny * a[1] + nz * a[2] < 0;
            const showBoth = item.pass === 'single' && str(values, 'faces', 'front') === 'both';
            if (item.pass === 'back' ? facing : !facing && !showBoth) continue;
            const sign = facing ? 1 : -1;
            const light = 0.4 + 0.6 * Math.max(0, sign * (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]));
            const shade = glass ? 0.6 + 0.4 * light : light;
            const rgb = colour.map((channel) => Math.round(Math.min(255, channel * shade))) as [number, number, number];
            const [ax, ay] = project(a);
            const [bx, by] = project(b);
            const [cx, cy] = project(c);
            triangles.push({
              pts: [ax, ay, bx, by, cx, cy],
              depth: -(a[2] + b[2] + c[2]) / 3,
              fill: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`,
            });
          }
        } else if (part.kind === 'points') {
          const positions = part.positions;
          const tint = `rgba(${colour[0]}, ${colour[1]}, ${colour[2]}, ${alpha})`;
          extras.push(() => {
            ctx.fillStyle = tint;
            for (let i = 0; i < positions.length; i += 3) {
              const p = transform(world, positions[i]!, positions[i + 1]!, positions[i + 2]!);
              if (-p[2] < camera.near) continue;
              const [x, y] = project(p);
              ctx.beginPath();
              ctx.arc(x, y, Math.max(1, (f * 0.03 * artboard.height * scale) / -p[2]), 0, Math.PI * 2);
              ctx.fill();
            }
          });
        } else {
          const positions = part.positions;
          extras.push(() => {
            ctx.strokeStyle = `rgba(${colour[0]}, ${colour[1]}, ${colour[2]}, 0.5)`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = 0; i < positions.length; i += 6) {
              const a = transform(world, positions[i]!, positions[i + 1]!, positions[i + 2]!);
              const b = transform(world, positions[i + 3]!, positions[i + 4]!, positions[i + 5]!);
              if (-a[2] < camera.near || -b[2] < camera.near) continue;
              const [ax, ay] = project(a);
              const [bx, by] = project(b);
              ctx.moveTo(ax, ay);
              ctx.lineTo(bx, by);
            }
            ctx.stroke();
          });
        }
      }
      if (item.depthTest) {
        depthTested.push(...triangles);
        sequential.push({ item, triangles: [], extras });
      } else sequential.push({ item, triangles, extras });
    }

    const paint = (triangles: Triangle[]): void => {
      triangles.sort((p, q) => q.depth - p.depth);
      for (const triangle of triangles) {
        const [ax, ay, bx, by, cx, cy] = triangle.pts;
        ctx.fillStyle = triangle.fill;
        ctx.strokeStyle = triangle.fill;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.lineTo(cx, cy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    };
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    paint(depthTested);
    for (const entry of sequential.filter((s) => s.item.depthTest)) entry.extras.forEach((draw) => draw());
    for (const entry of sequential.filter((s) => !s.item.depthTest)) {
      paint(entry.triangles);
      entry.extras.forEach((draw) => draw());
    }
    ctx.restore();
  }
}
