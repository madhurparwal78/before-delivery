import type { ProgramBlock, SceneObject } from '../../shared/types.js';
import { colorForIndex } from '../../shared/palette.js';
import type { Vec3 } from '../geom/mesh.js';

export const STEP_LIMIT = 500;

export type Action = Exclude<ProgramBlock['block'], 'repeat'>;

export interface RunState {
  objects: SceneObject[];
  cursor: Vec3;
}

export interface ActionStep {
  action: Action;
  mm: number;
}

/** Repeat runs its body `count` times; Repeat itself is not a step. */
export const flattenProgram = (program: ProgramBlock[]): { steps: ActionStep[]; hitLimit: boolean } => {
  const steps: ActionStep[] = [];
  let hitLimit = false;
  const walk = (blocks: ProgramBlock[]): void => {
    for (const block of blocks) {
      if (hitLimit) return;
      if (block.block === 'repeat') {
        const count = Math.min(50, Math.max(1, block.count ?? 3));
        for (let round = 0; round < count; round += 1) {
          walk(block.body ?? []);
          if (hitLimit) return;
        }
        continue;
      }
      if (steps.length >= STEP_LIMIT) {
        hitLimit = true;
        return;
      }
      steps.push({ action: block.block, mm: block.mm ?? 10 });
    }
  };
  walk(program);
  return { steps, hitLimit };
};

export const emptyRunState = (): RunState => ({ objects: [], cursor: [0, 0, 0] });

export const applyStep = (state: RunState, step: ActionStep): RunState => {
  const objects = [...state.objects];
  const cursor: Vec3 = [...state.cursor] as Vec3;
  const addShape = (kind: 'box' | 'cylinder' | 'sphere'): void => {
    objects.push({
      id: `blk-${objects.length + 1}`,
      kind,
      mode: 'solid',
      x: cursor[0],
      y: cursor[1],
      z: cursor[2],
      w: 20,
      d: 20,
      h: 20,
      rotationZ: 0,
      color: colorForIndex(objects.length),
      children: [],
    });
  };
  switch (step.action) {
    case 'addBox':
      addShape('box');
      break;
    case 'addCylinder':
      addShape('cylinder');
      break;
    case 'addSphere':
      addShape('sphere');
      break;
    case 'moveX':
      cursor[0] += step.mm;
      break;
    case 'moveY':
      cursor[1] += step.mm;
      break;
    case 'moveZ':
      cursor[2] += step.mm;
      break;
    case 'makeHole': {
      const last = objects.length - 1;
      if (last >= 0) objects[last] = { ...objects[last], mode: 'hole' };
      break;
    }
  }
  return { objects, cursor };
};

export const BLOCK_LABELS: Record<ProgramBlock['block'], string> = {
  addBox: 'Add Box',
  addCylinder: 'Add Cylinder',
  addSphere: 'Add Sphere',
  moveX: 'Move X by',
  moveY: 'Move Y by',
  moveZ: 'Move Z by',
  makeHole: 'Make hole',
  repeat: 'Repeat',
};
