// All invented seed data in one place: donors, frame revisions, packs, hubs,
// fixed lines, inspection fees, holidays, users, bikes, scene parts.
// Lengths are stored as integer tenths of a millimetre, masses as kilograms.

export interface DonorModel {
  id: string;
  name: string;
  powerKwTenths: number; // kW in tenths
  wheelbaseMm: number; // tenths
  chassisMassKg: number; // tenths
  chassisXmm: number;
  engineMassKg: number;
  engineXmm: number;
  fuelTankMassKg: number;
  fuelTankXmm: number;
  bayXmm: number;
}

export const DONORS: DonorModel[] = [
  { id: 'K50', name: 'Kade K50', powerKwTenths: 30, wheelbaseMm: 12400, chassisMassKg: 640, chassisXmm: 7200, engineMassKg: 200, engineXmm: 1200, fuelTankMassKg: 60, fuelTankXmm: 3800, bayXmm: 5000 },
  { id: 'P50', name: 'Polder P50', powerKwTenths: 24, wheelbaseMm: 12100, chassisMassKg: 580, chassisXmm: 7000, engineMassKg: 200, engineXmm: 1100, fuelTankMassKg: 60, fuelTankXmm: 3800, bayXmm: 5200 },
  { id: 'R50', name: 'Rijn R50', powerKwTenths: 20, wheelbaseMm: 11800, chassisMassKg: 520, chassisXmm: 7000, engineMassKg: 220, engineXmm: 1100, fuelTankMassKg: 60, fuelTankXmm: 3600, bayXmm: 5400 },
  { id: 'D50', name: 'Dijk D50', powerKwTenths: 35, wheelbaseMm: 10000, chassisMassKg: 500, chassisXmm: 6000, engineMassKg: 300, engineXmm: 1000, fuelTankMassKg: 50, fuelTankXmm: 2000, bayXmm: 5275 },
];

export interface PackStation {
  id: string;
  name: string;
  travelMm: number;
  widthMm: number;
  heightMm: number;
}

export interface HubStation {
  id: string;
  name: string;
  travelMm: number;
}

// Pack rail stations per model/revision: travel, then opening width x height.
export const PACK_STATIONS: { model: string; revision: 'A' | 'B'; stations: PackStation[] }[] = [
  {
    model: 'K50', revision: 'A',
    stations: [
      { id: 'S1', name: 'Bay mouth', travelMm: 600, widthMm: 1950, heightMm: 1720 },
      { id: 'S2', name: 'Footboard rib', travelMm: 1300, widthMm: 1930, heightMm: 1680 },
      { id: 'S3', name: 'Seat post', travelMm: 2100, widthMm: 2000, heightMm: 1750 },
    ],
  },
  {
    model: 'K50', revision: 'B',
    stations: [
      { id: 'S1', name: 'Bay mouth', travelMm: 600, widthMm: 1950, heightMm: 1720 },
      { id: 'S2', name: 'Footboard rib', travelMm: 1300, widthMm: 1930, heightMm: 1650 },
      { id: 'S3', name: 'Seat post', travelMm: 2100, widthMm: 2000, heightMm: 1750 },
    ],
  },
  {
    model: 'P50', revision: 'A',
    stations: [
      { id: 'S1', name: 'Bay mouth', travelMm: 600, widthMm: 1900, heightMm: 1650 },
      { id: 'S2', name: 'Centre stand brace', travelMm: 1200, widthMm: 1870, heightMm: 1700 },
      { id: 'S3', name: 'Seat post', travelMm: 2000, widthMm: 1950, heightMm: 1720 },
    ],
  },
  {
    model: 'R50', revision: 'A',
    stations: [
      { id: 'S1', name: 'Bay mouth', travelMm: 500, widthMm: 2000, heightMm: 1750 },
      { id: 'S2', name: 'Footboard rib', travelMm: 1250, widthMm: 1929, heightMm: 1750 },
      { id: 'S3', name: 'Battery tray lip', travelMm: 1950, widthMm: 1980, heightMm: 1760 },
    ],
  },
  {
    model: 'D50', revision: 'A',
    stations: [
      { id: 'S1', name: 'Bay mouth', travelMm: 600, widthMm: 2000, heightMm: 1800 },
      { id: 'S2', name: 'Footboard rib', travelMm: 1300, widthMm: 1980, heightMm: 1760 },
      { id: 'S3', name: 'Seat post', travelMm: 2150, widthMm: 2040, heightMm: 1800 },
    ],
  },
];

