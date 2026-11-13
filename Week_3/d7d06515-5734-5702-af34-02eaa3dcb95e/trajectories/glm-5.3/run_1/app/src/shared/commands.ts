export const aliases: Record<string, string> = {
  L: "LINE",
  PL: "PLINE",
  C: "CIRCLE",
  A: "ARC",
  REC: "RECTANG",
  POL: "POLYGON",
  SPL: "SPLINE",
  M: "MOVE",
  CO: "COPY",
  RO: "ROTATE",
  SC: "SCALE",
  MI: "MIRROR",
  O: "OFFSET",
  TR: "TRIM",
  EX: "EXTEND",
  F: "FILLET",
  E: "ERASE",
  LA: "LAYER",
  I: "INSERT",
  DLI: "DIMLINEAR",
  DAL: "DIMALIGNED",
  DRA: "DIMRADIUS",
  DAN: "DIMANGULAR",
  MT: "MTEXT",
  T: "MTEXT",
  DI: "DIST",
  RC: "REVCLOUD",
  U: "UNDO",
  REDO: "REDO",
  Z: "ZOOM",
};

export type CommandName =
  | "LINE"
  | "PLINE"
  | "RECTANG"
  | "CIRCLE"
  | "ARC"
  | "POLYGON"
  | "SPLINE"
  | "MOVE"
  | "COPY"
  | "ROTATE"
  | "SCALE"
  | "MIRROR"
  | "ERASE"
  | "OFFSET"
  | "TRIM"
  | "EXTEND"
  | "FILLET"
  | "INSERT"
  | "DIMLINEAR"
  | "DIMALIGNED"
  | "DIMRADIUS"
  | "DIMANGULAR"
  | "MTEXT"
  | "DIST"
  | "REVCLOUD"
  | "ZOOM"
  | "UNDO"
  | "REDO"
  | "LAYER"
  | "PROPERTIES";

export const commandNames: CommandName[] = [
  "LINE",
  "PLINE",
  "RECTANG",
  "CIRCLE",
  "ARC",
  "POLYGON",
  "SPLINE",
  "MOVE",
  "COPY",
  "ROTATE",
  "SCALE",
  "MIRROR",
  "ERASE",
  "OFFSET",
  "TRIM",
  "EXTEND",
  "FILLET",
  "INSERT",
  "DIMLINEAR",
  "DIMALIGNED",
  "DIMRADIUS",
  "DIMANGULAR",
  "MTEXT",
  "DIST",
  "REVCLOUD",
  "ZOOM",
  "UNDO",
  "REDO",
];

export function resolveCommand(text: string): CommandName | null {
  const upper = text.trim().toUpperCase();
  if ((commandNames as string[]).includes(upper)) return upper as CommandName;
  const alias = aliases[upper];
  if (alias) return alias as CommandName;
  return null;
}

/** Prompts in order, for the command reference and the command line. */
export const prompts: Record<string, string[]> = {
  LINE: ["Specify first point:", "Specify next point or [Undo]:", "Specify next point or [Close/Undo]:"],
  PLINE: ["Specify start point:", "Specify next point or [Close/Undo]:"],
  RECTANG: ["Specify first corner point:", "Specify other corner point:"],
  CIRCLE: ["Specify center point:", "Specify radius:"],
  ARC: ["Specify center point:", "Specify radius:", "Specify start angle:", "Specify end angle:"],
  POLYGON: ["Enter number of sides:", "Specify center point:", "Specify radius:"],
  SPLINE: ["Specify first point:", "Specify next point or [Undo]:"],
  MOVE: ["Select objects:", "Specify base point:", "Specify second point:"],
  COPY: ["Select objects:", "Specify base point:", "Specify second point:"],
  ROTATE: ["Select objects:", "Specify base point:", "Specify rotation angle:"],
  SCALE: ["Select objects:", "Specify base point:", "Specify scale factor:"],
  MIRROR: [
    "Select objects:",
    "Specify first point of mirror line:",
    "Specify second point of mirror line:",
    "Erase source objects? [Yes/No]:",
  ],
  ERASE: ["Select objects:"],
  OFFSET: [
    "Specify offset distance:",
    "Select object to offset:",
    "Specify point on side to offset:",
    "Select object to offset:",
  ],
  TRIM: ["Select object to trim:"],
  EXTEND: ["Select object to extend:"],
  FILLET: ["Specify fillet radius:", "Select first object:", "Select second object:"],
  INSERT: ["Specify insertion point:"],
  DIMLINEAR: [
    "Specify first extension line origin:",
    "Specify second extension line origin:",
    "Specify dimension line location:",
  ],
  DIMALIGNED: [
    "Specify first extension line origin:",
    "Specify second extension line origin:",
    "Specify dimension line location:",
  ],
  DIMRADIUS: ["Select arc or circle:", "Specify dimension line location:"],
  DIMANGULAR: ["Select first line:", "Select second line:", "Specify dimension arc line location:"],
  MTEXT: ["Specify first corner:", "Specify opposite corner:", "Enter text:"],
  DIST: ["Specify first point:", "Specify second point:"],
  REVCLOUD: ["Specify first corner:", "Specify opposite corner:"],
  ZOOM: ["Enter E for extents, or press + or -:"],
};

export const idlePrompt = "Command:";

export const shortcuts: Array<{ keys: string; action: string }> = [
  { keys: "F1", action: "Command reference" },
  { keys: "F3", action: "OSNAP" },
  { keys: "F8", action: "ORTHO" },
  { keys: "F9", action: "SNAP & GRID" },
  { keys: "F10", action: "POLAR" },
  { keys: "F11", action: "OTRACK" },
  { keys: "Ctrl+P", action: "Export dialog" },
  { keys: "Ctrl+Z", action: "UNDO" },
  { keys: "Ctrl+Y", action: "REDO" },
  { keys: "+ / -", action: "Zoom on the canvas" },
  { keys: "Enter", action: "Repeat the last command" },
  { keys: "Escape", action: "Cancel the running command" },
  { keys: "#<handle>", action: "Select an object by handle" },
  { keys: "Space", action: "Submit the command line" },
];
