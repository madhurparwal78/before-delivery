import type { SizeTenths } from './types.js';

export interface SeedReference {
  slug: string;
  title: string;
  maker: string;
  year: number;
  size: SizeTenths;
  materials: string[];
  finish: string;
  colour_family: string;
  source_url: string | null;
  source_note: string | null;
  notes: string;
  captured_at: string;
}

export const SEED_REFERENCES: readonly SeedReference[] = [
  {
    slug: 'desk-radio',
    title: 'Desk radio',
    maker: 'Braunfeld',
    year: 1971,
    size: { width: 2360, height: 1520, depth: 980 },
    materials: ['ABS', 'aluminium'],
    finish: 'Matte textured shell, brushed fascia',
    colour_family: 'Grey',
    source_url: null,
    source_note: 'Flea market, Ghent',
    notes: 'The parting line runs under the fascia lip, so the front reads as one piece.',
    captured_at: '2025-03-14T10:20:00Z',
  },
  {
    slug: 'pocket-calculator',
    title: 'Pocket calculator',
    maker: 'Orrin Electronics',
    year: 1977,
    size: { width: 1360, height: 780, depth: 95 },
    materials: ['ABS', 'two-shot PBT keycaps'],
    finish: 'Satin',
    colour_family: 'Black',
    source_url: null,
    source_note: 'Charity shop, Leeds',
    notes: 'The keycap legends are moulded through, so forty years of use has not worn them.',
    captured_at: '2025-04-02T15:05:00Z',
  },
  {
    slug: 'enamel-kettle',
    title: 'Enamel kettle',
    maker: 'Halvorsen Emalje',
    year: 1964,
    size: { width: 2100, height: 1900, depth: 1600 },
    materials: ['Enamelled steel', 'beech'],
    finish: 'Gloss enamel',
    colour_family: 'Orange',
    source_url: null,
    source_note: 'Estate sale, Aarhus',
    notes: 'The enamel pools slightly at the foot ring and deepens the orange there.',
    captured_at: '2025-05-19T09:40:00Z',
  },
  {
    slug: 'table-fan',
    title: 'Table fan',
    maker: 'Vellum Appliance Co.',
    year: 1958,
    size: { width: 2850, height: 3400, depth: 1700 },
    materials: ['Steel', 'Bakelite'],
    finish: 'Baked enamel',
    colour_family: 'Green',
    source_url: null,
    source_note: 'Auction, Bristol',
    notes: 'The guard wire is spot-welded, not clipped, so there is no visible seam.',
    captured_at: '2025-06-07T12:00:00Z',
  },
  {
    slug: 'film-camera',
    title: 'Film camera',
    maker: 'Kestrel Optik',
    year: 1969,
    size: { width: 1380, height: 860, depth: 620 },
    materials: ['Aluminium', 'leatherette'],
    finish: 'Satin chrome',
    colour_family: 'Silver',
    source_url: null,
    source_note: 'Camera fair, Utrecht',
    notes: 'The leatherette wrap hides the body split, leaving only a chrome parting line on top.',
    captured_at: '2025-07-22T08:30:00Z',
  },
  {
    slug: 'desk-lamp',
    title: 'Desk lamp',
    maker: 'Lumen & Pike',
    year: 1982,
    size: { width: 1500, height: 4200, depth: 1500 },
    materials: ['Steel', 'polycarbonate'],
    finish: 'Powder coat, fine texture',
    colour_family: 'Red',
    source_url: null,
    source_note: 'Studio clear-out, Glasgow',
    notes: 'The fine powder texture scatters the highlight, so the red stays even on the shade.',
    captured_at: '2025-08-30T17:10:00Z',
  },
  {
    slug: 'wall-clock',
    title: 'Wall clock',
    maker: 'Hartwell Clocks',
    year: 1974,
    size: { width: 3000, height: 3000, depth: 450 },
    materials: ['Melamine', 'glass'],
    finish: 'Matte',
    colour_family: 'White',
    source_url: null,
    source_note: 'Flea market, Brussels',
    notes: 'The white is faintly warm against the glass bezel, which reads cooler.',
    captured_at: '2025-10-11T11:45:00Z',
  },
  {
    slug: 'cassette-recorder',
    title: 'Cassette recorder',
    maker: 'Sondera',
    year: 1979,
    size: { width: 2600, height: 700, depth: 1500 },
    materials: ['ABS', 'aluminium'],
    finish: 'Brushed and anodised',
    colour_family: 'Black',
    source_url: null,
    source_note: 'Market stall, Lille',
    notes: 'The brushed grain runs the long way, so the anodised strip reads darker head on.',
    captured_at: '2026-01-09T14:00:00Z',
  },
  {
    slug: 'hair-dryer',
    title: 'Hair dryer',
    maker: 'Calloway Home',
    year: 1986,
    size: { width: 2300, height: 2050, depth: 820 },
    materials: ['ABS'],
    finish: 'Gloss',
    colour_family: 'Pink',
    source_url: null,
    source_note: 'Charity shop, Leeds',
    notes: 'The gloss shows the parting line down the handle as a hairline of brighter pink.',
    captured_at: '2026-03-27T09:15:00Z',
  },
  {
    slug: 'electric-shaver',
    title: 'Electric shaver',
    maker: 'Brisk',
    year: 1991,
    size: { width: 650, height: 1480, depth: 420 },
    materials: ['ABS', 'TPE overmould'],
    finish: 'Soft-touch',
    colour_family: 'Blue',
    source_url: null,
    source_note: 'Online auction',
    notes: 'The overmould stops short of the shoulder, leaving a crisp step in the blue.',
    captured_at: '2026-06-15T19:20:00Z',
  },
  {
    slug: 'telephone-handset',
    title: 'Telephone handset',
    maker: 'Northline Telecom',
    year: 1983,
    size: { width: 2150, height: 640, depth: 700 },
    materials: ['ABS'],
    finish: 'Spark-eroded texture',
    colour_family: 'Beige',
    source_url: null,
    source_note: 'Office clearance, Manchester',
    notes: 'The spark-eroded texture hides flow marks and keeps the beige from looking plastic.',
    captured_at: '2026-09-04T10:05:00Z',
  },
  {
    slug: 'bead-blasted-kettle',
    title: 'Bead-blasted kettle',
    maker: 'Tamsin Metalworks',
    year: 2024,
    size: { width: 2250, height: 2000, depth: 1650 },
    materials: ['Aluminium', 'phenolic'],
    finish: 'Bead-blasted, clear anodised',
    colour_family: 'Silver',
    source_url: 'https://tamsin-metalworks.example/kettle',
    source_note: null,
    notes: 'The bead blast softens the body highlight and keeps the parting line almost invisible.',
    captured_at: '2026-11-03T10:00:00Z',
  },
];

