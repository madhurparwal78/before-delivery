/**
 * The published starting records. Every person and business is invented and
 * every date is set from the Turin date the copy starts.
 */
import type { Language } from '../../shared/language.ts';
import type { Town } from '../domain/time.ts';
import type { Currency } from '../domain/money.ts';

export interface SeedMaterial {
  code: string;
  name: string;
  family: string;
  unit: 'sqFt' | 'metre';
  prices: Record<Lowercase<Currency>, string>;
}

/**
 * The supplier's catalogue as the seed holds it. A new desk and the seed take
 * the first twelve rows; the press of `Refresh library` is the only time the
 * catalogue itself is read.
 */
export const CATALOGUE: readonly SeedMaterial[] = [
  { code: 'VM-2041', name: 'Tabacco', family: 'Aniline', unit: 'sqFt', prices: { eur: '13.70', gbp: '11.90', usd: '14.80', jpy: '1990', aed: '54.40' } },
  { code: 'VM-2042', name: 'Ruggine', family: 'Aniline', unit: 'sqFt', prices: { eur: '15.20', gbp: '13.20', usd: '16.40', jpy: '2210', aed: '60.40' } },
  { code: 'VM-2043', name: 'Inchiostro', family: 'Aniline', unit: 'sqFt', prices: { eur: '16.85', gbp: '14.60', usd: '18.20', jpy: '2450', aed: '66.90' } },
  { code: 'VM-2044', name: 'Salvia', family: 'Semi-aniline', unit: 'sqFt', prices: { eur: '6.10', gbp: '5.30', usd: '6.60', jpy: '885', aed: '24.20' } },
  { code: 'VM-2045', name: 'Avena', family: 'Semi-aniline', unit: 'sqFt', prices: { eur: '7.35', gbp: '6.40', usd: '7.95', jpy: '1070', aed: '29.20' } },
  { code: 'VM-2046', name: 'Prugna', family: 'Semi-aniline', unit: 'sqFt', prices: { eur: '8.90', gbp: '7.70', usd: '9.60', jpy: '1295', aed: '35.30' } },
  { code: 'VM-2047', name: 'Cuoio', family: 'Pull-up', unit: 'sqFt', prices: { eur: '11.25', gbp: '9.75', usd: '12.15', jpy: '1635', aed: '44.65' } },
  { code: 'VM-2048', name: 'Noce', family: 'Pull-up', unit: 'sqFt', prices: { eur: '12.40', gbp: '10.75', usd: '13.40', jpy: '1800', aed: '49.25' } },
  { code: 'VM-2049', name: 'Grafite', family: 'Pull-up', unit: 'sqFt', prices: { eur: '10.60', gbp: '9.20', usd: '11.45', jpy: '1540', aed: '42.10' } },
  { code: 'VM-3051', name: 'Loden', family: 'Wool', unit: 'metre', prices: { eur: '64.00', gbp: '55.50', usd: '69.10', jpy: '9300', aed: '254.00' } },
  { code: 'VM-3052', name: 'Feltro', family: 'Wool', unit: 'metre', prices: { eur: '58.50', gbp: '50.75', usd: '63.20', jpy: '8500', aed: '232.20' } },
  { code: 'VM-3053', name: 'Bouclé', family: 'Wool', unit: 'metre', prices: { eur: '72.25', gbp: '62.65', usd: '78.00', jpy: '10500', aed: '286.80' } },
];

/** A desk starts with the first twelve rows of the supplier's table. */
export const STARTING_MATERIALS = CATALOGUE;

export interface SeedRate {
  takesEffectOn: string;
  eur: string;
  gbp: string;
  usd: string;
  jpy: string;
  aed: string;
}

export const STARTING_RATE: SeedRate = {
  takesEffectOn: '2020-01-01',
  eur: '85.00',
  gbp: '72.00',
  usd: '92.00',
  jpy: '13800',
  aed: '340.00',
};

export interface SeedDesk {
  name: string;
  email: string;
  password: string;
}

export const DESKS: readonly SeedDesk[] = [
  { name: 'Agnese Ferrero', email: 'agnese@bottega-semenza.example', password: 'tacks-and-hide-2027' },
  { name: 'Ruben Marchetti', email: 'ruben@bottega-semenza.example', password: 'second-desk-2027' },
];