export interface HubGeometry {
  mouthWidthMm: number;
  armWidthMm: number;
  sprocketLineMm: number;
}

export const HUB_GEOMETRY: Record<string, HubGeometry> = {
  K50: { mouthWidthMm: 1520, armWidthMm: 1490, sprocketLineMm: 1150 },
  P50: { mouthWidthMm: 1400, armWidthMm: 1370, sprocketLineMm: 1080 },
  R50: { mouthWidthMm: 1500, armWidthMm: 1400, sprocketLineMm: 1069 },
  D50: { mouthWidthMm: 1550, armWidthMm: 1520, sprocketLineMm: 1180 },
};

export const HUB_STATIONS: HubStation[] = [
  { id: 'H1', name: 'Swingarm mouth', travelMm: 200 },
  { id: 'H2', name: 'Swingarm arm', travelMm: 450 },
  { id: 'H3', name: 'Sprocket line', travelMm: 700 },
];

export interface Pack {
  id: string;
  widthMm: number;
  heightMm: number;
  wh: number;
  massKg: number;
  growth: { dimension: 'length' | 'width' | 'height'; mm: number } | null;
  grossCents: number;
}

export const PACKS: Pack[] = [
  { id: 'P-1100', widthMm: 1500, heightMm: 1200, wh: 1100, massKg: 80, growth: null, grossCents: 48900 },
  { id: 'P-1500', widthMm: 1700, heightMm: 1400, wh: 1500, massKg: 105, growth: null, grossCents: 63900 },
  { id: 'P-1800', widthMm: 1700, heightMm: 1400, wh: 1800, massKg: 120, growth: { dimension: 'length', mm: 60 }, grossCents: 74900 },
  { id: 'P-2100', widthMm: 1900, heightMm: 1650, wh: 2100, massKg: 140, growth: null, grossCents: 84900 },
];

export interface Hub {
  id: string;
  widthMm: number;
  shaftMm: number;
  kwTenths: number;
  massKg: number;
  grossCents: number;
}

export const HUBS: Hub[] = [
  { id: 'H-1000', widthMm: 1200, shaftMm: 960, kwTenths: 10, massKg: 75, grossCents: 41900 },
  { id: 'H-2400', widthMm: 1340, shaftMm: 1040, kwTenths: 24, massKg: 95, grossCents: 57900 },
  { id: 'H-3600', widthMm: 1460, shaftMm: 1120, kwTenths: 36, massKg: 110, grossCents: 72900 },
  { id: 'H-4200', widthMm: 1460, shaftMm: 1120, kwTenths: 42, massKg: 115, grossCents: 79900 },
];

export const MIN_CLEARANCE_MM = 30; // tenths: exactly 3.0 mm passes

export interface FixedLine {
  code: string;
  name: string;
  grossCents: number;
  massKg: number | null;
  xMm: number | null;
}

export const FIXED_LINES: Record<string, FixedLine> = {
  'CTRL': { code: 'CTRL', name: 'Controller and harness', grossCents: 34900, massKg: 20, xMm: 6400 },
  'TANK-OUT': { code: 'TANK-OUT', name: 'Fuel tank removal', grossCents: 4900, massKg: null, xMm: null },
  'POST': { code: 'POST', name: 'Postage', grossCents: 3900, massKg: null, xMm: null },
  'FIT': { code: 'FIT', name: 'Workshop fitting', grossCents: 28900, massKg: null, xMm: null },
  'HANDOVER': { code: 'HANDOVER', name: 'Bike handover', grossCents: 9900, massKg: null, xMm: null },
};

export const VAT_RATES: Record<string, number> = { NL: 21, BE: 21, DE: 19, LU: 17 };

