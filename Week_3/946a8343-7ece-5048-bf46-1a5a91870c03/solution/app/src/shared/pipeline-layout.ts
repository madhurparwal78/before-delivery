// Pipeline graph geometry, shared by the server (job coordinates) and the browser (nodes and edges).
export const GRAPH_ORIGIN = 40;
const GRAPH_COLUMN_STEP = 240;
const GRAPH_ROW_STEP = 96;
export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 64;
const EDGE_HANDLE = 20;

interface LayoutInput {
  readonly name: string;
  readonly stageIndex: number;
  readonly needs: readonly string[];
}

interface LayoutPosition {
  readonly name: string;
  readonly layer: number;
  readonly row: number;
  readonly x: number;
  readonly y: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

// Positions come back in input order, which is config order.
export function layoutGraph(jobs: readonly LayoutInput[]): LayoutPosition[] {
  const byName = new Map(jobs.map((job) => [job.name, job] as const));
  const layers = new Map<string, number>();
  const layerOf = (job: LayoutInput, path: readonly string[]): number => {
    const known = layers.get(job.name);
    if (known !== undefined) return known;
    let layer = job.stageIndex;
    for (const need of job.needs) {
      const target = byName.get(need);
      if (target && !path.includes(need)) layer = Math.max(layer, 1 + layerOf(target, [...path, need]));
    }
    layers.set(job.name, layer);
    return layer;
  };

  const placed = jobs.map((job, order) => ({ job, order, layer: layerOf(job, [job.name]) }));
  const rows = new Map<string, number>();
  const byLayer = new Map<number, typeof placed>();
  for (const item of placed) byLayer.set(item.layer, [...(byLayer.get(item.layer) ?? []), item]);
  for (const members of byLayer.values()) {
    members
      .toSorted((a, b) => a.job.stageIndex - b.job.stageIndex || a.order - b.order)
      .forEach((item, row) => rows.set(item.job.name, row));
  }
  return placed.map(({ job, layer }) => {
    const row = rows.get(job.name) ?? 0;
    return {
      name: job.name,
      layer,
      row,
      x: GRAPH_ORIGIN + layer * GRAPH_COLUMN_STEP,
      y: GRAPH_ORIGIN + row * GRAPH_ROW_STEP,
    };
  });
}

export function edgePath(from: Point, to: Point): string {
  const middle = NODE_HEIGHT / 2;
  return (
    `M ${from.x + NODE_WIDTH} ${from.y + middle} ` +
    `C ${from.x + NODE_WIDTH + EDGE_HANDLE} ${from.y + middle} ${to.x - EDGE_HANDLE} ${to.y + middle} ${to.x} ${to.y + middle}`
  );
}