export type PieceState = 'received' | 'inSurvey' | 'onTheBench' | 'ready' | 'collected' | 'archived';

export interface SeedPiece {
  deskEmail: string;
  clientName: string;
  clientTown: Town;
  clientLanguage: Language;
  clientEmail: string;
  title: string;
  state: PieceState;
  stampNumber: string;
  maker: string;
  year: string;
  widthCm: string;
  depthCm: string;
  heightCm: string;
  weightKg: string;
  /** Days after the Turin date the copy starts. */
  dueInDays: number;
}

const AGNESE = DESKS[0]!.email;
const RUBEN = DESKS[1]!.email;

export const PIECES: readonly SeedPiece[] = [
  {
    deskEmail: AGNESE, clientName: 'Giulia Ricci', clientTown: 'Turin', clientLanguage: 'it',
    clientEmail: 'giulia@clients.example', title: 'Lounge chair', state: 'onTheBench',
    stampNumber: '48201768', maker: 'Officina Bressan', year: '1957',
    widthCm: '66', depthCm: '70', heightCm: '78', weightKg: '12.5', dueInDays: 21,
  },
  {
    deskEmail: AGNESE, clientName: 'Harriet Osei', clientTown: 'London', clientLanguage: 'en',
    clientEmail: 'harriet@clients.example', title: 'Tubular armchair', state: 'inSurvey',
    stampNumber: '60319522', maker: 'Atelier Lindqvist', year: '1931',
    widthCm: '60', depthCm: '64', heightCm: '74', weightKg: '9', dueInDays: 28,
  },
  {
    deskEmail: AGNESE, clientName: 'Dana Whitlock', clientTown: 'New York', clientLanguage: 'en',
    clientEmail: 'dana@clients.example', title: 'Cantilever side chair', state: 'inSurvey',
    stampNumber: '71540835', maker: 'Harlan & Vance', year: '1949',
    widthCm: '48', depthCm: '54', heightCm: '80', weightKg: '6.5', dueInDays: 35,
  },
  {
    deskEmail: AGNESE, clientName: '中村 葵', clientTown: 'Kyoto', clientLanguage: 'ja',
    clientEmail: 'aoi@clients.example', title: 'Folding deck chair', state: 'inSurvey',
    stampNumber: '30972186', maker: 'Kobo Tanizawa', year: '1962',
    widthCm: '58', depthCm: '90', heightCm: '84', weightKg: '7', dueInDays: 42,
  },
  {
    deskEmail: AGNESE, clientName: 'سارة المنصوري', clientTown: 'Dubai', clientLanguage: 'ar',
    clientEmail: 'sara@clients.example', title: 'Swivel desk chair', state: 'inSurvey',
    stampNumber: '52166048', maker: 'Studio Marchand', year: '1968',
    widthCm: '62', depthCm: '62', heightCm: '92', weightKg: '14', dueInDays: 49,
  },
  {
    deskEmail: AGNESE, clientName: 'Zoë Ørsted', clientTown: 'London', clientLanguage: 'en',
    clientEmail: 'zoe@clients.example', title: 'Bentwood armchair', state: 'ready',
    stampNumber: '83407197', maker: 'Werkstatt Adler', year: '1926',
    widthCm: '56', depthCm: '58', heightCm: '82', weightKg: '5.5', dueInDays: 14,
  },
  {
    deskEmail: AGNESE,
    clientName: 'MANIFATTURATESSILEEPELLETTERIADELLEVALLISUPERIORIDIBIELLAETORINO',
    clientTown: 'Turin', clientLanguage: 'it', clientEmail: 'manifattura@clients.example',
    title: 'Slat bench', state: 'inSurvey',
    stampNumber: '26750414', maker: 'Falegnameria Conti', year: '1953',
    widthCm: '120', depthCm: '44', heightCm: '42', weightKg: '18', dueInDays: 56,
  },
  {
    deskEmail: RUBEN, clientName: 'Ivo Kranjc', clientTown: 'London', clientLanguage: 'en',
    clientEmail: 'ivo@clients.example', title: 'Walnut stool', state: 'inSurvey',
    stampNumber: '91283564', maker: 'Dom Novak', year: '1960',
    widthCm: '36', depthCm: '36', heightCm: '44', weightKg: '3', dueInDays: 30,
  },
];

