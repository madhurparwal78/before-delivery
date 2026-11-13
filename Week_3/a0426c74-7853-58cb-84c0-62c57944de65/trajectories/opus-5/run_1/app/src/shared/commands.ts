export interface CommandSpec {
  name: string;
  alias: string;
}

export const COMMANDS: CommandSpec[] = [
  { name: 'LINE', alias: 'L' },
  { name: 'PLINE', alias: 'PL' },
  { name: 'RECT', alias: 'REC' },
  { name: 'CIRCLE', alias: 'C' },
  { name: 'ARC', alias: 'A' },
  { name: 'MOVE', alias: 'M' },
  { name: 'COPY', alias: 'CO' },
  { name: 'ROTATE', alias: 'RO' },
  { name: 'SCALE', alias: 'SC' },
  { name: 'MIRROR', alias: 'MI' },
  { name: 'OFFSET', alias: 'O' },
  { name: 'TRIM', alias: 'TR' },
  { name: 'EXTEND', alias: 'EX' },
  { name: 'FILLET', alias: 'F' },
  { name: 'CHAMFER', alias: 'CHA' },
  { name: 'ARRAY', alias: 'AR' },
  { name: 'HATCH', alias: 'H' },
  { name: 'DIST', alias: 'DI' },
  { name: 'AREA', alias: 'AA' },
  { name: 'ERASE', alias: 'E' },
  { name: 'EXPLODE', alias: 'X' },
  { name: 'LAYER', alias: 'LA' },
  { name: 'BLOCK', alias: 'B' },
  { name: 'INSERT', alias: 'I' },
  { name: 'PURGE', alias: 'PU' },
  { name: 'DIMLINEAR', alias: 'DL' },
  { name: 'DIMALIGNED', alias: 'DA' },
  { name: 'DIMANGLE', alias: 'DG' },
  { name: 'DIMRADIUS', alias: 'DR' },
  { name: 'CONSTRAIN', alias: 'CN' },
  { name: 'PARAM', alias: 'PM' },
  { name: 'XATTACH', alias: 'XA' },
  { name: 'XBIND', alias: 'XB' },
  { name: 'FIND', alias: 'FD' },
  { name: 'ZOOMALL', alias: 'ZA' },
];

export function resolveCommand(text: string): string | null {
  const wanted = text.trim().toUpperCase();
  if (!wanted) return null;
  const found = COMMANDS.find((command) => command.name === wanted || command.alias === wanted);
  return found ? found.name : null;
}

export const READY_PROMPT = 'Ready. Type a command.';
export const CANCELLED_PROMPT = 'Cancelled.';

export function unknownCommand(text: string): string {
  return `Unknown command: ${text.trim().toUpperCase()}. Nothing happened.`;
}

