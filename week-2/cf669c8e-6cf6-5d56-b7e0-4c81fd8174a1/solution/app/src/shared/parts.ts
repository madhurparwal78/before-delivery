/** The scene parts table: one table drives the meshes, parts list, still drawing, dimension lines and story. */

type Axis = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
export type RailPartId = 'traction-pack' | 'hub-motor';
type Tone = 'body' | 'struct' | 'mech' | 'kit' | 'rim';
type Vec3 = [number, number, number];
type Outline = [number, number][];

/** One mesh of a part, in the part's own axes with its origin at the part's position. */
export type Primitive =
  | { kind: 'box'; size: Vec3; at?: Vec3; tone?: Tone }
  | { kind: 'cylinder'; axis: 'x' | 'y' | 'z'; radius: number; length: number; at?: Vec3; tone?: Tone; segments?: number }
  /** A side-view outline in the part's x and z, extruded across y and centred on it, with its corners rounded. */
  | { kind: 'profile'; points: Outline; width: number; round?: number; at?: Vec3; tone?: Tone };

/** What a part's shape follows: the donor's wheelbase and swingarm, and the chosen pack and hub. */
interface SceneKit {
  wheelbaseMm: number;
  bayXMm: number;
  /** Swingarm mouth width of the donor. */
  mouthWidthMm: number;
  pack: { widthMm: number; heightMm: number; growthLengthMm: number };
  hub: { widthMm: number };
}

interface ShapeInput { kit: SceneKit; position: Vec3; shiftX: number }

/** The columns the API publishes. */
export interface PartDef {
  id: string;
  name: string;
  /** Millimetres, x forward from the rear axle, y to the left, z up. */
  position: Vec3;
  storyStage: number | null;
  axis: Axis | null;
  storyDistanceMm: number;
  fadedFor: RailPartId[];
  /** The axis the part's dimension line runs along; the value is measured from the drawn part. */
  dimensionAxis: 'x' | 'y' | 'z';
  tone: Tone;
  tiltYDeg: number;
}

interface PartRow extends PartDef {
  shape: (input: ShapeInput) => Primitive[];
}

/** A row resolved for one donor and kit: plain data, so the API can carry it. */
export interface ScenePart extends PartDef {
  primitives: Primitive[];
  /** The body that rides a rail: its length along the rail and its section across it. */
  railBody: { lengthMm: number; crossMm: [number, number] } | null;
}

const NOMINAL_WHEELBASE_MM = 1240;
/** Pack length along its rail in millimetres (scene art; never decides a verdict). */
const PACK_LENGTH_MM = 260;
const HUB_DIAMETER_MM = 250;
const SWINGARM_WALL_MM = 22;
const FORK_TILT_DEG = -12;

/** An outline given in moped coordinates, x from the rear axle and z up, made relative to the part's own position. */
const outline = ({ position }: ShapeInput, shift: number, points: Outline): Outline =>
  points.map(([x, z]) => [x + shift - position[0], z - position[2]]);

const COWL: Outline = [[650, 300], [640, 440], [600, 560], [545, 730], [-60, 770], [-130, 700], [-110, 560], [0, 440], [130, 410], [230, 340], [300, 300]];
const APRON: Outline = [[650, 300], [640, 440], [600, 560], [545, 730], [520, 730], [575, 560], [615, 440], [625, 300]];

const sidePanel = (input: ShapeInput): Primitive => ({ kind: 'profile', points: outline(input, 0, COWL), width: 28, round: 40 });

const wheel = (): Primitive[] => [
  { kind: 'cylinder', axis: 'y', radius: 190, length: 90, segments: 48 },
  { kind: 'cylinder', axis: 'y', radius: 128, length: 94, segments: 48, tone: 'rim' },
  { kind: 'cylinder', axis: 'y', radius: 36, length: 100, segments: 24, tone: 'struct' },
];

/** The front mudguard: an arc over the tyre, from just ahead of the top to behind the fork. */
function mudguard(): Outline {
  const arc = (radius: number, from: number, to: number): Outline => Array.from({ length: 13 }, (_, i) => {
    const angle = ((from + ((to - from) * i) / 12) * Math.PI) / 180;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });
  return [...arc(204, 25, 150), ...arc(226, 150, 25)];
}

function row(id: string, name: string, position: Vec3, story: [number, Axis, number] | null, fadedFor: RailPartId[], dimensionAxis: PartDef['dimensionAxis'], tone: Tone, shape: PartRow['shape'], tiltYDeg = 0): PartRow {
  const [storyStage, axis, storyDistanceMm] = story ?? [null, null, 0];
  return { id, name, position, storyStage, axis, storyDistanceMm, fadedFor, dimensionAxis, tone, tiltYDeg, shape };
}

const pack: RailPartId = 'traction-pack';
const hub: RailPartId = 'hub-motor';

