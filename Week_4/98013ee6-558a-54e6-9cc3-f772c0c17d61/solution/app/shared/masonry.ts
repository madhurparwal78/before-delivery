/** The one masonry rule. Every grid is placed from the window's inner width and the stored image sizes. */

const GRID_GAP = 16;
const GRID_MARGIN = 32;
const TEXT_BLOCK = 64;
const BREAKPOINTS = [600, 900, 1200] as const;
const WIDE_RATIO = 1.5;

interface ImageSize {
  width: number;
  height: number;
}

export interface Placed {
  order: number;
  col: number;
  row: number;
  top: number;
  height: number;
  imageHeight: number;
  span: 1 | 2;
  left: number;
  width: number;
}

interface Layout {
  columns: number;
  columnWidth: number;
  height: number;
  items: Placed[];
}

function columnsFor(windowWidth: number): number {
  if (windowWidth < BREAKPOINTS[0]) return 2;
  if (windowWidth < BREAKPOINTS[1]) return 3;
  if (windowWidth < BREAKPOINTS[2]) return 4;
  return 5;
}

function columnWidthFor(windowWidth: number): number {
  const n = columnsFor(windowWidth);
  return Math.floor((windowWidth - GRID_MARGIN - GRID_GAP * (n - 1)) / n);
}

const halfUp = (value: number): number => Math.floor(value + 0.5);

/** Each card goes to the shortest column (ties leftmost); a wide card spans the adjacent pair whose taller column is lowest. */
export function place(sizes: readonly ImageSize[], windowWidth: number): Layout {
  const n = columnsFor(windowWidth);
  const c = columnWidthFor(windowWidth);
  const heights = new Array<number>(n).fill(0);
  const counts = new Array<number>(n).fill(0);
  const items: Placed[] = sizes.map((size, order) => {
    const wide = n >= 3 && size.width / size.height >= WIDE_RATIO;
    if (wide) {
      const width = 2 * c + GRID_GAP;
      const height = halfUp((width * size.height) / size.width) + TEXT_BLOCK;
      let col = 0;
      for (let i = 1; i < n - 1; i++) {
        if (Math.max(heights[i] ?? 0, heights[i + 1] ?? 0) < Math.max(heights[col] ?? 0, heights[col + 1] ?? 0)) col = i;
      }
      const top = Math.max(heights[col] ?? 0, heights[col + 1] ?? 0);
      const row = counts[col] ?? 0;
      heights[col] = heights[col + 1] = top + height + GRID_GAP;
      counts[col] = (counts[col] ?? 0) + 1;
      counts[col + 1] = (counts[col + 1] ?? 0) + 1;
      return { order, col, row, top, height, imageHeight: height - TEXT_BLOCK, span: 2, left: col * (c + GRID_GAP), width };
    }
    const height = halfUp((c * size.height) / size.width) + TEXT_BLOCK;
    let col = 0;
    for (let i = 1; i < n; i++) if ((heights[i] ?? 0) < (heights[col] ?? 0)) col = i;
    const top = heights[col] ?? 0;
    const row = counts[col] ?? 0;
    heights[col] = top + height + GRID_GAP;
    counts[col] = row + 1;
    return { order, col, row, top, height, imageHeight: height - TEXT_BLOCK, span: 1, left: col * (c + GRID_GAP), width: c };
  });
  const tallest = Math.max(0, ...heights);
  return { columns: n, columnWidth: c, height: tallest > 0 ? tallest - GRID_GAP : 0, items };
}

/** Arrow Down / Up: the nearest card below / above among those occupying the focused card's column (a wide card occupies two). */
export function verticalNeighbour(items: readonly Placed[], from: number, down: boolean): number {
  const focused = items[from];
  if (!focused) return from;
  let best = from;
  for (const candidate of items) {
    if (candidate.order === from) continue;
    const occupies = candidate.col === focused.col || (candidate.span === 2 && candidate.col + 1 === focused.col);
    if (!occupies) continue;
    if (down && candidate.top > focused.top && (best === from || candidate.top < (items[best]?.top ?? Infinity))) best = candidate.order;
    if (!down && candidate.top < focused.top && (best === from || candidate.top > (items[best]?.top ?? -Infinity))) best = candidate.order;
  }
  return best;
}
