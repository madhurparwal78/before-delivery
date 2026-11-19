import type { DesignObject, ObjectShape, Snapshot3d } from "../../shared/types";
import { HOLE_GREY, TOY_COLORS } from "../render/palette";

export type StarterId = "desk-name-tag" | "pencil-cup" | "rainbow-lamp" | "spiral-tower";

export const STARTERS: readonly { id: StarterId; name: string }[] = [
  { id: "desk-name-tag", name: "Desk Name Tag" },
  { id: "pencil-cup", name: "Pencil Cup" },
  { id: "rainbow-lamp", name: "Rainbow Lamp" },
  { id: "spiral-tower", name: "Spiral Tower" },
];

/** The toy primaries every render in the product uses. */
export const TOY_COLOURS = { green: TOY_COLORS[0], purple: TOY_COLORS[1], orange: TOY_COLORS[2], azure: TOY_COLORS[3] } as const;
const { green, purple, orange, azure } = TOY_COLOURS;

/** Every starter rests on the z = 0 workplane, so `z` is the centre height: half the object's height for a base piece. */
function shape(id: string, kind: ObjectShape, colour: string, size: { w: number; d: number; h: number }, at: { x: number; y: number; z: number; rotationZ?: number }, hole = false): DesignObject {
  return {
    id, kind, mode: hole ? "hole" : "solid",
    x: at.x, y: at.y, z: at.z, ...size, rotationZ: at.rotationZ ?? 0,
    color: hole ? HOLE_GREY : colour, children: [],
  };
}

function box(id: string, colour: string, w: number, d: number, h: number, x: number, y: number, z: number, rotationZ = 0): DesignObject {
  return shape(id, "box", colour, { w, d, h }, { x, y, z, rotationZ });
}

function cylinder(id: string, colour: string, diameter: number, h: number, x: number, y: number, z: number, hole = false): DesignObject {
  return shape(id, "cylinder", colour, { w: diameter, d: diameter, h }, { x, y, z }, hole);
}

function deskNameTag(): DesignObject[] {
  return [
    box("tag-plate", azure, 60, 28, 4, 0, 0, 2),
    cylinder("tag-hole", azure, 6, 6, -24, 0, 3, true),
    box("tag-h-left", orange, 4, 16, 4, -6, 0, 6),
    box("tag-h-cross", orange, 4, 4, 4, -2, 0, 6),
    box("tag-h-right", orange, 4, 16, 4, 2, 0, 6),
    box("tag-i", orange, 4, 16, 4, 12, 0, 6),
  ];
}

function pencilCup(): DesignObject[] {
  return [
    cylinder("cup-body", purple, 44, 56, 0, 0, 28),
    cylinder("cup-hollow", purple, 36, 56, 0, 0, 34, true),
  ];
}

function rainbowLamp(): DesignObject[] {
  return [
    cylinder("lamp-base", orange, 46, 8, 0, 0, 4),
    cylinder("lamp-stem", purple, 36, 12, 0, 0, 14),
    cylinder("lamp-neck", azure, 28, 12, 0, 0, 26),
    shape("lamp-bulb", "sphere", green, { w: 34, d: 34, h: 34 }, { x: 0, y: 0, z: 49 }),
  ];
}

function spiralTower(): DesignObject[] {
  const colours = [green, purple, orange, azure, green, purple];
  return colours.map((colour, step) => box(`tower-${step + 1}`, colour, 40 - step * 3, 40 - step * 3, 8, 0, 0, 4 + step * 8, step * 15));
}

const BUILDERS: Record<StarterId, () => DesignObject[]> = {
  "desk-name-tag": deskNameTag,
  "pencil-cup": pencilCup,
  "rainbow-lamp": rainbowLamp,
  "spiral-tower": spiralTower,
};

/** The starter's design as an unsaved 3D snapshot, or null for an unknown id. */
export function starterSnapshot(id: string): Snapshot3d | null {
  const build = BUILDERS[id as StarterId] as (() => DesignObject[]) | undefined;
  if (!build) return null;
  return { kind: "3d", objects: build(), workplane: { origin: [0, 0, 0], normal: [0, 0, 1] } };
}
