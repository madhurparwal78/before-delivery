import type { CircuitComponent, DesignObject, Snapshot, SnapshotCircuit } from "../../shared/types";
import { objectsOf } from "./flatten";
import { TOY_COLORS } from "./palette";

const SPACING_MM = 32;
const BOARD_MARGIN_MM = 14;
const BOARD_THICKNESS_MM = 4;

function box(id: string, color: string, x: number, y: number, z: number, w: number, d: number, h: number): DesignObject {
  return { id, kind: "box", mode: "solid", x, y, z, w, d, h, rotationZ: 0, color, children: [] };
}

function part(component: CircuitComponent, x: number, y: number, z: number): DesignObject {
  const [green, purple, orange, azure] = TOY_COLORS;
  const id = `part-${component.label}`;
  switch (component.type) {
    case "battery": return box(id, orange, x, y, z + 7, 24, 14, 14);
    case "resistor": return { ...box(id, azure, x, y, z + 6, 8, 8, 12), kind: "cylinder" };
    case "led": return { ...box(id, purple, x, y, z + 6, 12, 12, 12), kind: "sphere" };
    case "switch": return box(id, green, x, y, z + 3, 16, 12, 6);
  }
}

/** A circuit as a simple 3D board with one block per part, laid out on a grid. */
export function circuitObjects(snapshot: SnapshotCircuit): DesignObject[] {
  const count = snapshot.components.length;
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / columns));
  const width = columns * SPACING_MM + BOARD_MARGIN_MM;
  const depth = rows * SPACING_MM + BOARD_MARGIN_MM;
  const board = box("board", TOY_COLORS[3], 0, 0, BOARD_THICKNESS_MM / 2, width, depth, BOARD_THICKNESS_MM);
  const parts = snapshot.components.map((component, i) => {
    const x = ((i % columns) - (columns - 1) / 2) * SPACING_MM;
    const y = (Math.floor(i / columns) - (rows - 1) / 2) * SPACING_MM;
    return part(component, x, y, BOARD_THICKNESS_MM);
  });
  return [board, ...parts];
}

/** What the Turntable shows: a 3D design's objects, a Block Lab program's output, or a circuit's board. */
export function modelObjects(snapshot: Snapshot): DesignObject[] {
  return snapshot.kind === "circuit" ? circuitObjects(snapshot) : objectsOf(snapshot);
}
