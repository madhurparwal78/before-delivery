export interface SheetFrame {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  duration_ms: number;
}

export interface SheetLayout {
  columns: number;
  rows: number;
  width: number;
  height: number;
  frames: SheetFrame[];
}

/**
 * Packed sheet layout: columns are the ceiling of the square root of the frame
 * count, cells hold the scaled frame plus extrude on each side, gaps are padding.
 */
export function sheetLayout(
  frameCount: number,
  frameWidth: number,
  frameHeight: number,
  scale: number,
  padding: number,
  extrude: number,
  durations: number[],
): SheetLayout {
  const columns = Math.max(1, Math.ceil(Math.sqrt(frameCount)));
  const rows = Math.max(1, Math.ceil(frameCount / columns));
  const scaledWidth = frameWidth * scale;
  const scaledHeight = frameHeight * scale;
  const cellWidth = scaledWidth + 2 * extrude;
  const cellHeight = scaledHeight + 2 * extrude;
  const width = columns * cellWidth + (columns - 1) * padding;
  const height = rows * cellHeight + (rows - 1) * padding;
  const frames: SheetFrame[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    const column = i % columns;
    const row = Math.floor(i / columns);
    frames.push({
      index: i + 1,
      x: column * (cellWidth + padding) + extrude,
      y: row * (cellHeight + padding) + extrude,
      w: scaledWidth,
      h: scaledHeight,
      duration_ms: durations[i],
    });
  }
  return { columns, rows, width, height, frames };
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function storageSafeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_');
}
