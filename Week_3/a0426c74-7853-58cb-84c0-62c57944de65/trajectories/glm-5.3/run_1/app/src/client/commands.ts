import type { Entity, Pt } from '../shared/geometry.js';

// ---------------------------------------------------------------------------
// Command line: names, aliases, stage prompts, point forms and refusals.
// Every string here is published in Business rules.
// ---------------------------------------------------------------------------

export interface CommandSpec {
  name: string;
  aliases: string[];
  stages: string[];
}

export const COMMANDS: CommandSpec[] = [
  { name: 'LINE', aliases: ['L'], stages: ['LINE: from point', 'LINE: to point (Enter ends, U steps back)'] },
  { name: 'PLINE', aliases: ['PL'], stages: ['PLINE: from point', 'PLINE: to point (Enter ends, U steps back, CL closes)'] },
  { name: 'RECT', aliases: ['REC'], stages: ['RECT: first corner', 'RECT: opposite corner'] },
  { name: 'CIRCLE', aliases: ['C'], stages: ['CIRCLE: centre', 'CIRCLE: radius'] },
  { name: 'ARC', aliases: ['A'], stages: ['ARC: centre', 'ARC: start point', 'ARC: end point'] },
  { name: 'MOVE', aliases: ['M'], stages: ['MOVE: pick entities (Enter ends picking)', 'MOVE: from point', 'MOVE: to point'] },
  { name: 'COPY', aliases: ['CO'], stages: ['COPY: pick entities (Enter ends picking)', 'COPY: from point', 'COPY: to point (Enter ends)'] },
  { name: 'ROTATE', aliases: ['RO'], stages: ['ROTATE: pick entities (Enter ends picking)', 'ROTATE: about point', 'ROTATE: angle in degrees'] },
  { name: 'SCALE', aliases: ['SC'], stages: ['SCALE: pick entities (Enter ends picking)', 'SCALE: about point', 'SCALE: factor'] },
  { name: 'MIRROR', aliases: ['MI'], stages: ['MIRROR: pick entities (Enter ends picking)', 'MIRROR: axis first point', 'MIRROR: axis second point', 'MIRROR: keep originals? Y or N (Enter is Y)'] },
  { name: 'OFFSET', aliases: ['O'], stages: ['OFFSET: distance', 'OFFSET: pick entity', 'OFFSET: pick side'] },
  { name: 'TRIM', aliases: ['TR'], stages: ['TRIM: pick cutting edges (Enter for every entity)', 'TRIM: pick the part to remove (Enter ends)'] },
  { name: 'EXTEND', aliases: ['EX'], stages: ['EXTEND: pick boundaries (Enter for every entity)', 'EXTEND: pick the end to extend (Enter ends)'] },
  { name: 'FILLET', aliases: ['F'], stages: ['FILLET: radius', 'FILLET: first line', 'FILLET: second line'] },
  { name: 'CHAMFER', aliases: ['CHA'], stages: ['CHAMFER: first distance', 'CHAMFER: second distance', 'CHAMFER: first line', 'CHAMFER: second line'] },
  { name: 'ARRAY', aliases: ['AR'], stages: ['ARRAY: pick entities (Enter ends picking)', 'ARRAY: R for rows or P for polar'] },
  { name: 'HATCH', aliases: ['H'], stages: ['HATCH: pick a point inside'] },
  { name: 'DIST', aliases: ['DI'], stages: ['DIST: first point', 'DIST: second point'] },
  { name: 'AREA', aliases: ['AA'], stages: ['AREA: pick a closed entity or a point inside'] },
  { name: 'ERASE', aliases: ['E'], stages: ['ERASE: pick entities (Enter ends picking)'] },
  { name: 'EXPLODE', aliases: ['X'], stages: ['EXPLODE: pick block inserts (Enter ends picking)'] },
  { name: 'LAYER', aliases: ['LA'], stages: [] },
  { name: 'BLOCK', aliases: ['B'], stages: ['BLOCK: name', 'BLOCK: base point', 'BLOCK: pick entities (Enter ends picking)', 'BLOCK: attribute TAG=default (Enter for none)'] },
  { name: 'INSERT', aliases: ['I'], stages: ['INSERT: block name', 'INSERT: insertion point', 'INSERT: scale (Enter is 1)', 'INSERT: rotation in degrees (Enter is 0)'] },
  { name: 'PURGE', aliases: ['PU'], stages: [] },
  { name: 'DIMLINEAR', aliases: ['DL'], stages: ['DIMLINEAR: first point', 'DIMLINEAR: second point', 'DIMLINEAR: line position'] },
  { name: 'DIMALIGNED', aliases: ['DA'], stages: ['DIMALIGNED: first point', 'DIMALIGNED: second point', 'DIMALIGNED: line position'] },
  { name: 'DIMANGLE', aliases: ['DG'], stages: ['DIMANGLE: first line', 'DIMANGLE: second line', 'DIMANGLE: arc position'] },
  { name: 'DIMRADIUS', aliases: ['DR'], stages: ['DIMRADIUS: pick circle or arc', 'DIMRADIUS: text position'] },
  { name: 'CONSTRAIN', aliases: ['CN'], stages: ['CONSTRAIN: kind (coincident, horizontal, vertical, parallel, perpendicular, equal, fixed, length, radius)'] },
  { name: 'PARAM', aliases: ['PM'], stages: ['PARAM: name = expression'] },
  { name: 'XATTACH', aliases: ['XA'], stages: ['XATTACH: drawing name', 'XATTACH: xref name', 'XATTACH: insertion point', 'XATTACH: scale (Enter is 1)', 'XATTACH: rotation in degrees (Enter is 0)'] },
  { name: 'XBIND', aliases: ['XB'], stages: ['XBIND: xref name'] },
  { name: 'FIND', aliases: ['FD'], stages: [] },
  { name: 'ZOOMALL', aliases: ['ZA'], stages: [] },
];