export const PARTS: readonly PartRow[] = [
  row('front-panel', 'Front panel', [1120, 0, 620], [1, '+x', 220], [], 'x', 'body', (input) => [
    { kind: 'profile', points: outline(input, input.shiftX, [[1060, 480], [1080, 880], [1120, 920], [1170, 880], [1175, 720], [1130, 500]]), width: 180, round: 34 },
    { kind: 'cylinder', axis: 'x', radius: 62, length: 30, at: [1180 + input.shiftX - input.position[0], 0, 800 - input.position[2]], tone: 'rim', segments: 32 },
  ]),
  row('leg-shield', 'Leg shield', [980, 0, 560], [1, '+x', 160], [], 'x', 'body', (input) => [
    { kind: 'profile', points: outline(input, input.shiftX, [[840, 310], [905, 360], [950, 500], [985, 760], [1005, 870], [1075, 870], [1065, 700], [1035, 480], [1000, 335], [955, 290], [840, 290]]), width: 300, round: 30 },
  ]),
  row('seat', 'Seat', [420, 0, 780], [1, '+z', 240], [pack], 'x', 'struct', (input) => [
    { kind: 'profile', points: outline(input, 0, [[700, 760], [720, 800], [690, 830], [480, 830], [380, 860], [140, 890], [80, 850], [90, 770]]), width: 250, round: 28 },
    { kind: 'profile', points: outline(input, 0, [[90, 770], [80, 800], [-40, 810], [-120, 740], [-130, 700], [-60, 740]]), width: 230, round: 16, tone: 'body' },
  ]),
  row('side-panel-left', 'Left side panel', [360, 130, 520], [1, '+y', 200], [pack, hub], 'x', 'body', (input) => [
    sidePanel(input),
    { kind: 'profile', points: outline(input, 0, APRON), width: 232, at: [0, -input.position[1], 0] },
  ]),
  row('side-panel-right', 'Right side panel', [360, -130, 520], [1, '-y', 200], [pack, hub], 'y', 'body', (input) => [sidePanel(input)]),
  row('footboard', 'Footboard', [640, 0, 300], [2, '-z', 180], [pack], 'x', 'struct', ({ shiftX }) => [
    { kind: 'box', size: [520 + shiftX, 300, 34], at: [shiftX / 2, 0, 0] },
    { kind: 'box', size: [520 + shiftX, 12, 46], at: [shiftX / 2, 144, 8] },
    { kind: 'box', size: [520 + shiftX, 12, 46], at: [shiftX / 2, -144, 8] },
  ]),
  row('fuel-tank', 'Fuel tank', [380, 0, 470], [3, '+z', 260], [], 'x', 'mech', () => [
    { kind: 'box', size: [250, 170, 140] },
    { kind: 'cylinder', axis: 'z', radius: 30, length: 16, at: [30, 0, 78], tone: 'struct' },
  ]),
  row('engine-exhaust', 'Engine and exhaust', [120, 60, 280], [3, '+y', 300], [hub], 'x', 'mech', () => [
    { kind: 'box', size: [190, 150, 170], at: [0, -20, 0] },
    { kind: 'cylinder', axis: 'y', radius: 52, length: 70, at: [10, 60, 10], tone: 'struct' },
    { kind: 'cylinder', axis: 'x', radius: 18, length: 360, at: [-20, 95, -80], tone: 'struct' },
    { kind: 'cylinder', axis: 'x', radius: 42, length: 190, at: [-170, 95, -60], tone: 'struct' },
  ]),
  row('hub-motor', 'Hub motor', [0, 0, 190], [4, '+y', 180], [], 'y', 'kit', ({ kit }) => [
    { kind: 'cylinder', axis: 'y', radius: HUB_DIAMETER_MM / 2, length: kit.hub.widthMm, segments: 40 },
    { kind: 'cylinder', axis: 'y', radius: 22, length: kit.hub.widthMm + 70, tone: 'struct' },
  ]),
  row('traction-pack', 'Traction pack', [500, 0, 360], [5, '-x', 210], [], 'y', 'kit', ({ kit }) => {
    const length = PACK_LENGTH_MM + kit.pack.growthLengthMm;
    const { widthMm, heightMm } = kit.pack;
    return [
      { kind: 'box', size: [length, widthMm, heightMm] },
      { kind: 'box', size: [14, widthMm - 30, heightMm - 30], at: [length / 2 + 7, 0, 0], tone: 'struct' },
      { kind: 'box', size: [length - 60, widthMm + 6, 14], at: [0, 0, heightMm / 2 - 25], tone: 'struct' },
    ];
  }),
  row('controller', 'Controller', [640, 0, 400], [6, '+z', 140], [], 'x', 'kit', () => [
    { kind: 'box', size: [110, 110, 50], at: [-60, 0, 0] },
    { kind: 'box', size: [30, 50, 22], at: [-130, 0, 0], tone: 'struct' },
  ]),
  row('frame', 'Frame', [620, 0, 420], null, [], 'x', 'struct', ({ shiftX }) => [
    { kind: 'box', size: [840 + shiftX, 80, 40], at: [-10 + shiftX / 2, 0, -180] },
    { kind: 'box', size: [460, 80, 36], at: [-260, 0, 20] },
    { kind: 'box', size: [40, 80, 420], at: [360 + shiftX, 0, 30] },
    { kind: 'box', size: [40, 80, 90], at: [-30, 0, -110] },
  ]),
  row('front-fork', 'Front fork', [1180, 0, 420], null, [], 'y', 'mech', () => [
    { kind: 'box', size: [26, 24, 520], at: [0, 50, 0] },
    { kind: 'box', size: [26, 24, 520], at: [0, -50, 0] },
    { kind: 'box', size: [50, 150, 30], at: [0, 0, 232], tone: 'struct' },
    { kind: 'box', size: [40, 40, 300], at: [0, 0, 380], tone: 'struct' },
    { kind: 'cylinder', axis: 'y', radius: 14, length: 540, at: [0, 0, 530], tone: 'struct' },
    { kind: 'cylinder', axis: 'y', radius: 20, length: 100, at: [0, 235, 530], tone: 'mech' },
    { kind: 'cylinder', axis: 'y', radius: 20, length: 100, at: [0, -235, 530], tone: 'mech' },
  ], FORK_TILT_DEG),
  row('front-wheel', 'Front wheel', [1240, 0, 190], null, [], 'x', 'mech', () => [...wheel(), { kind: 'profile', points: mudguard(), width: 104, tone: 'body' }]),
  row('rear-wheel', 'Rear wheel', [0, 0, 190], null, [], 'x', 'mech', wheel),
  row('swingarm', 'Swingarm', [60, 0, 230], null, [], 'x', 'struct', ({ kit }) => {
    const gap = kit.mouthWidthMm;
    return [
      { kind: 'box', size: [380, SWINGARM_WALL_MM, 90], at: [100, gap / 2 + SWINGARM_WALL_MM / 2, -30] },
      { kind: 'box', size: [380, SWINGARM_WALL_MM, 90], at: [100, -(gap / 2 + SWINGARM_WALL_MM / 2), -30] },
      { kind: 'box', size: [30, gap + 2 * SWINGARM_WALL_MM, 70], at: [290, 0, -30] },
    ];
  }),
];

