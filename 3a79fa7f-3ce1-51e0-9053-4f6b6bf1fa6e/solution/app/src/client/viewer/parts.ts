// How the viewer draws each part: the catalog's colour name as a hue, and each part's shape from Seed data.
const HUES: Record<string, string> = {
  "sky blue": "#5fb3e6",
  teal: "#2a9d8f",
  "deep teal": "#16635f",
  coral: "#ef7a5d",
  "brushed silver": "#c3c9ce",
  black: "#232528",
  "dark grey": "#4a4f56",
  "light grey": "#b9bfc5",
  yellow: "#f3c632",
  orange: "#f0862a",
  green: "#41ad5b",
  white: "#f4f4f2",
  "pearl white": "#efece4",
  "carbon black": "#2b2d30",
  graphite: "#5c626a",
};
export const RING = "#2b9a95";
export const CHARGE_ON = "#41ad5b";
export const CHARGE_OFF = "#3a3d40";

export function hue(colour: string): string {
  return HUES[colour] ?? "#888888";
}

/** Shapes by SKU (Seed data's Shape column): wing outline, mast section, pod blades, pack length, controller grip. */
export interface Shape {
  wing: "broad" | "swept" | "wide" | "narrow";
  mast: "round" | "blade";
  blades: 2 | 3;
  folding: boolean;
  pack: "block" | "longer" | "short";
  grip: "trigger" | "ring";
}

const SHAPES: Record<string, Partial<Shape>> = {
  "WNG-B170": { wing: "broad" },
  "WNG-Q150": { wing: "swept" },
  "WNG-Q180": { wing: "wide" },
  "WNG-Q120": { wing: "narrow" },
  "MST-AL28": { mast: "round" },
  "MST-CF28": { mast: "blade" },
  "MST-CF32": { mast: "blade" },
  "PRP-68": { blades: 3, folding: false },
  "PRP-55F": { blades: 2, folding: true },
  "BAT-18": { pack: "block" },
  "BAT-22": { pack: "longer" },
  "BAT-10": { pack: "short" },
  "CTL-STD": { grip: "trigger" },
  "CTL-ELT": { grip: "ring" },
};
const PLAIN: Shape = { wing: "broad", mast: "round", blades: 3, folding: false, pack: "block", grip: "trigger" };

export function shape(sku: string): Shape {
  return { ...PLAIN, ...SHAPES[sku] };
}

/** Pack length in metres along the board for each pack shape. */
export const PACK_LENGTH: Record<Shape["pack"], number> = { block: 0.48, longer: 0.58, short: 0.36 };
