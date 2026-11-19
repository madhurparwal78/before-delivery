/** Reads a floor-plate model's window directions so each stack's bearing is derived from the model itself. */
import { STACK_LETTERS, type StackLetter } from "../shared/domain.js";

interface GlbNode {
  readonly name?: string;
  readonly translation?: [number, number, number];
}

const glbJson = (data: Buffer): { nodes?: GlbNode[] } => {
  if (data.toString("ascii", 0, 4) !== "glTF") throw new Error("not a binary glTF");
  const length = data.readUInt32LE(12);
  return JSON.parse(data.toString("utf8", 20, 20 + length)) as { nodes?: GlbNode[] };
};

/** North is the model's negative Z axis and east its positive X axis. */
export const bearingsFromPlate = (plate: Buffer): Record<StackLetter, number> => {
  const nodes = glbJson(plate).nodes ?? [];
  const bearings = {} as Record<StackLetter, number>;
  for (const stack of STACK_LETTERS) {
    const node = nodes.find((candidate) => candidate.name === `window-${stack}`);
    const [x, , z] = node?.translation ?? [Number.NaN, 0, Number.NaN];
    if (Number.isNaN(x) || Number.isNaN(z)) throw new Error(`plate has no window-${stack} node`);
    const degrees = (Math.atan2(x, -z) * 180) / Math.PI;
    bearings[stack] = Math.round(((degrees % 360) + 360) % 360) % 360;
  }
  return bearings;
};
