import { PNG } from 'pngjs';
import { Raster, type Rgb, type Shape } from './raster.js';

/**
 * Stand-in object photographs, drawn for this product. They ship with the app: the seed
 * stores them as reference originals and the landing page plays the first three.
 */

export interface ObjectDrawing {
  slug: string;
  width: number;
  height: number;
  backdrop: [Rgb, Rgb];
  shapes: Shape[];
}

function rect(colour: Rgb, x: number, y: number, width: number, height: number): Shape {
  return { kind: 'rect', colour, x, y, width, height };
}

function rounded(
  colour: Rgb,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): Shape {
  return { kind: 'roundedRect', colour, x, y, width, height, radius };
}

function ellipse(colour: Rgb, x: number, y: number, width: number, height: number): Shape {
  return { kind: 'ellipse', colour, x, y, width, height };
}

function polygon(colour: Rgb, points: Array<[number, number]>): Shape {
  return { kind: 'polygon', colour, points };
}

function grid(
  colour: Rgb,
  left: number,
  top: number,
  cell: number,
  gap: number,
  columns: number,
  rows: number,
  radius = 0.004,
): Shape[] {
  const shapes: Shape[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      shapes.push(
        rounded(
          colour,
          left + column * (cell + gap),
          top + row * (cell + gap),
          cell,
          cell,
          radius,
        ),
      );
    }
  }
  return shapes;
}

