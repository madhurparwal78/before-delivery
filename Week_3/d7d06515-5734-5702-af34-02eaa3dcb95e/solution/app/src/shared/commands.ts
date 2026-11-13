// Command set published in the brief: aliases, prompts and editor shortcuts.

export const COMMAND_NAMES = [
  'LINE', 'PLINE', 'CIRCLE', 'ARC', 'RECTANG', 'POLYGON', 'SPLINE', 'MOVE', 'COPY', 'ROTATE', 'SCALE', 'MIRROR',
  'ERASE', 'OFFSET', 'TRIM', 'EXTEND', 'FILLET', 'LAYER', 'INSERT', 'DIMLINEAR', 'DIMALIGNED', 'DIMRADIUS',
  'DIMANGULAR', 'MTEXT', 'DIST', 'REVCLOUD', 'UNDO', 'REDO', 'ZOOM',
] as const;
export type CommandName = (typeof COMMAND_NAMES)[number];

/** Aliases are case-insensitive; the full name also works. */
export const ALIASES: Record<string, CommandName> = {
  L: 'LINE', PL: 'PLINE', C: 'CIRCLE', A: 'ARC', REC: 'RECTANG', POL: 'POLYGON', SPL: 'SPLINE', M: 'MOVE', CO: 'COPY',
  RO: 'ROTATE', SC: 'SCALE', MI: 'MIRROR', O: 'OFFSET', TR: 'TRIM', F: 'FILLET', E: 'ERASE', LA: 'LAYER', I: 'INSERT',
  DLI: 'DIMLINEAR', DAL: 'DIMALIGNED', DRA: 'DIMRADIUS', DAN: 'DIMANGULAR', MT: 'MTEXT', T: 'MTEXT', DI: 'DIST',
  RC: 'REVCLOUD', U: 'UNDO', REDO: 'REDO', Z: 'ZOOM', EX: 'EXTEND',
};

/** Prompts in order for each command (Feedback states > Command prompts). `*` marks a prompt that repeats until Enter. */
export const PROMPTS: Record<CommandName, readonly string[]> = {
  LINE: ['Specify first point:', 'Specify next point or [Undo]:', 'Specify next point or [Close/Undo]:'],
  PLINE: ['Specify start point:', 'Specify next point or [Close/Undo]:'],
  RECTANG: ['Specify first corner point:', 'Specify other corner point:'],
  CIRCLE: ['Specify center point:', 'Specify radius:'],
  ARC: ['Specify center point:', 'Specify radius:', 'Specify start angle:', 'Specify end angle:'],
  POLYGON: ['Enter number of sides:', 'Specify center point:', 'Specify radius:'],
  SPLINE: ['Specify first point:', 'Specify next point or [Undo]:'],
  MOVE: ['Select objects:', 'Specify base point:', 'Specify second point:'],
  COPY: ['Select objects:', 'Specify base point:', 'Specify second point:'],
  ROTATE: ['Select objects:', 'Specify base point:', 'Specify rotation angle:'],
  SCALE: ['Select objects:', 'Specify base point:', 'Specify scale factor:'],
  MIRROR: ['Select objects:', 'Specify first point of mirror line:', 'Specify second point of mirror line:', 'Erase source objects? [Yes/No]:'],
  ERASE: ['Select objects:'],
  OFFSET: ['Specify offset distance:', 'Select object to offset:', 'Specify point on side to offset:'],
  TRIM: ['Select object to trim:'],
  EXTEND: ['Select object to extend:'],
  FILLET: ['Specify fillet radius:', 'Select first object:', 'Select second object:'],
  LAYER: [],
  INSERT: ['Specify insertion point:'],
  DIMLINEAR: ['Specify first extension line origin:', 'Specify second extension line origin:', 'Specify dimension line location:'],
  DIMALIGNED: ['Specify first extension line origin:', 'Specify second extension line origin:', 'Specify dimension line location:'],
  DIMRADIUS: ['Select arc or circle:', 'Specify dimension line location:'],
  DIMANGULAR: ['Select first line:', 'Select second line:', 'Specify dimension arc line location:'],
  MTEXT: ['Specify first corner:', 'Specify opposite corner:', 'Enter text:'],
  DIST: ['Specify first point:', 'Specify second point:'],
  REVCLOUD: ['Specify first corner:', 'Specify opposite corner:'],
  UNDO: [],
  REDO: [],
  ZOOM: ['Enter E for extents, or press + or -:'],
};

export const IDLE_PROMPT = 'Command:';

export const SHORTCUTS: readonly { keys: string; action: string }[] = [
  { keys: 'F1', action: 'Command reference' },
  { keys: 'F3', action: 'OSNAP' },
  { keys: 'F8', action: 'ORTHO' },
  { keys: 'F9', action: 'SNAP & GRID' },
  { keys: 'F10', action: 'POLAR' },
  { keys: 'F11', action: 'OTRACK' },
  { keys: 'Ctrl+P', action: 'Export dialog' },
  { keys: 'Ctrl+Z', action: 'UNDO (outside text fields)' },
  { keys: 'Ctrl+Y', action: 'REDO (outside text fields)' },
  { keys: '+ and -', action: 'Zoom while the canvas has focus' },
];

export const RIBBON_TABS = {
  Draw: [['Line', 'LINE'], ['Polyline', 'PLINE'], ['Circle', 'CIRCLE'], ['Arc', 'ARC'], ['Rectangle', 'RECTANG'], ['Polygon', 'POLYGON'], ['Spline', 'SPLINE']],
  Annotate: [['Text', 'MTEXT'], ['Linear', 'DIMLINEAR'], ['Aligned', 'DIMALIGNED'], ['Radius', 'DIMRADIUS'], ['Angular', 'DIMANGULAR']],
  Modify: [['Move', 'MOVE'], ['Copy', 'COPY'], ['Rotate', 'ROTATE'], ['Mirror', 'MIRROR'], ['Scale', 'SCALE'], ['Trim', 'TRIM'], ['Extend', 'EXTEND'], ['Fillet', 'FILLET'], ['Offset', 'OFFSET'], ['Erase', 'ERASE']],
} as const satisfies Record<string, readonly (readonly [string, CommandName])[]>;
