export type ModelId = 'megh-349' | 'desh-648';
export type FinishId = 'monsoon-slate' | 'kesar' | 'raat-black';
export type HubId = 'pune' | 'bengaluru' | 'gurugram' | 'kochi';
export type ChapterId = 'frame' | 'engine' | 'tank' | 'wheels' | 'exhaust' | 'seat' | 'cluster';

export interface ModelDef {
  readonly id: ModelId;
  readonly name: string;
  readonly cc: number;
  readonly gstPercent: number;
  readonly insurancePaise: number;
  readonly wheelbaseMm: number;
  readonly cylinders: number;
  readonly silencers: number;
}

export interface FinishDef {
  readonly id: FinishId;
  readonly name: string;
  readonly paint: readonly [number, number, number];
}

export interface RoadTaxStep {
  readonly from: string;
  readonly percent: number;
}

export interface HubDef {
  readonly id: HubId;
  readonly name: string;
  readonly roadTaxSteps: readonly RoadTaxStep[];
}

export interface PartDef {
  readonly id: string;
  readonly name: string;
  readonly note: string;
}

export interface ChapterDef {
  readonly id: ChapterId;
  readonly name: string;
  readonly statement: string;
  readonly from: number;
  readonly jump: number;
  readonly seatAt: number;
  readonly startsAt: number;
  readonly parts: readonly PartDef[];
}

export const MODELS: readonly ModelDef[] = [
  {
    id: 'megh-349',
    name: 'Megh 349',
    cc: 349,
    gstPercent: 18,
    insurancePaise: 980000,
    wheelbaseMm: 1440,
    cylinders: 1,
    silencers: 1,
  },
  {
    id: 'desh-648',
    name: 'Desh 648',
    cc: 648,
    gstPercent: 40,
    insurancePaise: 1460000,
    wheelbaseMm: 1465,
    cylinders: 2,
    silencers: 2,
  },
];

export const FINISHES: readonly FinishDef[] = [
  { id: 'monsoon-slate', name: 'Monsoon Slate', paint: [47, 63, 92] },
  { id: 'kesar', name: 'Kesar', paint: [232, 163, 23] },
  { id: 'raat-black', name: 'Raat Black', paint: [13, 13, 15] },
];

export const HUBS: readonly HubDef[] = [
  { id: 'pune', name: 'Pune', roadTaxSteps: [{ from: '2026-10-01', percent: 11 }] },
  { id: 'bengaluru', name: 'Bengaluru', roadTaxSteps: [{ from: '2026-10-01', percent: 18 }] },
  { id: 'gurugram', name: 'Gurugram', roadTaxSteps: [{ from: '2026-10-01', percent: 8 }] },
  {
    id: 'kochi',
    name: 'Kochi',
    roadTaxSteps: [
      { from: '2026-10-01', percent: 12 },
      { from: '2026-11-02', percent: 12.5 },
    ],
  },
];

export interface PriceStep {
  readonly from: string;
  readonly exFactoryPaise: number;
}

export const PRICE_STEPS: Readonly<Record<ModelId, readonly PriceStep[]>> = {
  'megh-349': [
    { from: '2026-10-01', exFactoryPaise: 19000000 },
    { from: '2026-11-01', exFactoryPaise: 19500000 },
  ],
  'desh-648': [
    { from: '2026-10-01', exFactoryPaise: 26000000 },
    { from: '2026-11-01', exFactoryPaise: 26500000 },
  ],
};

export const CHAPTERS: readonly ChapterDef[] = [
  {
    id: 'frame',
    name: 'Frame',
    statement: 'It starts as a frame.',
    from: 0,
    jump: 0.07,
    seatAt: 0.14,
    startsAt: 0,
    parts: [
      { id: 'steering-head', name: 'Steering head', note: 'Where the forks are clamped and the ride is aimed.' },
      { id: 'swingarm', name: 'Swingarm', note: 'It carries the rear wheel over a broken road.' },
      { id: 'side-stand', name: 'Side stand', note: 'The machine rests on it, leaning to the left.' },
    ],
  },
  {
    id: 'engine',
    name: 'Engine',
    statement: 'Then the heart goes in.',
    from: 0.14,
    jump: 0.21,
    seatAt: 0.28,
    startsAt: 0.14,
    parts: [
      { id: 'cylinder', name: 'Cylinder', note: 'Air cooled, with fins cut for the long highway.' },
      { id: 'primary-cover', name: 'Primary cover', note: 'It closes the drive off from the dust.' },
    ],
  },
  {
    id: 'tank',
    name: 'Tank',
    statement: 'The tank takes your colour.',
    from: 0.28,
    jump: 0.35,
    seatAt: 0.42,
    startsAt: 0.28,
    parts: [
      { id: 'filler-cap', name: 'Filler cap', note: 'A hinged cap, opened with one gloved hand.' },
      { id: 'knee-recess', name: 'Knee recess', note: 'Pressed in so your knees sit where they should.' },
    ],
  },
  {
    id: 'wheels',
    name: 'Wheels',
    statement: 'Nineteen in front, seventeen behind.',
    from: 0.42,
    jump: 0.49,
    seatAt: 0.56,
    startsAt: 0.42,
    parts: [
      { id: 'front-rim', name: 'Front rim', note: 'Nineteen inches of spoked rim ahead of you.' },
      { id: 'rear-rim', name: 'Rear rim', note: 'Seventeen inches, carrying the drive.' },
      { id: 'chain', name: 'Chain', note: 'It runs on the rider\u2019s left, under the guard.' },
    ],
  },
  {
    id: 'exhaust',
    name: 'Exhaust',
    statement: 'The pipe runs on the right.',
    from: 0.56,
    jump: 0.63,
    seatAt: 0.7,
    startsAt: 0.56,
    parts: [
      { id: 'header', name: 'Header', note: 'It leaves the head and turns down the right side.' },
      { id: 'silencer', name: 'Silencer', note: 'Tuned for the beat the brand is known for.' },
    ],
  },
  {
    id: 'seat',
    name: 'Seat',
    statement: 'A seat for your road.',
    from: 0.7,
    jump: 0.77,
    seatAt: 0.84,
    startsAt: 0.7,
    parts: [
      { id: 'rider-seat', name: 'Rider seat', note: 'Shaped for hours, not for minutes.' },
      { id: 'pillion-seat', name: 'Pillion seat', note: 'Bolted on, for the person behind you.' },
    ],
  },
  {
    id: 'cluster',
    name: 'Cluster',
    statement: 'Now it reads the truth.',
    from: 0.84,
    jump: 0.92,
    seatAt: 0.86,
    startsAt: 0.78,
    parts: [
      { id: 'needle', name: 'Needle', note: 'It settles on the hours your price is held.' },
      { id: 'tell-tale', name: 'Tell-tale', note: 'It lights when the hub system cannot be read.' },
      { id: 'display', name: 'Display', note: 'Units left, and the next free ride.' },
    ],
  },
];