export const OBJECT_DRAWINGS: ObjectDrawing[] = [
  {
    slug: 'desk-radio',
    width: 1600,
    height: 1200,
    backdrop: [
      [224, 221, 214],
      [188, 184, 176],
    ],
    shapes: [
      rounded([54, 52, 50], 0.12, 0.66, 0.76, 0.06, 0.01),
      rounded([132, 132, 130], 0.1, 0.24, 0.8, 0.44, 0.02),
      rounded([108, 108, 106], 0.1, 0.6, 0.8, 0.08, 0.02),
      rounded([196, 196, 192], 0.56, 0.29, 0.3, 0.34, 0.012),
      ...grid([86, 86, 84], 0.145, 0.31, 0.022, 0.014, 11, 8),
      rounded([228, 228, 224], 0.58, 0.33, 0.26, 0.11, 0.008),
      rect([70, 90, 86], 0.6, 0.37, 0.22, 0.012),
      ellipse([230, 96, 72], 0.66, 0.365, 0.012, 0.016),
      ellipse([58, 58, 56], 0.6, 0.48, 0.1, 0.13),
      ellipse([168, 168, 164], 0.615, 0.495, 0.07, 0.091),
      ellipse([58, 58, 56], 0.76, 0.5, 0.07, 0.09),
      ellipse([168, 168, 164], 0.772, 0.513, 0.046, 0.06),
    ],
  },
  {
    slug: 'pocket-calculator',
    width: 1200,
    height: 1600,
    backdrop: [
      [214, 212, 208],
      [170, 168, 166],
    ],
    shapes: [
      rounded([26, 26, 28], 0.16, 0.09, 0.68, 0.83, 0.035),
      rounded([44, 44, 46], 0.19, 0.12, 0.62, 0.77, 0.028),
      rounded([132, 146, 132], 0.23, 0.15, 0.54, 0.11, 0.012),
      rect([38, 46, 38], 0.46, 0.175, 0.28, 0.055),
      ...grid([62, 62, 64], 0.23, 0.31, 0.1, 0.045, 4, 5, 0.012),
      rounded([206, 198, 184], 0.665, 0.31, 0.1, 0.1, 0.012),
      rounded([206, 198, 184], 0.665, 0.455, 0.1, 0.1, 0.012),
      rounded([188, 78, 64], 0.665, 0.745, 0.1, 0.1, 0.012),
      rect([150, 150, 152], 0.23, 0.885, 0.2, 0.012),
    ],
  },
  {
    slug: 'enamel-kettle',
    width: 1500,
    height: 1400,
    backdrop: [
      [233, 228, 219],
      [196, 190, 182],
    ],
    shapes: [
      ellipse([40, 38, 36], 0.17, 0.83, 0.64, 0.07),
      polygon(
        [226, 108, 44],
        [
          [0.2, 0.42],
          [0.8, 0.42],
          [0.76, 0.84],
          [0.24, 0.84],
        ],
      ),
      ellipse([244, 134, 62], 0.2, 0.36, 0.6, 0.12),
      polygon(
        [226, 108, 44],
        [
          [0.76, 0.46],
          [0.95, 0.34],
          [0.97, 0.4],
          [0.78, 0.58],
        ],
      ),
      polygon(
        [206, 92, 36],
        [
          [0.22, 0.5],
          [0.1, 0.56],
          [0.1, 0.72],
          [0.23, 0.72],
          [0.23, 0.66],
          [0.16, 0.66],
          [0.16, 0.6],
          [0.23, 0.56],
        ],
      ),
      rounded([156, 118, 74], 0.33, 0.15, 0.34, 0.05, 0.02),
      rect([150, 150, 148], 0.33, 0.18, 0.03, 0.2),
      rect([150, 150, 148], 0.64, 0.18, 0.03, 0.2),
      ellipse([244, 134, 62], 0.42, 0.26, 0.16, 0.08),
      ellipse([96, 72, 48], 0.46, 0.28, 0.08, 0.04),
    ],
  },
  {
    slug: 'table-fan',
    width: 1400,
    height: 1600,
    backdrop: [
      [219, 221, 214],
      [178, 182, 176],
    ],
    shapes: [
      rounded([48, 66, 52], 0.3, 0.84, 0.4, 0.07, 0.02),
      rect([62, 86, 64], 0.46, 0.6, 0.08, 0.26),
      ellipse([62, 86, 64], 0.11, 0.08, 0.78, 0.6),
      ellipse([108, 134, 104], 0.14, 0.1, 0.72, 0.56),
      polygon(
        [84, 110, 84],
        [
          [0.5, 0.38],
          [0.78, 0.2],
          [0.74, 0.42],
        ],
      ),
      polygon(
        [84, 110, 84],
        [
          [0.5, 0.38],
          [0.3, 0.14],
          [0.26, 0.34],
        ],
      ),
      polygon(
        [84, 110, 84],
        [
          [0.5, 0.38],
          [0.36, 0.6],
          [0.62, 0.6],
        ],
      ),
      ellipse([40, 54, 42], 0.44, 0.33, 0.12, 0.1),
      ellipse([168, 176, 166], 0.465, 0.35, 0.07, 0.06),
    ],
  },
  {
    slug: 'film-camera',
    width: 1600,
    height: 1100,
    backdrop: [
      [226, 224, 220],
      [182, 180, 178],
    ],
    shapes: [
      rounded([186, 188, 190], 0.08, 0.26, 0.84, 0.5, 0.03),
      rect([44, 42, 42], 0.08, 0.4, 0.84, 0.24),
      rounded([206, 208, 210], 0.3, 0.14, 0.18, 0.14, 0.02),
      ellipse([54, 52, 52], 0.36, 0.26, 0.28, 0.48),
      ellipse([160, 162, 164], 0.385, 0.3, 0.23, 0.4),
      ellipse([30, 30, 32], 0.42, 0.355, 0.16, 0.28),
      ellipse([78, 92, 104], 0.445, 0.395, 0.11, 0.19),
      ellipse([150, 152, 156], 0.78, 0.18, 0.11, 0.16),
      rounded([210, 212, 214], 0.73, 0.2, 0.06, 0.05, 0.01),
      rect([120, 122, 124], 0.12, 0.3, 0.1, 0.06),
    ],
  },
  {
    slug: 'desk-lamp',
    width: 1200,
    height: 1600,
    backdrop: [
      [220, 216, 212],
      [176, 172, 170],
    ],
    shapes: [
      ellipse([34, 34, 36], 0.22, 0.86, 0.56, 0.06),
      rounded([188, 56, 46], 0.26, 0.8, 0.48, 0.07, 0.02),
      rect([132, 132, 134], 0.47, 0.42, 0.045, 0.4),
      polygon(
        [188, 56, 46],
        [
          [0.2, 0.42],
          [0.8, 0.42],
          [0.66, 0.12],
          [0.34, 0.12],
        ],
      ),
      polygon(
        [226, 92, 72],
        [
          [0.34, 0.12],
          [0.66, 0.12],
          [0.63, 0.19],
          [0.37, 0.19],
        ],
      ),
      ellipse([244, 232, 196], 0.24, 0.39, 0.52, 0.08),
      rounded([132, 132, 134], 0.44, 0.09, 0.12, 0.05, 0.015),
    ],
  },
  {
    slug: 'wall-clock',
    width: 1400,
    height: 1400,
    backdrop: [
      [204, 202, 200],
      [162, 160, 160],
    ],
    shapes: [
      ellipse([236, 236, 234], 0.05, 0.05, 0.9, 0.9),
      ellipse([250, 250, 248], 0.1, 0.1, 0.8, 0.8),
      ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((hour) => {
        const angle = (hour / 12) * Math.PI * 2;
        return ellipse(
          [48, 48, 50],
          0.5 + Math.sin(angle) * 0.34 - 0.012,
          0.5 - Math.cos(angle) * 0.34 - 0.012,
          0.024,
          0.024,
        );
      }),
      polygon(
        [40, 40, 42],
        [
          [0.487, 0.5],
          [0.513, 0.5],
          [0.505, 0.26],
          [0.495, 0.26],
        ],
      ),
      polygon(
        [40, 40, 42],
        [
          [0.5, 0.487],
          [0.5, 0.513],
          [0.72, 0.507],
          [0.72, 0.493],
        ],
      ),
      ellipse([188, 68, 56], 0.478, 0.478, 0.044, 0.044),
    ],
  },
  {
    slug: 'cassette-recorder',
    width: 1600,
    height: 1000,
    backdrop: [
      [208, 206, 204],
      [166, 164, 164],
    ],
    shapes: [
      rounded([36, 36, 38], 0.06, 0.2, 0.88, 0.62, 0.025),
      rounded([58, 58, 60], 0.09, 0.24, 0.82, 0.46, 0.02),
      rounded([178, 180, 182], 0.09, 0.73, 0.82, 0.05, 0.012),
      rounded([24, 24, 26], 0.33, 0.27, 0.42, 0.38, 0.015),
      ellipse([150, 150, 152], 0.38, 0.36, 0.12, 0.2),
      ellipse([40, 40, 42], 0.405, 0.4, 0.07, 0.12),
      ellipse([150, 150, 152], 0.56, 0.36, 0.12, 0.2),
      ellipse([40, 40, 42], 0.585, 0.4, 0.07, 0.12),
      ...grid([168, 170, 172], 0.11, 0.3, 0.045, 0.018, 3, 2, 0.006),
      rounded([188, 92, 74], 0.11, 0.44, 0.045, 0.045, 0.006),
      rect([120, 122, 124], 0.79, 0.3, 0.1, 0.012),
      rect([120, 122, 124], 0.79, 0.36, 0.1, 0.012),
      rect([120, 122, 124], 0.79, 0.42, 0.1, 0.012),
    ],
  },
  {
    slug: 'hair-dryer',
    width: 1500,
    height: 1300,
    backdrop: [
      [230, 224, 224],
      [188, 180, 182],
    ],
    shapes: [
      rounded([226, 142, 162], 0.12, 0.2, 0.58, 0.3, 0.07),
      ellipse([208, 118, 142], 0.09, 0.2, 0.1, 0.3),
      ellipse([240, 170, 186], 0.64, 0.21, 0.09, 0.28),
      polygon(
        [226, 142, 162],
        [
          [0.3, 0.48],
          [0.5, 0.48],
          [0.56, 0.86],
          [0.38, 0.86],
        ],
      ),
      rounded([206, 112, 136], 0.37, 0.84, 0.2, 0.06, 0.02),
      rect([250, 198, 210], 0.2, 0.26, 0.38, 0.03),
      rounded([70, 68, 70], 0.33, 0.56, 0.14, 0.05, 0.012),
      rounded([70, 68, 70], 0.345, 0.65, 0.14, 0.04, 0.012),
      rect([150, 148, 150], 0.56, 0.88, 0.04, 0.12),
    ],
  },
  {
    slug: 'electric-shaver',
    width: 1100,
    height: 1600,
    backdrop: [
      [214, 218, 222],
      [170, 176, 182],
    ],
    shapes: [
      rounded([48, 86, 142], 0.26, 0.2, 0.48, 0.72, 0.09),
      rounded([70, 116, 180], 0.3, 0.24, 0.4, 0.3, 0.06),
      rounded([30, 30, 34], 0.24, 0.09, 0.52, 0.13, 0.05),
      ellipse([168, 174, 180], 0.28, 0.07, 0.19, 0.09),
      ellipse([168, 174, 180], 0.53, 0.07, 0.19, 0.09),
      ellipse([96, 100, 106], 0.315, 0.085, 0.12, 0.055),
      ellipse([96, 100, 106], 0.565, 0.085, 0.12, 0.055),
      rounded([226, 230, 234], 0.44, 0.6, 0.12, 0.09, 0.02),
      rect([30, 30, 34], 0.36, 0.78, 0.28, 0.015),
    ],
  },
  {
    slug: 'telephone-handset',
    width: 1600,
    height: 1100,
    backdrop: [
      [218, 214, 206],
      [176, 172, 166],
    ],
    shapes: [
      polygon(
        [216, 202, 174],
        [
          [0.08, 0.3],
          [0.3, 0.3],
          [0.38, 0.52],
          [0.62, 0.52],
          [0.7, 0.3],
          [0.92, 0.3],
          [0.92, 0.68],
          [0.7, 0.68],
          [0.64, 0.62],
          [0.36, 0.62],
          [0.3, 0.68],
          [0.08, 0.68],
        ],
      ),
      ellipse([196, 182, 154], 0.1, 0.33, 0.18, 0.32),
      ellipse([196, 182, 154], 0.72, 0.33, 0.18, 0.32),
      ...grid([128, 118, 98], 0.135, 0.4, 0.022, 0.016, 4, 4, 0.008),
      ...grid([128, 118, 98], 0.755, 0.4, 0.022, 0.016, 4, 4, 0.008),
      rect([198, 186, 160], 0.38, 0.53, 0.24, 0.08),
      rect([150, 142, 124], 0.4, 0.56, 0.2, 0.012),
    ],
  },
  {
    slug: 'bead-blasted-kettle',
    width: 1400,
    height: 1500,
    backdrop: [
      [226, 228, 230],
      [182, 186, 190],
    ],
    shapes: [
      ellipse([44, 46, 48], 0.18, 0.84, 0.64, 0.06),
      polygon(
        [178, 182, 186],
        [
          [0.24, 0.38],
          [0.76, 0.38],
          [0.72, 0.85],
          [0.28, 0.85],
        ],
      ),
      polygon(
        [206, 210, 214],
        [
          [0.3, 0.4],
          [0.42, 0.4],
          [0.39, 0.84],
          [0.32, 0.84],
        ],
      ),
      ellipse([200, 204, 208], 0.24, 0.32, 0.52, 0.1),
      ellipse([158, 162, 166], 0.3, 0.335, 0.4, 0.06),
      polygon(
        [178, 182, 186],
        [
          [0.74, 0.42],
          [0.93, 0.52],
          [0.93, 0.6],
          [0.74, 0.52],
        ],
      ),
      rounded([42, 40, 42], 0.1, 0.42, 0.06, 0.3, 0.025),
      polygon(
        [42, 40, 42],
        [
          [0.14, 0.42],
          [0.26, 0.4],
          [0.26, 0.46],
          [0.14, 0.47],
        ],
      ),
      polygon(
        [42, 40, 42],
        [
          [0.14, 0.68],
          [0.28, 0.7],
          [0.28, 0.76],
          [0.14, 0.73],
        ],
      ),
      rounded([42, 40, 42], 0.44, 0.24, 0.12, 0.06, 0.025),
    ],
  },
];

export function renderObjectPng(drawing: ObjectDrawing): Buffer {
  const raster = new Raster(drawing.width, drawing.height);
  raster.verticalWash(drawing.backdrop[0], drawing.backdrop[1]);
  for (const shape of drawing.shapes) raster.draw(shape);
  const { width, height, data } = raster.toRgba();
  const png = new PNG({ width, height });
  data.copy(png.data);
  return PNG.sync.write(png, { colorType: 6, deflateLevel: 9 });
}
