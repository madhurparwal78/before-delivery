// Starting drawings: blank, the seeded studio plan and the wall detail sample.
import type { ColorName, Layer, Layout, LinetypeName, PlotStyle, StoredObject, Units } from '../../shared/types.ts';
import type { DrawingModel } from './types.ts';

export const PLOT_STYLES: readonly PlotStyle[] = ['Monochrome', 'Color', 'Grayscale'];

/** Viewport scale a paper layout starts with. */
export const DEFAULT_VIEWPORT_SCALE = '1:50';

export function newLayer(name: string, color: ColorName = 'White', linetype: LinetypeName = 'Continuous'): Layer {
  return { name, color, linetype, lineweight: '0.25 mm', on: true, frozen: false, locked: false, current: false };
}

const defaultLayouts = (): Layout[] => [
  { name: 'Model' },
  { name: 'Layout1', viewport_scale: DEFAULT_VIEWPORT_SCALE },
  { name: 'Layout2', viewport_scale: DEFAULT_VIEWPORT_SCALE },
];

export function blankModel(units: Units): DrawingModel {
  return {
    units, plot_style: 'Monochrome', layers: [{ ...newLayer('0'), current: true }], objects: [], layouts: defaultLayouts(),
    next_handle: 0x10,
  };
}

const look = { color: 'ByLayer', linetype: 'ByLayer', linetype_scale: 1, lineweight: 'ByLayer' } as const;
const styles = { dimension_style: 'Standard', text_style: 'Standard', multileader_style: 'Standard' } as const;

function line(handle: string, layer: string, start: [number, number], end: [number, number]): StoredObject {
  return { handle, layer, ...look, ...styles, type: 'line', start, end };
}

function studioLayers(): Layer[] {
  return [
    { ...newLayer('0'), current: true },
    newLayer('A-WALL', 'Yellow'),
    newLayer('A-DOOR', 'Cyan'),
    newLayer('A-ANNO', 'Green'),
    { ...newLayer('S-GRID', 'Red', 'Center'), locked: true },
    { ...newLayer('A-FURN', 'Magenta', 'Dashed'), frozen: true },
  ];
}

/** The seeded studio plan (brief: Seed data). */
export function studioPlanModel(units: Units): DrawingModel {
  return {
    units, plot_style: 'Monochrome', layers: studioLayers(), layouts: defaultLayouts(), next_handle: 0x3B,
    objects: [
      line('1A', 'A-WALL', [0, 0], [6000, 0]),
      line('1B', 'A-WALL', [6000, 0], [6000, 4200]),
      line('1C', 'A-WALL', [6000, 4200], [0, 4200]),
      line('1D', 'A-WALL', [0, 4200], [0, 0]),
      line('3A', 'A-WALL', [0, 2400], [2400, 2400]),
      line('2A', 'S-GRID', [3000, -600], [3000, 4800]),
      { handle: '2B', layer: 'A-FURN', ...look, ...styles, type: 'circle', center: [4500, 2100], radius: 450 },
    ],
  };
}

/** `Wall Detail Sample.dxf` content. */
export function wallDetailModel(): DrawingModel {
  return {
    units: 'mm', plot_style: 'Monochrome',
    layers: [{ ...newLayer('0'), current: true }, newLayer('A-WALL', 'Yellow'), newLayer('A-ANNO', 'Green')],
    layouts: defaultLayouts(), next_handle: 0x12,
    objects: [
      {
        handle: '10', layer: 'A-WALL', ...look, ...styles, type: 'polyline',
        vertices: [[0, 0], [1200, 0], [1200, 300], [0, 300]], closed: true,
      },
      {
        handle: '11', layer: 'A-ANNO', ...look, ...styles, type: 'mtext',
        position: [0, 500], width: 1200, height: 100, contents: 'WALL TYPE W1',
      },
    ],
  };
}
