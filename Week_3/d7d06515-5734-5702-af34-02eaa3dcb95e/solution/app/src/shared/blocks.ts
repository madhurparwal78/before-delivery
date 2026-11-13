// Block library (brief: Seed data > Block library): millimetres from each block's base point.
import type { BlockName, Point } from './types.ts';

type BlockPart =
  | { kind: 'line'; a: Point; b: Point }
  | { kind: 'polyline'; points: Point[]; closed: boolean }
  | { kind: 'arc'; center: Point; radius: number; start_angle: number; end_angle: number }
  | { kind: 'text'; at: Point; height: number; text: string };

interface BlockDefinition {
  name: BlockName;
  base_point: string;
  parts: BlockPart[];
}

export const BLOCK_LIBRARY: Record<BlockName, BlockDefinition> = {
  'Door 900': {
    name: 'Door 900',
    base_point: 'Hinge',
    parts: [
      { kind: 'line', a: [0, 0], b: [0, 900] },
      { kind: 'arc', center: [0, 0], radius: 900, start_angle: 0, end_angle: 90 },
    ],
  },
  'Window 1200': {
    name: 'Window 1200',
    base_point: 'Left end, centre of the wall',
    parts: [
      { kind: 'line', a: [0, -50], b: [1200, -50] },
      { kind: 'line', a: [0, 0], b: [1200, 0] },
      { kind: 'line', a: [0, 50], b: [1200, 50] },
    ],
  },
  'Chair 450': {
    name: 'Chair 450',
    base_point: 'Seat centre',
    parts: [{ kind: 'polyline', points: [[-225, -225], [225, -225], [225, 225], [-225, 225]], closed: true }],
  },
  'Table 1600x800': {
    name: 'Table 1600x800',
    base_point: 'Table centre',
    parts: [{ kind: 'polyline', points: [[-800, -400], [800, -400], [800, 400], [-800, 400]], closed: true }],
  },
  'North arrow': {
    name: 'North arrow',
    base_point: 'Arrow tip',
    parts: [
      { kind: 'polyline', points: [[0, 0], [-150, -600], [150, -600]], closed: true },
      { kind: 'text', at: [0, -800], height: 200, text: 'N' },
    ],
  },
};
