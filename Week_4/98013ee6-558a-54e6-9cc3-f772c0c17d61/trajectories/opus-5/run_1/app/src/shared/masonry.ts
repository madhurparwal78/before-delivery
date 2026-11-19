export const GRID_GAP = 16;
export const CARD_TEXT_HEIGHT = 64;
export const WIDE_RATIO = 1.5;

export interface MasonryInput {
  width: number;
  height: number;
}

export interface Placement {
  order: number;
  col: number;
  row: number;
  top: number;
  height: number;
  span: 1 | 2;
}

export function columnCount(windowWidth: number): number {
  if (windowWidth < 600) return 2;
  if (windowWidth < 900) return 3;
  if (windowWidth < 1200) return 4;
  return 5;
}

export function columnWidth(windowWidth: number, columns: number): number {
  const grid = windowWidth - 2 * GRID_GAP;
  return Math.floor((grid - GRID_GAP * (columns - 1)) / columns);
}

function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

export function isWide(image: MasonryInput, columns: number): boolean {
  return columns >= 3 && image.width / image.height >= WIDE_RATIO;
}

export function cardHeight(image: MasonryInput, boxWidth: number): number {
  return roundHalfUp((boxWidth * image.height) / image.width) + CARD_TEXT_HEIGHT;
}

/** The single masonry placement rule: shortest column, ties leftmost. */
export function placeCards(images: MasonryInput[], windowWidth: number): {
  columns: number;
  columnWidth: number;
  placements: Placement[];
} {
  const columns = columnCount(windowWidth);
  const width = columnWidth(windowWidth, columns);
  const running = new Array<number>(columns).fill(0);
  const occupancy = new Array<number>(columns).fill(0);
  const placements: Placement[] = [];

  images.forEach((image, order) => {
    const wide = isWide(image, columns);
    if (wide) {
      let best = 0;
      let bestTaller = Number.POSITIVE_INFINITY;
      for (let col = 0; col + 1 < columns; col += 1) {
        const taller = Math.max(running[col], running[col + 1]);
        if (taller < bestTaller) {
          bestTaller = taller;
          best = col;
        }
      }
      const height = cardHeight(image, 2 * width + GRID_GAP);
      const top = bestTaller;
      const row = occupancy[best];
      occupancy[best] += 1;
      occupancy[best + 1] += 1;
      running[best] = top + height + GRID_GAP;
      running[best + 1] = top + height + GRID_GAP;
      placements.push({ order, col: best, row, top, height, span: 2 });
      return;
    }
    let best = 0;
    for (let col = 1; col < columns; col += 1) {
      if (running[col] < running[best]) best = col;
    }
    const height = cardHeight(image, width);
    const top = running[best];
    const row = occupancy[best];
    occupancy[best] += 1;
    running[best] = top + height + GRID_GAP;
    placements.push({ order, col: best, row, top, height, span: 1 });
  });

  return { columns, columnWidth: width, placements };
}
