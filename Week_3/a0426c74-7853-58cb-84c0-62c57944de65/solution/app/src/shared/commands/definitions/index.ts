// The command table: every command with its alias, in the order of Business rules.
import type { Definition } from '../stages.ts';
import { BLOCK, EXPLODE, INSERT, PURGE } from './blocks.ts';
import { CONSTRAIN, PARAM } from './constraints.ts';
import { CHAMFER, FILLET } from './corners.ts';
import { DIMALIGNED, DIMANGLE, DIMLINEAR, DIMRADIUS } from './dimensions.ts';
import { ARC, CIRCLE, LINE, PLINE, RECT } from './draw.ts';
import { EXTEND, TRIM } from './edges.ts';
import { AREA, DIST, HATCH } from './inquiry.ts';
import { ARRAY, COPY, ERASE, MIRROR, MOVE, OFFSET, ROTATE, SCALE } from './modify.ts';
import { FIND, LAYER, XATTACH, XBIND, ZOOMALL } from './places.ts';

const DEFINITIONS: readonly Definition[] = [
  LINE, PLINE, RECT, CIRCLE, ARC, MOVE, COPY, ROTATE, SCALE, MIRROR, OFFSET, TRIM, EXTEND, FILLET, CHAMFER, ARRAY, HATCH, DIST, AREA,
  ERASE, EXPLODE, LAYER, BLOCK, INSERT, PURGE, DIMLINEAR, DIMALIGNED, DIMANGLE, DIMRADIUS, CONSTRAIN, PARAM, XATTACH, XBIND, FIND, ZOOMALL,
];

/** A command by its name or alias, in any letter case. */
export const definitionNamed = (typed: string): Definition | undefined => {
  const word = typed.toUpperCase();
  return DEFINITIONS.find((definition) => definition.name === word || definition.alias === word);
};