export const DEFAULT_MODEL: ModelId = 'megh-349';
export const DEFAULT_HUB: HubId = 'pune';
export const DEFAULT_FINISH: FinishId = 'monsoon-slate';

export const SLOT_MINUTES_FROM_MIDNIGHT: readonly number[] = (() => {
  const starts: number[] = [];
  for (let m = 10 * 60; m <= 18 * 60 + 15; m += 45) starts.push(m);
  return starts;
})();

export const RIDE_WINDOW_DAYS = 14;
export const RIDE_CUT_OFF_MINUTES = 120;
export const DELIVERY_WINDOW_FROM_DAYS = 3;
export const DELIVERY_WINDOW_TO_DAYS = 30;
export const DELIVERY_CLOSE_HOUR_IST = 16;
export const DELIVERY_CAPACITY_NORMAL = 4;
export const DHANTERAS_DATE = '2026-11-06';
export const DELIVERY_CAPACITY_DHANTERAS = 12;
export const LOCK_EXPIRY_HOUR_IST = 18;
export const LOCK_EXPIRY_DAYS = 2;
export const SESSION_HOURS = 12;
export const NEEDLE_MAX_HOURS = 96;

/** Closed days are decided only on the server; this is the brand's invented calendar. */
export const CLOSED_DATES: Readonly<Record<string, readonly HubId[] | 'all'>> = {
  '2026-11-08': 'all',
  '2026-11-01': ['bengaluru', 'kochi'],
  '2026-11-09': ['gurugram'],
};

export const COLOURS = {
  ground: [24, 25, 27] as const,
  surface: [34, 36, 39] as const,
  ink: [239, 240, 241] as const,
  muted: [156, 158, 163] as const,
  accent: [255, 74, 31] as const,
};

export const STEP_DURATIONS = {
  lamp: 180,
  'label-mask': 320,
  paint: 320,
  'needle-sweep': 420,
  'part-lift': 480,
  'needle-settle': 560,
  'camera-to-part': 640,
  dissolve: 120,
} as const;

export type StepName = keyof typeof STEP_DURATIONS;

export const KEY_ON_PROGRESS = 0.86;
export const STAGE_VIEWPORTS = 7;
export const SCROLL_DAMP_PER_FRAME = 0.12;
export const STATEMENT_PARALLAX = 0.35;

export function model(id: ModelId): ModelDef {
  const found = MODELS.find((m) => m.id === id);
  if (!found) throw new Error(`unknown model ${id}`);
  return found;
}

export function finish(id: FinishId): FinishDef {
  const found = FINISHES.find((f) => f.id === id);
  if (!found) throw new Error(`unknown finish ${id}`);
  return found;
}

export function hub(id: HubId): HubDef {
  const found = HUBS.find((h) => h.id === id);
  if (!found) throw new Error(`unknown hub ${id}`);
  return found;
}

export function chapter(id: ChapterId): ChapterDef {
  const found = CHAPTERS.find((c) => c.id === id);
  if (!found) throw new Error(`unknown chapter ${id}`);
  return found;
}

export function isModelId(value: unknown): value is ModelId {
  return typeof value === 'string' && MODELS.some((m) => m.id === value);
}

export function isFinishId(value: unknown): value is FinishId {
  return typeof value === 'string' && FINISHES.some((f) => f.id === value);
}

export function isHubId(value: unknown): value is HubId {
  return typeof value === 'string' && HUBS.some((h) => h.id === value);
}

export function isChapterId(value: unknown): value is ChapterId {
  return typeof value === 'string' && CHAPTERS.some((c) => c.id === value);
}

export function chapterForProgress(progress: number): ChapterDef {
  let current = CHAPTERS[0] as ChapterDef;
  for (const c of CHAPTERS) if (progress >= c.from) current = c;
  return current;
}

export function partsOf(chapterId: ChapterId): readonly PartDef[] {
  return chapter(chapterId).parts;
}

export function hexOfRgb(rgb: readonly [number, number, number] | readonly number[]): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}