export const READY_PROMPT = 'Ready. Type a command.';
export const CANCELLED_PROMPT = 'Cancelled.';

export const REFUSALS = {
  notPoint: 'That isn\u2019t a point. Try 10,20 or @5,0 or @10<45.',
  notNumber: 'That isn\u2019t a number.',
  notPositive: 'Enter a number greater than 0.',
  unknownBlock: (name: string): string => `No block named ${name}.`,
  unknownDrawing: (name: string): string => `No drawing named ${name} in this folder.`,
  unknownXref: (name: string): string => `No xref named ${name}.`,
  nothingToPick: 'Nothing there to pick.',
} as const;

// Stages whose input is a name, expression or text: Space is a character there.
const NAME_STAGES = new Set([
  'BLOCK: name',
  'INSERT: block name',
  'XATTACH: drawing name',
  'XATTACH: xref name',
  'XBIND: xref name',
  'BLOCK: attribute TAG=default (Enter for none)',
  'PARAM: name = expression',
  'CONSTRAIN: expression',
  'CONSTRAIN: kind (coincident, horizontal, vertical, parallel, perpendicular, equal, fixed, length, radius)',
]);

export function stageTakesSpace(stage: string): boolean {
  return NAME_STAGES.has(stage);
}

export function resolveCommand(text: string): CommandSpec | null {
  const upper = text.trim().toUpperCase();
  if (!upper) return null;
  for (const command of COMMANDS) {
    if (command.name === upper || command.aliases.includes(upper)) return command;
  }
  return null;
}

export function unknownCommandText(text: string): string {
  return `Unknown command: ${text.trim().toUpperCase()}. Nothing happened.`;
}

export function parsePoint(text: string, lastPoint: Pt): Pt | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('@')) {
    const rest = trimmed.slice(1);
    if (rest.includes('<')) {
      const [distanceText, angleText] = rest.split('<');
      const distance = Number(distanceText);
      const angle = Number(angleText);
      if (!Number.isFinite(distance) || !Number.isFinite(angle)) return null;
      const radians = (angle * Math.PI) / 180;
      return {
        x: round6(lastPoint.x + distance * Math.cos(radians)),
        y: round6(lastPoint.y + distance * Math.sin(radians)),
      };
    }
    const parts = rest.split(',');
    if (parts.length !== 2) return null;
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: round6(lastPoint.x + x), y: round6(lastPoint.y + y) };
  }
  const parts = trimmed.split(',');
  if (parts.length !== 2) return null;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: round6(x), y: round6(y) };
}

function round6(value: number): number {
  const factor = 10 ** 6;
  const scaled = value * factor;
  const rounded = Math.abs(scaled) % 1 >= 0.5 ? Math.trunc(scaled) + Math.sign(scaled) : Math.trunc(scaled);
  return rounded / factor;
}

export function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export type { Entity, Pt };
