import type { BlockName, Point } from '../shared/api';

export type BlockPart =
  | { kind: 'line'; start: Point; end: Point }
  | { kind: 'arc'; center: Point; radius: number; start_angle: number; end_angle: number }
  | { kind: 'polyline'; vertices: Point[]; closed: boolean }
  | { kind: 'mtext'; position: Point; height: number; contents: string };

/** The published block library, in millimetres from each block's base point. */
export const BLOCK_LIBRARY: Record<BlockName, BlockPart[]> = {
  'Door 900': [
    { kind: 'line', start: [0, 0], end: [0, 900] },
    { kind: 'arc', center: [0, 0], radius: 900, start_angle: 0, end_angle: 90 },
  ],
  'Window 1200': [
    { kind: 'line', start: [0, -50], end: [1200, -50] },
    { kind: 'line', start: [0, 0], end: [1200, 0] },
    { kind: 'line', start: [0, 50], end: [1200, 50] },
  ],
  'Chair 450': [
    {
      kind: 'polyline',
      vertices: [
        [-225, -225],
        [225, -225],
        [225, 225],
        [-225, 225],
      ],
      closed: true,
    },
  ],
  'Table 1600x800': [
    {
      kind: 'polyline',
      vertices: [
        [-800, -400],
        [800, -400],
        [800, 400],
        [-800, 400],
      ],
      closed: true,
    },
  ],
  'North arrow': [
    {
      kind: 'polyline',
      vertices: [
        [0, 0],
        [-150, -600],
        [150, -600],
      ],
      closed: true,
    },
    { kind: 'mtext', position: [0, -800], height: 200, contents: 'N' },
  ],
};

export function isBlockName(value: string): value is BlockName {
  return Object.prototype.hasOwnProperty.call(BLOCK_LIBRARY, value);
}
