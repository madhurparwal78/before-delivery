// The static drawing of the same lattice: an axonometric SVG built from the same model, shown with reduced motion
// or without WebGL. Raised objects sit higher, lit bars turn lime, clash seams are vermilion, the rest fade.
import type { ReactElement } from "react";
import { colourOf, type LatticeModel } from "./model.ts";

type Point = [number, number];
const UNIT = 26;
/** Screen basis: x runs right and slightly down, y up, depth (negative z) goes back up and to the right. */
const project = (x: number, y: number, z: number): Point => [UNIT * (0.94 * x - 0.5 * z), UNIT * (0.3 * x - y + 0.36 * z)];
const pts = (points: Point[]) => points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

type Props = {
  model: LatticeModel | null; day: string | null; venue: string | null; discipline: string | null;
  lit: ReadonlySet<string>; seams: readonly [string, string][]; raised: string; litList: string; seamList: string;
};

export function StaticLattice({ model, day, venue, discipline, lit, seams, raised, litList, seamList }: Props) {
  const any = !!(day || venue || discipline);
  const lift = (selected: boolean) => (selected ? -0.55 * UNIT : 0);
  const shapes: ReactElement[] = [];
  const labels: ReactElement[] = [];
  let bounds = { x0: -200, y0: -120, x1: 200, y1: 120 };
  if (model) {
    const all: Point[] = [];
    const slabs = [...model.slabs].sort((a, b) => a.z - b.z);
    for (const slab of slabs) {
      const w = slab.width / 2 + 0.7;
      const h = slab.height / 2 + 0.4;
      const topLeft = project(-w, h, slab.z);
      const corners: Point[] = [topLeft, project(w, h, slab.z), project(w, -h, slab.z), project(-w, -h, slab.z)];
      all.push(...corners);
      const selected = day === slab.date;
      const faded = any && day !== null && !selected;
      const bars = model.bars.filter((b) => b.date === slab.date);
      const labelAt = project(-slab.width / 2 + 0.6, h, slab.z);
      labels.push(
        <text key={`label:${slab.key}`} x={labelAt[0]} y={labelAt[1] - 8} className="lattice-svg__label lattice-svg__object"
          style={{ opacity: faded ? 0.25 : 1, transform: `translateY(${lift(selected)}px)` }}>{slab.label.toUpperCase()}</text>,
      );
      shapes.push(
        <g key={slab.key} className="lattice-svg__object" style={{ opacity: faded ? 0.25 : 1, transform: `translateY(${lift(selected)}px)` }}>
          <polygon points={pts(corners)} fill="#1C1C24" stroke="#C8F031" strokeWidth="1.5" />
          {bars.map((b) => {
            const match = (!day || b.date === day) && (!venue || b.venueId === venue) && (!discipline || b.discipline === discipline);
            const front: Point[] = [project(b.x0, b.y + 0.25, b.z), project(b.x1, b.y + 0.25, b.z), project(b.x1, b.y - 0.25, b.z), project(b.x0, b.y - 0.25, b.z)];
            const top: Point[] = [project(b.x0, b.y + 0.25, b.z), project(b.x1, b.y + 0.25, b.z), project(b.x1, b.y + 0.25, b.z - 0.4), project(b.x0, b.y + 0.25, b.z - 0.4)];
            const fill = lit.has(b.sessionId) ? "#C8F031" : colourOf(b.discipline);
            return (
              <g key={b.key} style={{ opacity: any && !match ? 0.25 : 1 }} className="lattice-svg__object">
                <polygon points={pts(top)} fill={b.cancelled ? "none" : fill} opacity={0.7} stroke={b.cancelled ? fill : "none"} />
                <polygon points={pts(front)} fill={b.cancelled ? "none" : fill} stroke={b.cancelled ? fill : "#0E0E10"} strokeWidth={b.cancelled ? 1.5 : 0.6} strokeDasharray={b.cancelled ? "3 2" : undefined} />
              </g>
            );
          })}
        </g>,
      );
    }
    const near = Math.max(...model.slabs.map((s) => s.z)) + 1.5;
    const far = Math.min(...model.slabs.map((s) => s.z)) - 1.5;
    for (const p of model.pillars) {
      const x = -model.slabs[0]!.width / 2 - 0.35;
      const selected = venue === p.venueId;
      const a = project(x, p.y, near);
      const b = project(x, p.y, far);
      all.push(a, b);
      shapes.push(
        <g key={p.key} className="lattice-svg__object" style={{ opacity: any && venue !== null && !selected ? 0.25 : 1, transform: `translateY(${lift(selected)}px)` }}>
          <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#F4EDE1" strokeWidth="3" strokeLinecap="square" />
        </g>,
      );
    }
    for (const s of model.swatches) {
      const selected = discipline === s.disciplineId;
      const c = project(s.x, s.y, s.z);
      all.push(c);
      shapes.push(
        <g key={s.key} className="lattice-svg__object" style={{ opacity: any && discipline !== null && !selected ? 0.25 : 1, transform: `translateY(${lift(selected)}px)` }}>
          <rect x={c[0] - 11} y={c[1] - 11} width="22" height="22" fill={colourOf(s.disciplineId)} stroke="#0E0E10" />
        </g>,
      );
    }
    for (const [a, b] of seams) {
      const ba = model.bars.find((x) => x.sessionId === a);
      const bb = model.bars.find((x) => x.sessionId === b);
      if (!ba || !bb) continue;
      const pa = project((ba.x0 + ba.x1) / 2, ba.y, ba.z + 0.05);
      const pb = project((bb.x0 + bb.x1) / 2, bb.y, bb.z + 0.05);
      shapes.push(<line key={`seam:${a}+${b}`} x1={pa[0]} y1={pa[1]} x2={pb[0]} y2={pb[1]} stroke="#FF4A1F" strokeWidth="4" strokeLinecap="round" />);
    }
    const xs = all.map((p) => p[0]);
    const ys = all.map((p) => p[1]);
    bounds = { x0: Math.min(...xs) - 30, y0: Math.min(...ys) - 50, x1: Math.max(...xs) + 30, y1: Math.max(...ys) + 30 };
  }
  return (
    <svg role="img" aria-label="Programme lattice (static)" className="lattice-svg" data-raised={raised} data-lit={litList} data-seams={seamList}
      viewBox={`${bounds.x0} ${bounds.y0} ${bounds.x1 - bounds.x0} ${bounds.y1 - bounds.y0}`} preserveAspectRatio="xMidYMid meet">
      <rect x={bounds.x0} y={bounds.y0} width={bounds.x1 - bounds.x0} height={bounds.y1 - bounds.y0} fill="#0E0E10" />
      {shapes}
      {labels}
    </svg>
  );
}
