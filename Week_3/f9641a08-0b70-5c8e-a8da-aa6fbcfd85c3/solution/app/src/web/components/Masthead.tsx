import { MastheadStudy } from "./BagArt";

// A gutterless mosaic of six columns by two rows: four greyscale studies and flat red, blue and yellow tiles.
// One study spans two columns, the blue tile spans both rows, red and yellow fill the rest.

const RED = "#d6281c";
const BLUE = "#1c3fcb";
const YELLOW = "#f5b700";

interface Tile {
  key: string;
  area: string;
  colour: string;
  study?: { kind: "suitcase" | "backpack" | "tote" | "duffel"; ink: string; mid: string };
}

const TILES: Tile[] = [
  { key: "study-a", area: "1 / 1 / 2 / 3", colour: "#bdbdbd", study: { kind: "suitcase", ink: "#2e2e2e", mid: "#8c8c8c" } },
  { key: "study-b", area: "1 / 3 / 2 / 4", colour: "#8a8a8a", study: { kind: "backpack", ink: "#1a1a1a", mid: "#c9c9c9" } },
  { key: "blue", area: "1 / 4 / 3 / 5", colour: BLUE },
  { key: "yellow-a", area: "1 / 5 / 2 / 6", colour: YELLOW },
  { key: "study-c", area: "1 / 6 / 2 / 7", colour: "#d9d9d9", study: { kind: "tote", ink: "#333333", mid: "#9d9d9d" } },
  { key: "red-a", area: "2 / 1 / 3 / 2", colour: RED },
  { key: "study-d", area: "2 / 2 / 3 / 3", colour: "#6b6b6b", study: { kind: "duffel", ink: "#111111", mid: "#bdbdbd" } },
  { key: "yellow-b", area: "2 / 3 / 3 / 4", colour: YELLOW },
  { key: "red-b", area: "2 / 5 / 3 / 6", colour: RED },
  { key: "yellow-c", area: "2 / 6 / 3 / 7", colour: YELLOW },
];

export function Masthead() {
  return (
    <div className="mosaic" aria-hidden="true">
      {TILES.map((tile) => (
        <div key={tile.key} className="tile" style={{ gridArea: tile.area, background: tile.colour }}>
          {tile.study && <MastheadStudy ground={tile.colour} {...tile.study} />}
        </div>
      ))}
    </div>
  );
}