export const CLASS_LIMITS_KW: Record<'25' | '45', number> = { '25': 10, '45': 40 }; // tenths

export const ROAD_CLASSES: { country: string; class: 25 | 45; name: string }[] = [
  { country: 'NL', class: 25, name: 'snorfiets' },
  { country: 'NL', class: 45, name: 'bromfiets' },
  { country: 'BE', class: 25, name: 'class A' },
  { country: 'BE', class: 45, name: 'class B' },
  { country: 'DE', class: 25, name: 'Mofa' },
  { country: 'DE', class: 45, name: 'Kleinkraftrad' },
];

export function classNameFor(country: string, roadClass: 25 | 45): string {
  return ROAD_CLASSES.find((c) => c.country === country && c.class === roadClass)?.name ?? String(roadClass);
}

export interface InspectionFee {
  code: string;
  fromCents: number;
  toCents: number;
}

export const INSPECTION_FEES: { code: string; country: string; upTo: string; cents: number }[] = [
  { code: 'INSPECT-NL', country: 'NL', upTo: '2026-12-31', cents: 13100 },
  { code: 'INSPECT-BE', country: 'BE', upTo: '2026-12-31', cents: 9500 },
  { code: 'INSPECT-DE', country: 'DE', upTo: '2026-12-31', cents: 8900 },
];

export const INSPECTION_FEES_2027: Record<string, number> = { 'INSPECT-NL': 13600, 'INSPECT-BE': 9800, 'INSPECT-DE': 8900 };

export function inspectionFeeCents(country: string, amsterdamDate: string): { code: string; cents: number } {
  const code = `INSPECT-${country}`;
  if (amsterdamDate <= '2026-12-31') {
    return { code, cents: INSPECTION_FEES.find((f) => f.country === country)!.cents };
  }
  return { code, cents: INSPECTION_FEES_2027[code]! };
}

export const WITHDRAWAL_HOLIDAYS: Record<string, string[]> = {
  NL: ['2026-12-25', '2026-12-26', '2027-01-01', '2027-03-29', '2027-04-27', '2027-05-06', '2027-05-17', '2027-12-25', '2027-12-26'],
  BE: ['2026-12-25', '2027-01-01', '2027-03-29', '2027-05-01', '2027-05-06', '2027-05-17', '2027-07-21', '2027-08-15', '2027-11-01', '2027-11-11', '2027-12-25'],
  DE: ['2026-12-25', '2026-12-26', '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-01', '2027-05-06', '2027-05-17', '2027-10-03', '2027-12-25', '2027-12-26'],
  LU: ['2026-12-25', '2026-12-26', '2027-01-01', '2027-03-29', '2027-05-01', '2027-05-06', '2027-05-09', '2027-05-17', '2027-06-23', '2027-08-15', '2027-11-01', '2027-12-25', '2027-12-26'],
};

export const SEED_USERS = [
  { email: 'fitter@ommezwaai.example', password: 'Werkbank-2026!', name: 'Bram Dekkers', role: 'fitter', country: 'NL' },
  { email: 'rider.nl@ommezwaai.example', password: 'Feeler-2026!', name: 'Anouk Veerman', role: 'rider', country: 'NL' },
  { email: 'rider.de@ommezwaai.example', password: 'Feeler-2026!', name: 'Lena Brandt', role: 'rider', country: 'DE' },
  { email: 'rider.be@ommezwaai.example', password: 'Feeler-2026!', name: 'Jef Claes', role: 'rider', country: 'BE' },
];

export interface Bike {
  id: string;
  name: string;
  roadClass: 25 | 45;
  rangeKm: number;
  grossCents: number;
}

export const BIKES: Bike[] = [
  { id: 'BK-KADE-25', name: 'Kade Stroom 25', roadClass: 25, rangeKm: 60, grossCents: 219900 },
  { id: 'BK-DIJK-45', name: 'Dijk Stroom 45', roadClass: 45, rangeKm: 85, grossCents: 334900 },
  { id: 'BK-POLDER-45', name: 'Polder Stroom 45', roadClass: 45, rangeKm: 110, grossCents: 389900 },
];