export interface SeedReel {
  name: string;
  demo: boolean;
  slugs: string[];
}

export const SEED_REELS: readonly SeedReel[] = [
  {
    name: 'Demo reel',
    demo: true,
    slugs: ['desk-radio', 'pocket-calculator', 'enamel-kettle'],
  },
  {
    name: 'Halden kickoff',
    demo: false,
    slugs: [
      'enamel-kettle',
      'bead-blasted-kettle',
      'pocket-calculator',
      'desk-radio',
      'table-fan',
      'film-camera',
      'desk-lamp',
      'wall-clock',
      'cassette-recorder',
      'hair-dryer',
      'electric-shaver',
      'telephone-handset',
    ],
  },
];

export const SEED_PULL_HISTORY: ReadonlyArray<{ pull_day: string; slug: string }> = [
  { pull_day: '2026-10-31', slug: 'desk-radio' },
  { pull_day: '2026-11-01', slug: 'pocket-calculator' },
  { pull_day: '2026-11-02', slug: 'enamel-kettle' },
];

/** The three stops the landing page always plays, in seed order. */
export const DEMO_SLUGS = ['desk-radio', 'pocket-calculator', 'enamel-kettle'] as const;

export const SEED_HOME_ZONE = 'Europe/London';
export const SEED_ZONE_EFFECTIVE_FROM = '2024-01-01T00:00:00Z';

/** One line about each demo object, shown in the landing page's left column. */
export const DEMO_BLURBS: Record<string, string> = {
  'desk-radio':
    'A textured shell against a brushed fascia, the pairing most desk objects of the period settled on.',
  'pocket-calculator':
    'Two-shot keycaps on a satin body: legends that outlive the case they sit in.',
  'enamel-kettle':
    'Gloss enamel over pressed steel, with a beech handle that keeps its warmth in the hand.',
};