export interface SeedPin {
  number: number;
  kind: 'tear' | 'crack' | 'stain' | 'looseJoint' | 'woodworm';
  x: string;
  y: string;
  note: string;
  signed: boolean;
}

/** Every seeded piece carries these three pins. */
export const PINS: readonly SeedPin[] = [
  { number: 1, kind: 'tear', x: '20.0', y: '30.0', note: '**Tear** along the front seam', signed: true },
  { number: 2, kind: 'stain', x: '50.0', y: '60.0', note: '*Stain* under the left arm', signed: true },
  { number: 3, kind: 'looseJoint', x: '80.0', y: '30.0', note: 'Check again before quoting', signed: false },
];

export interface SeedHold {
  pieceTitle: string;
  code: string;
  lot: string;
  quantity: string;
  holdId: string;
  /** `tomorrow` for a live hold, `yesterday` for one that has ended. */
  endsOn: 'tomorrow' | 'yesterday';
}

export const HOLDS: readonly SeedHold[] = [
  { pieceTitle: 'Lounge chair', code: 'VM-2041', lot: 'L-2041-A', quantity: '2', holdId: 'H-6001', endsOn: 'tomorrow' },
  { pieceTitle: 'Tubular armchair', code: 'VM-2044', lot: 'L-2044-A', quantity: '1', holdId: 'H-6002', endsOn: 'yesterday' },
];

export interface SeedEstimate {
  pieceTitle: string;
  materialCode: string;
  lot: string;
  lotAverageSqFt: string;
  patternAreaSqFt: string;
  labourHours: string;
  signedOffBy?: string;
}

export const ESTIMATES: readonly SeedEstimate[] = [
  { pieceTitle: 'Lounge chair', materialCode: 'VM-2041', lot: 'L-2041-A', lotAverageSqFt: '48.25', patternAreaSqFt: '14.54', labourHours: '12.50' },
  { pieceTitle: 'Tubular armchair', materialCode: 'VM-2044', lot: 'L-2044-A', lotAverageSqFt: '30.25', patternAreaSqFt: '14.54', labourHours: '10.00' },
  { pieceTitle: 'Cantilever side chair', materialCode: 'VM-2047', lot: 'L-2000-A', lotAverageSqFt: '48.25', patternAreaSqFt: '14.54', labourHours: '8.00' },
  { pieceTitle: 'Folding deck chair', materialCode: 'VM-2041', lot: 'L-2041-B', lotAverageSqFt: '52.75', patternAreaSqFt: '14.54', labourHours: '6.00' },
  { pieceTitle: 'Swivel desk chair', materialCode: 'VM-2043', lot: 'L-2000-A', lotAverageSqFt: '48.25', patternAreaSqFt: '14.54', labourHours: '5.00' },
  { pieceTitle: 'Bentwood armchair', materialCode: 'VM-2042', lot: 'L-2000-A', lotAverageSqFt: '48.25', patternAreaSqFt: '14.54', labourHours: '9.00', signedOffBy: 'Zoë Ørsted' },
];

export interface SeedBenchJob {
  pieceTitle: string;
  bench: 'frame' | 'cover';
  /** 1 = Monday of the current Turin week. */
  weekday: number;
}

export const BENCH_JOBS: readonly SeedBenchJob[] = [
  { pieceTitle: 'Lounge chair', bench: 'frame', weekday: 1 },
  { pieceTitle: 'Tubular armchair', bench: 'cover', weekday: 3 },
];

/** Two collections on Cantilever side chair, each at 09:00 New York time. */
export const SEEDED_COLLECTIONS = [
  { courierId: 'C-8001', when: 'lastMondayBeforeChange' },
  { courierId: 'C-8002', when: 'firstMondayAfterChange' },
] as const;

export const SEEDED_LABEL_BYTES = '%PDF-1.4 portico label\n';