// Scene parts table: one table drives the scene, parts list, still drawing and story.
export interface ScenePart {
  id: string;
  name: string;
  position: [number, number, number]; // mm
  storyStage: number | null;
  axis: '+x' | '-x' | '+y' | '-y' | '+z' | '-z' | null;
  storyDistanceMm: number;
  fadedFor: string[];
  dimension: string; // dimension-line label shown on the part
}

export const SCENE_PARTS: ScenePart[] = [
  { id: 'front-panel', name: 'Front panel', position: [1120, 0, 620], storyStage: 1, axis: '+x', storyDistanceMm: 220, fadedFor: [], dimension: '220 × 380' },
  { id: 'leg-shield', name: 'Leg shield', position: [980, 0, 560], storyStage: 1, axis: '+x', storyDistanceMm: 160, fadedFor: [], dimension: '160 × 320' },
  { id: 'seat', name: 'Seat', position: [420, 0, 780], storyStage: 1, axis: '+z', storyDistanceMm: 240, fadedFor: ['pack'], dimension: '560 × 180' },
  { id: 'side-panel-left', name: 'Left side panel', position: [360, 130, 520], storyStage: 1, axis: '+y', storyDistanceMm: 200, fadedFor: ['pack', 'hub'], dimension: '420 × 300' },
  { id: 'side-panel-right', name: 'Right side panel', position: [360, -130, 520], storyStage: 1, axis: '-y', storyDistanceMm: 200, fadedFor: ['pack', 'hub'], dimension: '420 × 300' },
  { id: 'footboard', name: 'Footboard', position: [640, 0, 300], storyStage: 2, axis: '-z', storyDistanceMm: 180, fadedFor: ['pack'], dimension: '600 × 260' },
  { id: 'fuel-tank', name: 'Fuel tank', position: [380, 0, 470], storyStage: 3, axis: '+z', storyDistanceMm: 260, fadedFor: [], dimension: '280 × 200' },
  { id: 'engine-exhaust', name: 'Engine and exhaust', position: [120, 60, 280], storyStage: 3, axis: '+y', storyDistanceMm: 300, fadedFor: ['hub'], dimension: '480 × 160' },
  { id: 'hub-motor', name: 'Hub motor', position: [0, 0, 190], storyStage: 4, axis: '+y', storyDistanceMm: 180, fadedFor: [], dimension: '120 × 120' },
  { id: 'traction-pack', name: 'Traction pack', position: [500, 0, 360], storyStage: 5, axis: '-x', storyDistanceMm: 210, fadedFor: [], dimension: '340 × 180' },
  { id: 'controller', name: 'Controller', position: [640, 0, 400], storyStage: 6, axis: '+z', storyDistanceMm: 140, fadedFor: [], dimension: '160 × 90' },
  { id: 'frame', name: 'Frame', position: [620, 0, 420], storyStage: null, axis: null, storyDistanceMm: 0, fadedFor: [], dimension: '820 × 180' },
  { id: 'front-fork', name: 'Front fork', position: [1180, 0, 420], storyStage: null, axis: null, storyDistanceMm: 0, fadedFor: [], dimension: '60 × 480' },
  { id: 'front-wheel', name: 'Front wheel', position: [1240, 0, 190], storyStage: null, axis: null, storyDistanceMm: 0, fadedFor: [], dimension: 'Ø 300' },
  { id: 'rear-wheel', name: 'Rear wheel', position: [0, 0, 190], storyStage: null, axis: null, storyDistanceMm: 0, fadedFor: [], dimension: 'Ø 300' },
  { id: 'swingarm', name: 'Swingarm', position: [60, 0, 230], storyStage: null, axis: null, storyDistanceMm: 0, fadedFor: [], dimension: '420 × 120' },
];

export const STORY_CAPTIONS = [
  'Body panels off',
  'Footboard out',
  'Petrol out',
  'Hub on its axle line',
  'Pack on its rail',
  'Controller and harness',
];

export const RANGE_CONSUMPTION_WH_PER_KM: Record<'25' | '45', number> = { '25': 22, '45': 31 };

export const DONOR_POWER_LIMIT_PCT = 120; // exactly 120% passes