export const PROMPTS = {
  LINE_FROM: 'LINE: from point',
  LINE_TO: 'LINE: to point (Enter ends, U steps back)',
  PLINE_FROM: 'PLINE: from point',
  PLINE_TO: 'PLINE: to point (Enter ends, U steps back, CL closes)',
  RECT_FIRST: 'RECT: first corner',
  RECT_OPPOSITE: 'RECT: opposite corner',
  CIRCLE_CENTRE: 'CIRCLE: centre',
  CIRCLE_RADIUS: 'CIRCLE: radius',
  ARC_CENTRE: 'ARC: centre',
  ARC_START: 'ARC: start point',
  ARC_END: 'ARC: end point',
  MOVE_PICK: 'MOVE: pick entities (Enter ends picking)',
  MOVE_FROM: 'MOVE: from point',
  MOVE_TO: 'MOVE: to point',
  COPY_PICK: 'COPY: pick entities (Enter ends picking)',
  COPY_FROM: 'COPY: from point',
  COPY_TO: 'COPY: to point (Enter ends)',
  ROTATE_PICK: 'ROTATE: pick entities (Enter ends picking)',
  ROTATE_ABOUT: 'ROTATE: about point',
  ROTATE_ANGLE: 'ROTATE: angle in degrees',
  SCALE_PICK: 'SCALE: pick entities (Enter ends picking)',
  SCALE_ABOUT: 'SCALE: about point',
  SCALE_FACTOR: 'SCALE: factor',
  MIRROR_PICK: 'MIRROR: pick entities (Enter ends picking)',
  MIRROR_AXIS_FIRST: 'MIRROR: axis first point',
  MIRROR_AXIS_SECOND: 'MIRROR: axis second point',
  MIRROR_KEEP: 'MIRROR: keep originals? Y or N (Enter is Y)',
  OFFSET_DISTANCE: 'OFFSET: distance',
  OFFSET_PICK: 'OFFSET: pick entity',
  OFFSET_SIDE: 'OFFSET: pick side',
  TRIM_EDGES: 'TRIM: pick cutting edges (Enter for every entity)',
  TRIM_PART: 'TRIM: pick the part to remove (Enter ends)',
  EXTEND_BOUNDARIES: 'EXTEND: pick boundaries (Enter for every entity)',
  EXTEND_END: 'EXTEND: pick the end to extend (Enter ends)',
  FILLET_RADIUS: 'FILLET: radius',
  FILLET_FIRST: 'FILLET: first line',
  FILLET_SECOND: 'FILLET: second line',
  CHAMFER_FIRST_DISTANCE: 'CHAMFER: first distance',
  CHAMFER_SECOND_DISTANCE: 'CHAMFER: second distance',
  CHAMFER_FIRST: 'CHAMFER: first line',
  CHAMFER_SECOND: 'CHAMFER: second line',
  ARRAY_PICK: 'ARRAY: pick entities (Enter ends picking)',
  ARRAY_KIND: 'ARRAY: R for rows or P for polar',
  ARRAY_ROWS: 'ARRAY: rows',
  ARRAY_COLUMNS: 'ARRAY: columns',
  ARRAY_ROW_GAP: 'ARRAY: row gap',
  ARRAY_COLUMN_GAP: 'ARRAY: column gap',
  ARRAY_CENTRE: 'ARRAY: centre',
  ARRAY_COUNT: 'ARRAY: count',
  ARRAY_TOTAL: 'ARRAY: total angle',
  HATCH_POINT: 'HATCH: pick a point inside',
  DIST_FIRST: 'DIST: first point',
  DIST_SECOND: 'DIST: second point',
  AREA_PICK: 'AREA: pick a closed entity or a point inside',
  ERASE_PICK: 'ERASE: pick entities (Enter ends picking)',
  EXPLODE_PICK: 'EXPLODE: pick block inserts (Enter ends picking)',
  BLOCK_NAME: 'BLOCK: name',
  BLOCK_BASE: 'BLOCK: base point',
  BLOCK_PICK: 'BLOCK: pick entities (Enter ends picking)',
  BLOCK_ATTRIBUTE: 'BLOCK: attribute TAG=default (Enter for none)',
  INSERT_NAME: 'INSERT: block name',
  INSERT_POINT: 'INSERT: insertion point',
  INSERT_SCALE: 'INSERT: scale (Enter is 1)',
  INSERT_ROTATION: 'INSERT: rotation in degrees (Enter is 0)',
  DIMLINEAR_FIRST: 'DIMLINEAR: first point',
  DIMLINEAR_SECOND: 'DIMLINEAR: second point',
  DIMLINEAR_LINE: 'DIMLINEAR: line position',
  DIMALIGNED_FIRST: 'DIMALIGNED: first point',
  DIMALIGNED_SECOND: 'DIMALIGNED: second point',
  DIMALIGNED_LINE: 'DIMALIGNED: line position',
  DIMANGLE_FIRST: 'DIMANGLE: first line',
  DIMANGLE_SECOND: 'DIMANGLE: second line',
  DIMANGLE_ARC: 'DIMANGLE: arc position',
  DIMRADIUS_PICK: 'DIMRADIUS: pick circle or arc',
  DIMRADIUS_TEXT: 'DIMRADIUS: text position',
  CONSTRAIN_KIND: 'CONSTRAIN: kind (coincident, horizontal, vertical, parallel, perpendicular, equal, fixed, length, radius)',
  CONSTRAIN_FIRST_ENTITY: 'CONSTRAIN: pick first entity',
  CONSTRAIN_SECOND_ENTITY: 'CONSTRAIN: pick second entity',
  CONSTRAIN_FIRST_POINT: 'CONSTRAIN: pick first point',
  CONSTRAIN_SECOND_POINT: 'CONSTRAIN: pick second point',
  CONSTRAIN_EXPRESSION: 'CONSTRAIN: expression',
  PARAM_ENTRY: 'PARAM: name = expression',
  XATTACH_DRAWING: 'XATTACH: drawing name',
  XATTACH_NAME: 'XATTACH: xref name',
  XATTACH_POINT: 'XATTACH: insertion point',
  XATTACH_SCALE: 'XATTACH: scale (Enter is 1)',
  XATTACH_ROTATION: 'XATTACH: rotation in degrees (Enter is 0)',
  XBIND_NAME: 'XBIND: xref name',
} as const;

export const REFUSALS = {
  notAPoint: 'That isn\u2019t a point. Try 10,20 or @5,0 or @10<45.',
  notANumber: 'That isn\u2019t a number.',
  notPositive: 'Enter a number greater than 0.',
  nothingToPick: 'Nothing there to pick.',
} as const;

export function unknownBlock(name: string): string {
  return `No block named ${name}.`;
}

export function unknownDrawing(name: string): string {
  return `No drawing named ${name} in this folder.`;
}

export function unknownXref(name: string): string {
  return `No xref named ${name}.`;
}

/** Stages whose input is a name, an expression or text, where Space is a character. */
export const TEXT_STAGES: string[] = [
  PROMPTS.BLOCK_NAME,
  PROMPTS.BLOCK_ATTRIBUTE,
  PROMPTS.INSERT_NAME,
  PROMPTS.XATTACH_DRAWING,
  PROMPTS.XATTACH_NAME,
  PROMPTS.XBIND_NAME,
  PROMPTS.PARAM_ENTRY,
  PROMPTS.CONSTRAIN_EXPRESSION,
  PROMPTS.CONSTRAIN_KIND,
];

export const CONSTRAINT_KINDS = [
  'coincident',
  'horizontal',
  'vertical',
  'parallel',
  'perpendicular',
  'equal',
  'fixed',
  'length',
  'radius',
] as const;
