import { REPEAT_MAX, REPEAT_MIN, MOVE_MAX_MM, MOVE_MIN_MM } from "../../shared/limits";
import type { Block, BlockName } from "../../shared/types";

export const DEFAULT_REPEAT_COUNT = 3;
export const DEFAULT_MOVE_MM = 10;

/** Indices from the program root down to one block: [2, 0] is the first block in the body of the third block. */
export type BlockPath = number[];

/** A gap between blocks: `list` is the path of the Repeat that owns it (empty for the program itself). */
export interface InsertionPoint {
  list: BlockPath;
  index: number;
}

type MoveAxis = "moveX" | "moveY" | "moveZ";

export function isMove(name: BlockName): name is MoveAxis {
  return name === "moveX" || name === "moveY" || name === "moveZ";
}

/** A new palette block with its default value. */
export function newBlock(name: BlockName): Block {
  if (name === "repeat") return { block: name, count: DEFAULT_REPEAT_COUNT, body: [] };
  if (isMove(name)) return { block: name, mm: DEFAULT_MOVE_MM };
  return { block: name };
}

/** The count a Repeat field accepts: a whole number from 1 to 50. Null when the text is not one. */
export function parseCount(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text);
  return value >= REPEAT_MIN && value <= REPEAT_MAX ? value : null;
}

/** The distance a Move field accepts: a number from -500 to 500. Null when the text is not one. */
export function parseMove(text: string): number | null {
  if (!/^-?\d+(\.\d+)?$/.test(text.trim())) return null;
  const value = Number(text);
  return value >= MOVE_MIN_MM && value <= MOVE_MAX_MM ? value : null;
}

/** The blocks of the list owned by the Repeat at `list`; the program itself for an empty path. */
function listAt(program: Block[], list: BlockPath): Block[] {
  let current = program;
  for (const index of list) current = current[index]?.body ?? [];
  return current;
}

/**
 * The block that should hold focus once the block at `removed` is gone: its next sibling (which then sits at the same
 * path), else its previous one, else the Repeat that held it. Null when the program is left empty.
 */
export function focusAfterRemoval(program: Block[], removed: BlockPath): BlockPath | null {
  const index = removed[removed.length - 1] ?? 0;
  const parent = removed.slice(0, -1);
  if (index + 1 < listAt(program, parent).length) return removed;
  if (index > 0) return [...parent, index - 1];
  return parent.length > 0 ? parent : null;
}

/** A copy of `blocks` with the list at `list` replaced by `change(its blocks)`. */
function editList(blocks: Block[], list: BlockPath, change: (items: Block[]) => Block[]): Block[] {
  const [head, ...rest] = list;
  if (head === undefined) return change(blocks);
  return blocks.map((block, i) => (i === head ? { ...block, body: editList(block.body ?? [], rest, change) } : block));
}

export function insertBlock(program: Block[], point: InsertionPoint, block: Block): Block[] {
  return editList(program, point.list, (items) => [...items.slice(0, point.index), block, ...items.slice(point.index)]);
}

export function removeBlock(program: Block[], path: BlockPath): Block[] {
  const index = path[path.length - 1] ?? -1;
  return editList(program, path.slice(0, -1), (items) => items.filter((_, i) => i !== index));
}

export function updateBlock(program: Block[], path: BlockPath, patch: Partial<Block>): Block[] {
  const index = path[path.length - 1] ?? -1;
  return editList(program, path.slice(0, -1), (items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
}

/** The point to keep after the block at `removed` is deleted, so it stays between the same two blocks. */
export function pointAfterRemoval(point: InsertionPoint, removed: BlockPath): InsertionPoint {
  const index = removed[removed.length - 1] ?? 0;
  const parent = removed.slice(0, -1);
  const inParent = point.list.length >= parent.length && parent.every((value, i) => point.list[i] === value);
  if (!inParent) return point;
  if (point.list.length === parent.length) return point.index > index ? { ...point, index: point.index - 1 } : point;
  const at = point.list[parent.length] ?? 0;
  if (at === index) return { list: parent, index };
  if (at > index) {
    const list = [...point.list];
    list[parent.length] = at - 1;
    return { ...point, list };
  }
  return point;
}

/** The point at the end of the program. */
export function endOfProgram(program: Block[]): InsertionPoint {
  return { list: [], index: program.length };
}

/** Whether the point still names a real gap, which it stops doing when the program is replaced. */
export function pointIsValid(program: Block[], point: InsertionPoint): boolean {
  let items = program;
  for (const index of point.list) {
    const block = items[index];
    if (block?.block !== "repeat") return false;
    items = block.body ?? [];
  }
  return point.index >= 0 && point.index <= items.length;
}
