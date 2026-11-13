// Geometry of the stage graph: a horizontal pipeline, or a vertical stack under 768 pixels.
// Edges are polylines; the same path drives the drawn stroke and the capsule's offset-path.

interface Box { x: number; y: number; w: number; h: number }

export interface GraphLayout {
  vertical: boolean;
  width: number;
  height: number;
  bundles: Box;
  nodes: Map<string, Box>;
  paths: Map<string, string>; // keyed by target stage
}

interface StageLink { stage: string; upstream: string | null }

const PAD = 16;
const TRUNK = 24;

function depthOf(stage: StageLink, all: Map<string, StageLink>): number {
  let depth = 1;
  for (let up = stage.upstream; up; up = all.get(up)?.upstream ?? null) depth += 1;
  return depth;
}

export function layoutGraph(width: number, stages: StageLink[], vertical: boolean): GraphLayout {
  const byName = new Map(stages.map((s) => [s.stage, s]));
  const columns: string[][] = [];
  for (const s of stages) (columns[depthOf(s, byName) - 1] ??= []).push(s.stage);
  return vertical ? stacked(width, stages, columns) : horizontal(width, stages, columns);
}

function horizontal(width: number, stages: StageLink[], columns: string[][]): GraphLayout {
  const count = columns.length;
  const size = Math.max(128, Math.min(136, Math.floor((width - 2 * PAD - 84 - count * 56) / count)));
  // The intake node shares the stage height and gives up width first, so the edges stay longer than a capsule.
  const bundleWidth = Math.max(84, Math.min(112, Math.floor(width - 2 * PAD - count * size - (count + 0.6) * 64)));
  // The last gap carries the fan-out trunk, so it gets a larger share and the capsule clears the nodes.
  const free = Math.max(0, width - 2 * PAD - bundleWidth - count * size);
  const gap = Math.max(40, free / (count + 0.6));
  const fanGap = Math.max(gap, free - (count - 1) * gap);
  const rowGap = 16;
  const rows = Math.max(...columns.map((c) => c.length), 1);
  const height = rows * size + (rows - 1) * rowGap + 2 * PAD;
  const bundles: Box = { x: PAD, y: (height - size) / 2, w: bundleWidth, h: size };
  const nodes = new Map<string, Box>();
  columns.forEach((column, d) => {
    const x = PAD + bundleWidth + (d + 1) * gap + d * size + (d === count - 1 ? fanGap - gap : 0);
    const top = (height - (column.length * size + (column.length - 1) * rowGap)) / 2;
    column.forEach((stage, i) => nodes.set(stage, { x, y: top + i * (size + rowGap), w: size, h: size }));
  });
  const paths = new Map<string, string>();
  for (const s of stages) {
    const from = s.upstream ? (nodes.get(s.upstream) as Box) : bundles;
    const to = nodes.get(s.stage) as Box;
    // Every edge leaves its source's single port at the vertical centre; a fan-out splits at one trunk TRUNK out.
    const fansOut = stages.filter((o) => o.upstream === s.upstream).length > 1;
    const [sx, sy, ex, ey] = [from.x + from.w, from.y + from.h / 2, to.x, to.y + to.h / 2];
    const mid = fansOut ? sx + TRUNK : sx + (ex - sx) / 2;
    paths.set(s.stage, sy === ey ? `M ${sx} ${sy} H ${ex}` : `M ${sx} ${sy} H ${mid} V ${ey} H ${ex}`);
  }
  return { vertical: false, width, height, bundles, nodes, paths };
}

function stacked(width: number, stages: StageLink[], columns: string[][]): GraphLayout {
  const size = 136;
  const gap = 64;
  const x = Math.max(PAD + 56, Math.round((width - size) / 2));
  const bundles: Box = { x, y: PAD, w: size, h: 112 };
  const order = columns.flat();
  const nodes = new Map<string, Box>();
  order.forEach((stage, i) => nodes.set(stage, { x, y: PAD + bundles.h + gap + i * (size + gap), w: size, h: size }));
  const height = PAD + bundles.h + order.length * (size + gap) + PAD;
  const paths = new Map<string, string>();
  for (const s of stages) {
    const from = s.upstream ? (nodes.get(s.upstream) as Box) : bundles;
    const to = nodes.get(s.stage) as Box;
    const directlyBelow = Math.abs(to.y - (from.y + from.h + gap)) < 1;
    if (directlyBelow) {
      paths.set(s.stage, `M ${x + size / 2} ${from.y + from.h} V ${to.y}`);
    } else {
      // Every fan-out stage further down shares one trunk lane on the left.
      const laneX = x - 18;
      paths.set(s.stage, `M ${x} ${from.y + from.h / 2} H ${laneX} V ${to.y + to.h / 2} H ${x}`);
    }
  }
  return { vertical: true, width, height, bundles, nodes, paths };
}
