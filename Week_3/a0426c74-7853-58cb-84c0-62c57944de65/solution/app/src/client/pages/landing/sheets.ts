import { around, centreMark, circle, dimH, dimV, ellipse, grid, hatch, rect } from './sheetArt.ts';

export type StrokeKind = 'plain' | 'fine' | 'dash' | 'centre';
interface Stroke { d: string; kind: StrokeKind }
export interface SheetDrawing { title: string; strokes: Stroke[]; titleBlock: 'standard' | 'only' }

const plain = (...d: string[]): Stroke => ({ d: d.join(''), kind: 'plain' });
const fine = (...d: string[]): Stroke => ({ d: d.join(''), kind: 'fine' });
const dash = (...d: string[]): Stroke => ({ d: d.join(''), kind: 'dash' });
const centre = (...d: string[]): Stroke => ({ d: d.join(''), kind: 'centre' });

const gardenPlan: SheetDrawing = {
  title: 'Garden plan, Larch Row',
  titleBlock: 'standard',
  strokes: [
    centre(rect(20, 22, 180, 88)),
    plain(rect(28, 28, 50, 34)),
    fine(rect(31, 31, 44, 28)),
    fine(rect(28, 62, 50, 10), hatch(28, 62, 50, 10, 4)),
    plain(rect(96, 30, 30, 16), rect(96, 52, 30, 16), rect(134, 30, 30, 16), rect(134, 52, 30, 16)),
    fine(hatch(96, 30, 30, 16, 5), hatch(134, 52, 30, 16, 5)),
    plain('M78 45C90 60 110 80 150 84S190 80 196 72'),
    plain('M78 50C90 65 110 85 150 89S190 85 196 77'),
    plain(circle(52, 92, 8), circle(176, 100, 7), circle(184, 44, 6)),
    fine(centreMark(52, 92), centreMark(176, 100), centreMark(184, 44)),
    plain(ellipse(116, 98, 16, 8)),
    fine(ellipse(116, 98, 10, 4.5)),
    fine(dimH(20, 200, 116)),
  ],
};

const shelfElevation: SheetDrawing = {
  title: 'Shelf elevation, Unit 4',
  titleBlock: 'standard',
  strokes: [
    plain(rect(46, 16, 72, 102), rect(50, 16, 64, 98)),
    plain('M50 42H114M50 68H114M50 92H114'),
    plain(rect(54, 24, 6, 18), rect(61, 22, 5, 20), rect(67, 25, 7, 17), rect(78, 20, 6, 22), rect(86, 26, 8, 16)),
    plain(rect(56, 52, 10, 16), rect(68, 56, 8, 12), rect(80, 50, 14, 18), rect(98, 54, 8, 14)),
    plain(rect(52, 78, 22, 14), rect(78, 74, 28, 18)),
    fine(hatch(46, 114, 72, 4, 4)),
    fine(dimV(32, 16, 118), dimH(46, 118, 126)),
    dash('M130 16V118'),
    plain(circle(176, 52, 22)),
    fine(circle(176, 52, 16), rect(166, 44, 20, 16), centreMark(176, 52, 4)),
    fine('M150 66L134 100H156'),
  ],
};

const stageLayout: SheetDrawing = {
  title: 'Stage layout, Hall B',
  titleBlock: 'standard',
  strokes: [
    plain(rect(18, 18, 184, 98)),
    plain(rect(50, 22, 120, 16), rect(58, 38, 104, 8), rect(66, 46, 88, 8)),
    fine(hatch(50, 22, 120, 16, 6)),
    centre('M110 14V120'),
    plain(grid(8, 4, 40, 70, 20, 11, (x, y) => rect(x, y, 12, 6))),
    plain('M18 116h14a14 14 0 0 0 0 -14'),
    fine(dimH(18, 126, 124)),
    plain(circle(36, 32, 6), circle(184, 32, 6)),
    fine(centreMark(36, 32), centreMark(184, 32)),
  ],
};

const titleBlockOnly: SheetDrawing = {
  title: 'Title block only',
  titleBlock: 'only',
  strokes: [],
};

const shedFooting: SheetDrawing = {
  title: 'Shed footing, Plot 9',
  titleBlock: 'standard',
  strokes: [
    plain(rect(34, 28, 120, 76), rect(40, 34, 108, 64)),
    plain(rect(28, 22, 12, 12), rect(148, 22, 12, 12), rect(28, 98, 12, 12), rect(148, 98, 12, 12)),
    fine(hatch(28, 22, 12, 12, 3), hatch(148, 22, 12, 12, 3), hatch(28, 98, 12, 12, 3), hatch(148, 98, 12, 12, 3)),
    dash('M40 66H148M94 34V98'),
    plain(circle(94, 66, 10)),
    fine(centreMark(94, 66, 4)),
    fine(dimH(34, 154, 118), dimV(176, 28, 104)),
    plain(circle(190, 30, 6)),
    fine('M190 24V36M184 30H196'),
  ],
};

