/** A coarse land mask, used to draw the flat dot-grid world strip. */
const landBoxes: [number, number, number, number][] = [
  [-168, -140, 55, 72],
  [-140, -60, 45, 70],
  [-127, -68, 30, 50],
  [-115, -86, 15, 32],
  [-92, -77, 8, 18],
  [-82, -35, -10, 12],
  [-75, -35, -35, -10],
  [-74, -62, -55, -35],
  [-10, 30, 36, 60],
  [5, 60, 55, 70],
  [-18, 50, 5, 35],
  [10, 42, -35, 5],
  [30, 100, 35, 70],
  [100, 142, 20, 60],
  [60, 90, 8, 35],
  [95, 125, 2, 25],
  [130, 146, 30, 45],
  [113, 153, -39, -11],
  [166, 179, -47, -34],
];

export function isLand(lon: number, lat: number): boolean {
  return landBoxes.some(([west, east, south, north]) => lon >= west && lon <= east && lat >= south && lat <= north);
}

export interface StripPoint {
  x: number;
  y: number;
}

/** Equirectangular projection into a strip of the given size. */
export function project(lon: number, lat: number, width: number, height: number): StripPoint {
  return { x: ((lon + 180) / 360) * width, y: ((90 - lat) / 180) * height };
}

export interface DotGrid {
  dots: StripPoint[];
  width: number;
  height: number;
}

export function dotGrid(width: number, height: number, step = 4): DotGrid {
  const dots: StripPoint[] = [];
  for (let lat = 80; lat >= -60; lat -= step) {
    for (let lon = -180; lon <= 180; lon += step) {
      if (isLand(lon, lat)) dots.push(project(lon, lat, width, height));
    }
  }
  return { dots, width, height };
}
