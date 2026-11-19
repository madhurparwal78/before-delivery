import { ArrowUpDown, Box, Circle, Cylinder, CircleDashed, MoveHorizontal, MoveDiagonal2, Repeat, type LucideIcon } from "lucide-react";
import type { BlockName } from "../../shared/types";

type BlockGroup = "shape" | "move" | "hole" | "repeat";

interface BlockInfo {
  /** The palette button text, and the name shown on the block in the program. */
  label: string;
  icon: LucideIcon;
  group: BlockGroup;
}

/** Palette order. */
export const PALETTE: readonly BlockName[] = ["addBox", "addCylinder", "addSphere", "moveX", "moveY", "moveZ", "makeHole", "repeat"];

export const BLOCKS: Record<BlockName, BlockInfo> = {
  addBox: { label: "Add Box", icon: Box, group: "shape" },
  addCylinder: { label: "Add Cylinder", icon: Cylinder, group: "shape" },
  addSphere: { label: "Add Sphere", icon: Circle, group: "shape" },
  moveX: { label: "Move X by", icon: MoveHorizontal, group: "move" },
  moveY: { label: "Move Y by", icon: MoveDiagonal2, group: "move" },
  moveZ: { label: "Move Z by", icon: ArrowUpDown, group: "move" },
  makeHole: { label: "Make hole", icon: CircleDashed, group: "hole" },
  repeat: { label: "Repeat", icon: Repeat, group: "repeat" },
};
