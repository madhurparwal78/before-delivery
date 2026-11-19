import type { MapNode } from "./mapData.js";

type Placed = Pick<MapNode, "name" | "x" | "y">;

function rowsOf(nodes: Placed[]): Placed[][] {
  const byY = new Map<number, Placed[]>();
  for (const node of nodes) byY.set(node.y, [...(byY.get(node.y) ?? []), node]);
  return [...byY.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row.sort((a, b) => a.x - b.x));
}

/** The first node in reading order: top row, leftmost. */
export function firstNode(nodes: Placed[]): string | null {
  return rowsOf(nodes)[0]?.[0]?.name ?? null;
}

/** The node that a navigation key moves focus to from `from`, or null when the key does nothing there. */
export function nextNode(nodes: Placed[], from: string, key: string): string | null {
  const rows = rowsOf(nodes);
  const rowIndex = rows.findIndex((row) => row.some((node) => node.name === from));
  const row = rows[rowIndex];
  if (!row) return null;
  const index = row.findIndex((node) => node.name === from);
  const here = row[index]!;
  switch (key) {
    case "ArrowLeft":
      return row[index - 1]?.name ?? null;
    case "ArrowRight":
      return row[index + 1]?.name ?? null;
    case "Home":
      return row[0]!.name;
    case "End":
      return row[row.length - 1]!.name;
    case "ArrowUp":
    case "ArrowDown": {
      const other = rows[rowIndex + (key === "ArrowUp" ? -1 : 1)];
      if (!other) return null;
      return other.reduce((best, node) => (Math.abs(node.x - here.x) < Math.abs(best.x - here.x) ? node : best)).name;
    }
    default:
      return null;
  }
}
