export interface ShelfEntry {
  id: string;
  name: string;
  version: string;
  global: string;
  file: string;
  license: string;
}

export const SHELF: ShelfEntry[] = [
  { id: "dayjs@1.11.13", name: "dayjs", version: "1.11.13", global: "dayjs", file: "dayjs.min.js", license: "MIT" },
  { id: "lodash@4.17.21", name: "lodash", version: "4.17.21", global: "_", file: "lodash.min.js", license: "MIT" },
  { id: "matter-js@0.20.0", name: "matter-js", version: "0.20.0", global: "Matter", file: "matter.min.js", license: "MIT" },
  { id: "tinycolor2@1.6.0", name: "tinycolor2", version: "1.6.0", global: "tinycolor", file: "tinycolor.js", license: "MIT" },
  { id: "canvas-confetti@1.9.3", name: "canvas-confetti", version: "1.9.3", global: "confetti", file: "confetti.js", license: "ISC" },
];

export function findShelf(id: string): ShelfEntry | undefined {
  return SHELF.find((s) => s.id === id);
}