export const AXIS_VECTOR: Record<Axis, Vec3> = {
  '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1],
};

/** The table for one donor: the wheel and fork follow the wheelbase, the pack follows the bay. */
function resolvedPosition(row: PartRow, kit: SceneKit): Vec3 {
  const shiftX = kit.wheelbaseMm - NOMINAL_WHEELBASE_MM;
  if (row.id === 'front-wheel') return [kit.wheelbaseMm, 0, row.position[2]];
  if (row.id === 'front-fork') return [row.position[0] + shiftX, 0, row.position[2]];
  if (row.id === 'traction-pack') return [kit.bayXMm, 0, row.position[2]];
  return row.position;
}

function railBodyOf(id: string, kit: SceneKit): ScenePart['railBody'] {
  if (id === 'traction-pack') return { lengthMm: PACK_LENGTH_MM + kit.pack.growthLengthMm, crossMm: [kit.pack.widthMm, kit.pack.heightMm] };
  if (id === 'hub-motor') return { lengthMm: kit.hub.widthMm, crossMm: [HUB_DIAMETER_MM, HUB_DIAMETER_MM] };
  return null;
}

/** Every part resolved for a donor and kit: the same rows, with their meshes worked out and their positions moved. */
export function resolveSceneParts(kit: SceneKit): ScenePart[] {
  const shiftX = kit.wheelbaseMm - NOMINAL_WHEELBASE_MM;
  return PARTS.map(({ shape, ...columns }) => {
    const position = resolvedPosition({ shape, ...columns }, kit);
    return { ...columns, position, primitives: shape({ kit, position, shiftX }), railBody: railBodyOf(columns.id, kit) };
  });
}

/** The parts before any donor is known: the table's own K50 positions with the first pack and hub. */
export const DEFAULT_SCENE_KIT: SceneKit = {
  wheelbaseMm: NOMINAL_WHEELBASE_MM, bayXMm: 500, mouthWidthMm: 152,
  pack: { widthMm: 170, heightMm: 140, growthLengthMm: 0 },
  hub: { widthMm: 120 },
};

/** Story offsets for a progress 0..1, each as [dx, dy, dz] millimetres to one decimal. */
export function storyOffsets(progress: number): Record<string, Vec3> {
  const out: Record<string, Vec3> = {};
  for (const part of PARTS) {
    if (part.storyStage === null || part.axis === null) continue;
    const share = Math.min(1, Math.max(0, progress * 6 - (part.storyStage - 1)));
    const [ax, ay, az] = AXIS_VECTOR[part.axis];
    const d = part.storyDistanceMm * share;
    out[part.id] = [round1(ax * d), round1(ay * d), round1(az * d)];
  }
  return out;
}

/** Offsets those parts hold at the end of a stage (reduced-motion stills). */
export function storyOffsetsAtStageEnd(stage: number): Record<string, Vec3> {
  return storyOffsets(stage / 6);
}

function round1(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}
