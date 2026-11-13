// Primitives as SVG path data in canvas pixels, for the overlay strokes that carry the editor's motion.
import type { Primitive } from '../../../shared/types.ts';
import type { Projection } from './draw.ts';
import { boxOfPrimitive } from './scene.ts';

const fmt = (value: number): string => value.toFixed(2);

export function svgPath(primitive: Primitive, p: Projection): string {
  const x = (value: number): number => value * p.k + p.ox;
  const y = (value: number): number => p.oy - value * p.k;
  switch (primitive.kind) {
    case 'line': return `M${fmt(x(primitive.a[0]))} ${fmt(y(primitive.a[1]))}L${fmt(x(primitive.b[0]))} ${fmt(y(primitive.b[1]))}`;
    case 'polyline': {
      const d = primitive.points.map((point, index) => `${index === 0 ? 'M' : 'L'}${fmt(x(point[0]))} ${fmt(y(point[1]))}`).join('');
      return primitive.closed ? `${d}Z` : d;
    }
    case 'circle': {
      const r = primitive.radius * p.k;
      const cx = x(primitive.center[0]);
      const cy = y(primitive.center[1]);
      return `M${fmt(cx - r)} ${fmt(cy)}A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx + r)} ${fmt(cy)}A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx - r)} ${fmt(cy)}`;
    }
    case 'arc': {
      const r = primitive.radius * p.k;
      const start = (primitive.start_angle * Math.PI) / 180;
      const end = (primitive.end_angle * Math.PI) / 180;
      const sweep = (((primitive.end_angle - primitive.start_angle) % 360) + 360) % 360 || 360;
      const cx = x(primitive.center[0]);
      const cy = y(primitive.center[1]);
      return `M${fmt(cx + r * Math.cos(start))} ${fmt(cy - r * Math.sin(start))}A${fmt(r)} ${fmt(r)} 0 ${sweep > 180 ? 1 : 0} 0 ${fmt(cx + r * Math.cos(end))} ${fmt(cy - r * Math.sin(end))}`;
    }
    case 'text': {
      const box = boxOfPrimitive(primitive);
      return `M${fmt(x(box.minX))} ${fmt(y(box.maxY))}h${fmt((box.maxX - box.minX) * p.k)}v${fmt((box.maxY - box.minY) * p.k)}h${fmt(-(box.maxX - box.minX) * p.k)}Z`;
    }
  }
}