const benchSection: SheetDrawing = {
  title: 'Bench section, Workshop',
  titleBlock: 'standard',
  strokes: [
    plain(rect(24, 40, 130, 10)),
    fine(hatch(24, 40, 130, 10, 4)),
    plain(rect(34, 50, 10, 56), rect(134, 50, 10, 56)),
    fine(hatch(34, 50, 10, 56, 5), hatch(134, 50, 10, 56, 5)),
    plain('M44 72H134M44 78H134'),
    plain('M20 106H168'),
    fine(hatch(20, 106, 148, 6, 4)),
    plain(rect(150, 30, 14, 20), circle(157, 36, 3)),
    dash('M24 45H154'),
    fine(dimV(14, 40, 106), dimH(24, 126, 124)),
    centre('M89 28V118'),
    plain(circle(186, 60, 14)),
    fine(circle(186, 60, 8), centreMark(186, 60, 3)),
  ],
};

const seatingPlan: SheetDrawing = {
  title: 'Seating plan, Quay Room',
  titleBlock: 'standard',
  strokes: [
    plain(rect(16, 16, 192, 90)),
    plain('M16 96h14a14 14 0 0 0 0 -14'),
    plain(rect(172, 16, 36, 12)),
    fine(hatch(172, 16, 36, 12, 5)),
    plain(grid(4, 2, 48, 42, 44, 42, (x, y) => circle(x, y, 8))),
    plain(grid(4, 2, 48, 42, 44, 42, (x, y) => around(x, y, 13, 8, (cx, cy) => circle(cx, cy, 2.4)))),
    fine(grid(4, 2, 48, 42, 44, 42, (x, y) => centreMark(x, y, 2))),
    fine(dimH(16, 208, 114)),
  ],
};

const raisedBeds: SheetDrawing = {
  title: 'Raised beds, North Yard',
  titleBlock: 'standard',
  strokes: [
    centre(rect(14, 16, 196, 98)),
    plain(grid(3, 2, 24, 24, 62, 44, (x, y) => rect(x, y, 52, 34))),
    plain(grid(3, 2, 24, 24, 62, 44, (x, y) => rect(x + 4, y + 4, 44, 26))),
    fine(grid(3, 2, 24, 24, 62, 44, (x, y) => hatch(x + 4, y + 4, 44, 26, 6))),
    plain(circle(196, 98, 6)),
    fine(centreMark(196, 98, 3)),
    fine(dimV(8, 24, 102)),
    dash('M14 66H210'),
  ],
};

const counterDetail: SheetDrawing = {
  title: 'Counter detail, Kiosk 2',
  titleBlock: 'standard',
  strokes: [
    plain(rect(20, 44, 120, 8), rect(24, 52, 112, 56)),
    plain('M60 52V108M100 52V108'),
    plain(rect(30, 62, 22, 38), rect(66, 62, 28, 38), rect(106, 62, 22, 38)),
    fine('M30 100h22M66 100h28M106 100h22', 'M41 70v8M105 70v8'),
    plain('M14 108H146'),
    fine(hatch(14, 108, 132, 4, 4)),
    plain(circle(44, 26, 7), circle(76, 26, 7), circle(108, 26, 7)),
    fine(centreMark(44, 26), centreMark(76, 26), centreMark(108, 26)),
    plain(circle(180, 56, 24)),
    fine(circle(180, 56, 17), rect(168, 48, 24, 16)),
    fine('M140 48L162 40'),
    fine(dimV(12, 44, 108), dimH(20, 126, 120)),
  ],
};

const lightingGrid: SheetDrawing = {
  title: 'Lighting grid, Hall B',
  titleBlock: 'standard',
  strokes: [
    plain(rect(16, 16, 192, 92)),
    dash(grid(1, 4, 16, 30, 0, 22, (x, y) => `M${x} ${y}h192`)),
    dash(grid(7, 1, 40, 16, 26, 0, (x, y) => `M${x} ${y}v92`)),
    plain(grid(7, 4, 40, 30, 26, 22, (x, y) => circle(x, y, 3.6))),
    fine(grid(7, 4, 40, 30, 26, 22, (x, y) => centreMark(x, y, 2.6))),
    plain(rect(88, 41, 48, 44)),
    fine(dimH(16, 208, 114)),
  ],
};

const fenceRun: SheetDrawing = {
  title: 'Fence run, Larch Row',
  titleBlock: 'standard',
  strokes: [
    centre('M14 64H210'),
    plain('M20 60H196M20 68H196'),
    plain(grid(9, 1, 20, 57, 22, 0, (x, y) => rect(x, y, 6, 14))),
    fine(grid(9, 1, 20, 57, 22, 0, (x, y) => hatch(x, y, 6, 14, 3))),
    plain('M148 60V16', 'M196 60A48 48 0 0 0 148 16'),
    plain('M14 92H210'),
    fine(hatch(14, 92, 196, 5, 4)),
    fine(dimH(23, 199, 108), dimH(23, 67, 118), dimH(67, 111, 118)),
    plain(circle(34, 34, 9)),
    fine('M34 22V46M28 38L34 22L40 38'),
  ],
};

/** The eleven invented sheets of the landing strip, in the order the brief lists them. */
export const SHEET_DRAWINGS: readonly SheetDrawing[] = [
  gardenPlan,
  shelfElevation,
  stageLayout,
  titleBlockOnly,
  shedFooting,
  benchSection,
  seatingPlan,
  raisedBeds,
  counterDetail,
  lightingGrid,
  fenceRun,
];
