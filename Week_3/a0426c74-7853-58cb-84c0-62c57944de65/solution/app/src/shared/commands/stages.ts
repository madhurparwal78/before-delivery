// The command table's vocabulary: what a stage waits for, what an input does to it, and every stage prompt of Business rules.
import type { Point, DistributiveOmit, EntityDraft, Op } from '../types.ts';
import type { CommandEnv } from './env.ts';

/** What the command line waits for. `text` stages take Space as a character (names, expressions, attribute values). */
export type Expects = 'command' | 'point' | 'pick' | 'number' | 'word' | 'text';

/** One input to a stage: the text typed before Enter or Space, or a world point from a pointer click. */
export type Entry = { kind: 'text'; text: string } | { kind: 'point'; point: Point };

/** An operation without its id: the session numbers the ops of a group when the command ends. */
export type OpSpec = DistributiveOmit<Op, 'op_id'>;

export type FocusTarget = 'layer-list' | 'parameter-list' | 'find';

/** How a command run ends. No ops means nothing to submit. */
interface Finish {
  ops: OpSpec[];
  /** a result or note that replaces the prompt until the next key press */
  message?: string;
  focus?: FocusTarget;
  view?: 'zoomall';
}

/** What a stage made of an input. `point` is a point the input entered: it becomes the last point for `@` forms. */
export type Step =
  | { kind: 'next'; stage: Stage; point?: Point }
  | { kind: 'stay'; message?: string; point?: Point }
  | { kind: 'finish'; finish: Finish; point?: Point };

export interface Stage {
  readonly prompt: string;
  readonly expects: Expects;
  accept(entry: Entry, env: CommandEnv, last: Point): Step;
  /** rubber-band ghosts for the pointer at `cursor` */
  preview?(cursor: Point, env: CommandEnv, last: Point): EntityDraft[];
}

export interface Definition {
  readonly name: string;
  readonly alias: string;
  /** false for the commands that only read (DIST, AREA, FIND, ZOOMALL) */
  readonly edits: boolean;
  begin(env: CommandEnv): Step;
}

export const next = (stage: Stage, point?: Point): Step => ({ kind: 'next', stage, point });
export const stay = (message?: string, point?: Point): Step => ({ kind: 'stay', message, point });
export const finish = (ops: OpSpec[], rest: Omit<Finish, 'ops'> = {}, point?: Point): Step => ({ kind: 'finish', finish: { ops, ...rest }, point });

export const isEnter = (entry: Entry): boolean => entry.kind === 'text' && entry.text === '';

/** The typed word, upper-cased, or null for a click. */
export const wordOf = (entry: Entry): string | null => (entry.kind === 'text' ? entry.text.toUpperCase() : null);

/** Every stage prompt of the command table. */
export const PROMPTS = {
  LINE: { from: 'LINE: from point', to: 'LINE: to point (Enter ends, U steps back)' },
  PLINE: { from: 'PLINE: from point', to: 'PLINE: to point (Enter ends, U steps back, CL closes)' },
  RECT: { first: 'RECT: first corner', opposite: 'RECT: opposite corner' },
  CIRCLE: { centre: 'CIRCLE: centre', radius: 'CIRCLE: radius' },
  ARC: { centre: 'ARC: centre', start: 'ARC: start point', end: 'ARC: end point' },
  MOVE: { pick: 'MOVE: pick entities (Enter ends picking)', from: 'MOVE: from point', to: 'MOVE: to point' },
  COPY: { pick: 'COPY: pick entities (Enter ends picking)', from: 'COPY: from point', to: 'COPY: to point (Enter ends)' },
  ROTATE: { pick: 'ROTATE: pick entities (Enter ends picking)', about: 'ROTATE: about point', angle: 'ROTATE: angle in degrees' },
  SCALE: { pick: 'SCALE: pick entities (Enter ends picking)', about: 'SCALE: about point', factor: 'SCALE: factor' },
  MIRROR: {
    pick: 'MIRROR: pick entities (Enter ends picking)', first: 'MIRROR: axis first point', second: 'MIRROR: axis second point',
    keep: 'MIRROR: keep originals? Y or N (Enter is Y)',
  },
  OFFSET: { distance: 'OFFSET: distance', entity: 'OFFSET: pick entity', side: 'OFFSET: pick side' },
  TRIM: { edges: 'TRIM: pick cutting edges (Enter for every entity)', part: 'TRIM: pick the part to remove (Enter ends)' },
  EXTEND: { boundaries: 'EXTEND: pick boundaries (Enter for every entity)', end: 'EXTEND: pick the end to extend (Enter ends)' },
  FILLET: { radius: 'FILLET: radius', first: 'FILLET: first line', second: 'FILLET: second line' },
  CHAMFER: { first: 'CHAMFER: first distance', second: 'CHAMFER: second distance', firstLine: 'CHAMFER: first line', secondLine: 'CHAMFER: second line' },
  ARRAY: {
    pick: 'ARRAY: pick entities (Enter ends picking)', kind: 'ARRAY: R for rows or P for polar', rows: 'ARRAY: rows', columns: 'ARRAY: columns',
    rowGap: 'ARRAY: row gap', columnGap: 'ARRAY: column gap', centre: 'ARRAY: centre', count: 'ARRAY: count', totalAngle: 'ARRAY: total angle',
  },
  HATCH: { seed: 'HATCH: pick a point inside' },
  DIST: { first: 'DIST: first point', second: 'DIST: second point' },
  AREA: { pick: 'AREA: pick a closed entity or a point inside' },
  ERASE: { pick: 'ERASE: pick entities (Enter ends picking)' },
  EXPLODE: { pick: 'EXPLODE: pick block inserts (Enter ends picking)' },
  BLOCK: {
    name: 'BLOCK: name', base: 'BLOCK: base point', pick: 'BLOCK: pick entities (Enter ends picking)',
    attribute: 'BLOCK: attribute TAG=default (Enter for none)',
  },
  INSERT: {
    name: 'INSERT: block name', point: 'INSERT: insertion point', scale: 'INSERT: scale (Enter is 1)',
    rotation: 'INSERT: rotation in degrees (Enter is 0)',
  },
  DIMLINEAR: { first: 'DIMLINEAR: first point', second: 'DIMLINEAR: second point', position: 'DIMLINEAR: line position' },
  DIMALIGNED: { first: 'DIMALIGNED: first point', second: 'DIMALIGNED: second point', position: 'DIMALIGNED: line position' },
  DIMANGLE: { first: 'DIMANGLE: first line', second: 'DIMANGLE: second line', position: 'DIMANGLE: arc position' },
  DIMRADIUS: { pick: 'DIMRADIUS: pick circle or arc', position: 'DIMRADIUS: text position' },
  CONSTRAIN: {
    kind: 'CONSTRAIN: kind (coincident, horizontal, vertical, parallel, perpendicular, equal, fixed, length, radius)',
    firstEntity: 'CONSTRAIN: pick first entity', secondEntity: 'CONSTRAIN: pick second entity',
    firstPoint: 'CONSTRAIN: pick first point', secondPoint: 'CONSTRAIN: pick second point', expression: 'CONSTRAIN: expression',
  },
  PARAM: { assignment: 'PARAM: name = expression' },
  XATTACH: {
    drawing: 'XATTACH: drawing name', name: 'XATTACH: xref name', point: 'XATTACH: insertion point',
    scale: 'XATTACH: scale (Enter is 1)', rotation: 'XATTACH: rotation in degrees (Enter is 0)',
  },
  XBIND: { name: 'XBIND: xref name' },
} as const;
