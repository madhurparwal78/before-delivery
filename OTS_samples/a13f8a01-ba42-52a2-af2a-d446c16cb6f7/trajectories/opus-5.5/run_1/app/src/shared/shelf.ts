export interface ShelfEntry {
  id: string;
  name: string;
  version: string;
  file: string;
  global: string;
  license: string;
}

export const shelfEntries: readonly ShelfEntry[] = [
  { id: "dayjs@1.11.13", name: "dayjs", version: "1.11.13", file: "dayjs.min.js", global: "dayjs", license: "MIT" },
  { id: "lodash@4.17.21", name: "lodash", version: "4.17.21", file: "lodash.min.js", global: "_", license: "MIT" },
  { id: "matter-js@0.20.0", name: "matter-js", version: "0.20.0", file: "matter.min.js", global: "Matter", license: "MIT" },
  { id: "tinycolor2@1.6.0", name: "tinycolor2", version: "1.6.0", file: "tinycolor.js", global: "tinycolor", license: "MIT" },
  { id: "canvas-confetti@1.9.3", name: "canvas-confetti", version: "1.9.3", file: "confetti.js", global: "confetti", license: "ISC" },
];

export function shelfPath(entry: ShelfEntry): string {
  return `/shelf/${entry.id}/${entry.file}`;
}

export function findShelfEntry(id: string): ShelfEntry | undefined {
  return shelfEntries.find((entry) => entry.id === id);
}
