import { BLOCK_STEP_LIMIT, NEW_SHAPE_MM } from "../../shared/limits";
import type { Block, BlockName, DesignObject, ObjectShape, Vec3 } from "../../shared/types";
import { nextShapeColor } from "../render/palette";
import { DEFAULT_MOVE_MM, DEFAULT_REPEAT_COUNT } from "./program";

type ActionName = Exclude<BlockName, "repeat">;

/** One action block with its value; Repeat is never a step. */
export interface Step {
  block: ActionName;
  mm: number;
}

/** What a run has made so far: where the cursor stands and the objects built. */
export interface RunState {
  cursor: Vec3;
  objects: DesignObject[];
}

export interface Plan {
  steps: Step[];
  /** True when the program has more steps than the limit; only the first `BLOCK_STEP_LIMIT` are kept. */
  truncated: boolean;
}

const SHAPES: Partial<Record<ActionName, ObjectShape>> = { addBox: "box", addCylinder: "cylinder", addSphere: "sphere" };

export function startRun(): RunState {
  return { cursor: [0, 0, 0], objects: [] };
}

function hasAction(blocks: Block[]): boolean {
  return blocks.some((block) => (block.block === "repeat" ? hasAction(block.body ?? []) : true));
}

/** The steps a program runs, in order, with Repeat bodies unrolled and the 501st step never produced. */
export function planSteps(program: Block[]): Plan {
  const steps: Step[] = [];
  const collect = (blocks: Block[]): void => {
    for (const block of blocks) {
      if (steps.length > BLOCK_STEP_LIMIT) return;
      if (block.block !== "repeat") {
        steps.push({ block: block.block, mm: block.mm ?? DEFAULT_MOVE_MM });
        continue;
      }
      const body = block.body ?? [];
      if (!hasAction(body)) continue;
      for (let i = 0; i < (block.count ?? DEFAULT_REPEAT_COUNT) && steps.length <= BLOCK_STEP_LIMIT; i++) collect(body);
    }
  };
  collect(program);
  return { steps: steps.slice(0, BLOCK_STEP_LIMIT), truncated: steps.length > BLOCK_STEP_LIMIT };
}

/** The state after one more step. Pure: the old state is never changed. */
export function applyStep(state: RunState, step: Step): RunState {
  const [x, y, z] = state.cursor;
  const shape = SHAPES[step.block];
  if (shape) {
    const object: DesignObject = {
      id: `block-${state.objects.length + 1}`, kind: shape, mode: "solid", x, y, z,
      w: NEW_SHAPE_MM, d: NEW_SHAPE_MM, h: NEW_SHAPE_MM, rotationZ: 0, color: nextShapeColor(state.objects.length), children: [],
    };
    return { cursor: state.cursor, objects: [...state.objects, object] };
  }
  switch (step.block) {
    case "moveX": return { ...state, cursor: [x + step.mm, y, z] };
    case "moveY": return { ...state, cursor: [x, y + step.mm, z] };
    case "moveZ": return { ...state, cursor: [x, y, z + step.mm] };
    default: {
      const last = state.objects[state.objects.length - 1];
      if (!last) return state;
      return { ...state, objects: [...state.objects.slice(0, -1), { ...last, mode: "hole" }] };
    }
  }
}

/** Runs a whole program at once. */
export function runProgram(program: Block[]): { state: RunState; truncated: boolean } {
  const { steps, truncated } = planSteps(program);
  return { state: steps.reduce(applyStep, startRun()), truncated };
}
