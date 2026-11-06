/**
 * Seed data tables from the brief. All invented product data.
 *
 * Every length and mass here is an integer in tenths (tenths of a millimetre,
 * tenths of a kilogram) so verdicts compare integers and never display values.
 * Power is in tenths of a kilowatt. Money is in integer cents.
 */

import type {
  DeliveryCountry,
  PlateColour,
  RegCountry,
  Revision,
  RoadClass,
} from './types.js';

export interface MassAtX {
  /** tenths of a kg */
  massTenthsKg: number;
  /** tenths of a mm, measured forward from the rear axle */
  xTenthsMm: number;
}

export interface DonorRow {
  model: string;
  name: string;
  powerTenthsKw: number;
  wheelbaseTenthsMm: number;
  chassis: MassAtX;
  engineExhaust: MassAtX;
  fuelTank: MassAtX;
  /** tenths of a mm: where the traction pack is carried */
  bayXTenthsMm: number;
}

export const DONORS: readonly DonorRow[] = [
  {
    model: 'K50',
    name: 'Kade K50',
    powerTenthsKw: 30,
    wheelbaseTenthsMm: 12400,
    chassis: { massTenthsKg: 640, xTenthsMm: 7200 },
    engineExhaust: { massTenthsKg: 200, xTenthsMm: 1200 },
    fuelTank: { massTenthsKg: 60, xTenthsMm: 3800 },
    bayXTenthsMm: 5000,
  },
  {
    model: 'P50',
    name: 'Polder P50',
    powerTenthsKw: 24,
    wheelbaseTenthsMm: 12100,
    chassis: { massTenthsKg: 580, xTenthsMm: 7000 },
    engineExhaust: { massTenthsKg: 200, xTenthsMm: 1100 },
    fuelTank: { massTenthsKg: 60, xTenthsMm: 3800 },
    bayXTenthsMm: 5200,
  },
  {
    model: 'R50',
    name: 'Rijn R50',
    powerTenthsKw: 20,
    wheelbaseTenthsMm: 11800,
    chassis: { massTenthsKg: 520, xTenthsMm: 7000 },
    engineExhaust: { massTenthsKg: 220, xTenthsMm: 1100 },
    fuelTank: { massTenthsKg: 60, xTenthsMm: 3600 },
    bayXTenthsMm: 5400,
  },
  {
    model: 'D50',
    name: 'Dijk D50',
    powerTenthsKw: 35,
    wheelbaseTenthsMm: 10000,
    chassis: { massTenthsKg: 500, xTenthsMm: 6000 },
    engineExhaust: { massTenthsKg: 300, xTenthsMm: 1000 },
    fuelTank: { massTenthsKg: 50, xTenthsMm: 2000 },
    bayXTenthsMm: 5275,
  },
];

export interface PackStationRow {
  id: string;
  name: string;
  travelTenthsMm: number;
  openWidthTenthsMm: number;
  openHeightTenthsMm: number;
}

export interface FrameRevisionRow {
  model: string;
  revision: Revision;
  stations: readonly PackStationRow[];
}

/**
 * Pack rail stations per frame revision. The S3 travel is the rail length.
 * Every frame is revision A except K50 with first admission from 2021.
 */
export const FRAME_REVISIONS: readonly FrameRevisionRow[] = [
  {
    model: 'K50',
    revision: 'A',
    stations: [
      { id: 'S1', name: 'Bay mouth', travelTenthsMm: 600, openWidthTenthsMm: 1950, openHeightTenthsMm: 1720 },
      { id: 'S2', name: 'Footboard rib', travelTenthsMm: 1300, openWidthTenthsMm: 1930, openHeightTenthsMm: 1680 },
      { id: 'S3', name: 'Seat post', travelTenthsMm: 2100, openWidthTenthsMm: 2000, openHeightTenthsMm: 1750 },
    ],
  },
  {
    model: 'K50',
    revision: 'B',
    stations: [
      { id: 'S1', name: 'Bay mouth', travelTenthsMm: 600, openWidthTenthsMm: 1950, openHeightTenthsMm: 1720 },
      { id: 'S2', name: 'Footboard rib', travelTenthsMm: 1300, openWidthTenthsMm: 1930, openHeightTenthsMm: 1650 },
      { id: 'S3', name: 'Seat post', travelTenthsMm: 2100, openWidthTenthsMm: 2000, openHeightTenthsMm: 1750 },
    ],
  },
  {
    model: 'P50',
    revision: 'A',
    stations: [
      { id: 'S1', name: 'Bay mouth', travelTenthsMm: 600, openWidthTenthsMm: 1900, openHeightTenthsMm: 1650 },
      { id: 'S2', name: 'Centre stand brace', travelTenthsMm: 1200, openWidthTenthsMm: 1870, openHeightTenthsMm: 1700 },
      { id: 'S3', name: 'Seat post', travelTenthsMm: 2000, openWidthTenthsMm: 1950, openHeightTenthsMm: 1720 },
    ],
  },
  {
    model: 'R50',
    revision: 'A',
    stations: [
      { id: 'S1', name: 'Bay mouth', travelTenthsMm: 500, openWidthTenthsMm: 2000, openHeightTenthsMm: 1750 },
      { id: 'S2', name: 'Footboard rib', travelTenthsMm: 1250, openWidthTenthsMm: 1929, openHeightTenthsMm: 1750 },
      { id: 'S3', name: 'Battery tray lip', travelTenthsMm: 1950, openWidthTenthsMm: 1980, openHeightTenthsMm: 1760 },
    ],
  },
  {
    model: 'D50',
    revision: 'A',
    stations: [
      { id: 'S1', name: 'Bay mouth', travelTenthsMm: 600, openWidthTenthsMm: 2000, openHeightTenthsMm: 1800 },
      { id: 'S2', name: 'Footboard rib', travelTenthsMm: 1300, openWidthTenthsMm: 1980, openHeightTenthsMm: 1760 },
      { id: 'S3', name: 'Seat post', travelTenthsMm: 2150, openWidthTenthsMm: 2040, openHeightTenthsMm: 1800 },
    ],
  },
];

/** Hub rail station travels, the same for every model. S3 is the rail length. */
export const HUB_STATION_TRAVELS: readonly { id: string; name: string; travelTenthsMm: number }[] = [
  { id: 'H1', name: 'Swingarm mouth', travelTenthsMm: 200 },
  { id: 'H2', name: 'Swingarm arm', travelTenthsMm: 450 },
  { id: 'H3', name: 'Sprocket line', travelTenthsMm: 700 },
];

export interface HubFrameRow {
  model: string;
  mouthWidthTenthsMm: number;
  armWidthTenthsMm: number;
  sprocketLineTenthsMm: number;
}

export const HUB_FRAMES: readonly HubFrameRow[] = [
  { model: 'K50', mouthWidthTenthsMm: 1520, armWidthTenthsMm: 1490, sprocketLineTenthsMm: 1150 },
  { model: 'P50', mouthWidthTenthsMm: 1400, armWidthTenthsMm: 1370, sprocketLineTenthsMm: 1080 },
  { model: 'R50', mouthWidthTenthsMm: 1500, armWidthTenthsMm: 1400, sprocketLineTenthsMm: 1069 },
  { model: 'D50', mouthWidthTenthsMm: 1550, armWidthTenthsMm: 1520, sprocketLineTenthsMm: 1180 },
];

export type GrowthDimension = 'length' | 'width' | 'height';

export interface PackRow {
  id: string;
  widthTenthsMm: number;
  heightTenthsMm: number;
  wattHours: number;
  massTenthsKg: number;
  growth: { dimension: GrowthDimension; tenthsMm: number } | null;
  grossCents: number;
}

export const PACKS: readonly PackRow[] = [
  { id: 'P-1100', widthTenthsMm: 1500, heightTenthsMm: 1200, wattHours: 1100, massTenthsKg: 80, growth: null, grossCents: 48900 },
  { id: 'P-1500', widthTenthsMm: 1700, heightTenthsMm: 1400, wattHours: 1500, massTenthsKg: 105, growth: null, grossCents: 63900 },
  { id: 'P-1800', widthTenthsMm: 1700, heightTenthsMm: 1400, wattHours: 1800, massTenthsKg: 120, growth: { dimension: 'length', tenthsMm: 60 }, grossCents: 74900 },
  { id: 'P-2100', widthTenthsMm: 1900, heightTenthsMm: 1650, wattHours: 2100, massTenthsKg: 140, growth: null, grossCents: 84900 },
];

export interface HubRow {
  id: string;
  widthTenthsMm: number;
  shaftTenthsMm: number;
  powerTenthsKw: number;
  massTenthsKg: number;
  grossCents: number;
}

export const HUBS: readonly HubRow[] = [
  { id: 'H-1000', widthTenthsMm: 1200, shaftTenthsMm: 960, powerTenthsKw: 10, massTenthsKg: 75, grossCents: 41900 },
  { id: 'H-2400', widthTenthsMm: 1340, shaftTenthsMm: 1040, powerTenthsKw: 24, massTenthsKg: 95, grossCents: 57900 },
  { id: 'H-3600', widthTenthsMm: 1460, shaftTenthsMm: 1120, powerTenthsKw: 36, massTenthsKg: 110, grossCents: 72900 },
  { id: 'H-4200', widthTenthsMm: 1460, shaftTenthsMm: 1120, powerTenthsKw: 42, massTenthsKg: 115, grossCents: 79900 },
];

/** The controller is a built part, carried at this position. */
export const CONTROLLER = {
  code: 'CTRL',
  name: 'Controller and harness',
  grossCents: 34900,
  massTenthsKg: 20,
  xTenthsMm: 6400,
} as const;

export const FIXED_LINES = {
  'TANK-OUT': { name: 'Fuel tank removal', grossCents: 4900 },
  POST: { name: 'Postage', grossCents: 3900 },
  FIT: { name: 'Workshop fitting', grossCents: 28900 },
  HANDOVER: { name: 'Bike handover', grossCents: 9900 },
} as const;

export const INSPECTION_FEE_NAME = 'Inspection fee';

/**
 * Inspection fees by the Amsterdam date of the quote. VAT rate 0.
 * `from` is inclusive; rows are ordered oldest first.
 */
export const INSPECTION_FEES: readonly {
  code: string;
  country: RegCountry;
  from: string;
  grossCents: number;
}[] = [
  { code: 'INSPECT-NL', country: 'NL', from: '0000-01-01', grossCents: 13100 },
  { code: 'INSPECT-NL', country: 'NL', from: '2027-01-01', grossCents: 13600 },
  { code: 'INSPECT-BE', country: 'BE', from: '0000-01-01', grossCents: 9500 },
  { code: 'INSPECT-BE', country: 'BE', from: '2027-01-01', grossCents: 9800 },
  { code: 'INSPECT-DE', country: 'DE', from: '0000-01-01', grossCents: 8900 },
  { code: 'INSPECT-DE', country: 'DE', from: '2027-01-01', grossCents: 8900 },
];

export const ROAD_CLASS_NAMES: Record<RegCountry, Record<RoadClass, string>> = {
  NL: { 25: 'snorfiets', 45: 'bromfiets' },
  BE: { 25: 'class A', 45: 'class B' },
  DE: { 25: 'Mofa', 45: 'Kleinkraftrad' },
};

/** House rules of this shop, applied across all countries. Tenths of a kW. */
export const CLASS_POWER_LIMIT_TENTHS_KW: Record<RoadClass, number> = { 25: 10, 45: 40 };

/** Watt-hours consumed per kilometre, by target road class. */
export const CONSUMPTION_WH_PER_KM: Record<RoadClass, number> = { 25: 22, 45: 31 };

export const VAT_RATE_PCT: Record<DeliveryCountry, number> = { NL: 21, BE: 21, DE: 19, LU: 17 };

/** Minimum clearance at each station. Exactly this value passes. */
export const MIN_CLEARANCE_TENTHS_MM = 30;

/** Maximum axle-split movement, in tenths of a percentage point. Exactly this passes. */
export const AXLE_SHIFT_LIMIT_TENTHS_PCT = 100;

/** Kit power may not exceed this percentage of the donor's power. Exactly this passes. */
export const DONOR_POWER_LIMIT_PCT = 120;

/** The plate colour the registry must show after a class move, by donor country. */
export const CLASS_MOVE_PLATE_COLOUR: Record<RegCountry, PlateColour> = {
  NL: 'yellow',
  BE: 'white',
  DE: 'white',
};

export interface BikeRow {
  id: string;
  name: string;
  roadClass: RoadClass;
  rangeKm: number;
  grossCents: number;
}

export const BIKES: readonly BikeRow[] = [
  { id: 'BK-KADE-25', name: 'Kade Stroom 25', roadClass: 25, rangeKm: 60, grossCents: 219900 },
  { id: 'BK-DIJK-45', name: 'Dijk Stroom 45', roadClass: 45, rangeKm: 85, grossCents: 334900 },
  { id: 'BK-POLDER-45', name: 'Polder Stroom 45', roadClass: 45, rangeKm: 110, grossCents: 389900 },
];

/** Withdrawal holidays by delivery country. */
export const WITHDRAWAL_HOLIDAYS: Record<DeliveryCountry, readonly string[]> = {
  NL: [
    '2026-12-25', '2026-12-26', '2027-01-01', '2027-03-29',
    '2027-04-27', '2027-05-06', '2027-05-17', '2027-12-25', '2027-12-26',
  ],
  BE: [
    '2026-12-25', '2027-01-01', '2027-03-29', '2027-05-01', '2027-05-06',
    '2027-05-17', '2027-07-21', '2027-08-15', '2027-11-01', '2027-11-11', '2027-12-25',
  ],
  DE: [
    '2026-12-25', '2026-12-26', '2027-01-01', '2027-03-26', '2027-03-29',
    '2027-05-01', '2027-05-06', '2027-05-17', '2027-10-03', '2027-12-25', '2027-12-26',
  ],
  LU: [
    '2026-12-25', '2026-12-26', '2027-01-01', '2027-03-29', '2027-05-01',
    '2027-05-06', '2027-05-09', '2027-05-17', '2027-06-23', '2027-08-15',
    '2027-11-01', '2027-12-25', '2027-12-26',
  ],
};

/** Days after `deliveredOn` on which a posted kit's withdrawal deadline falls. */
export const WITHDRAWAL_PERIOD_DAYS = 14;

export type PartAxis = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

export interface ScenePartRow {
  id: string;
  name: string;
  /** tenths of a mm, for K50; resolved per donor by the fit engine */
  position: readonly [number, number, number];
  storyStage: number | null;
  axis: PartAxis | null;
  /** tenths of a mm */
  storyDistanceTenthsMm: number;
  /** which rail selection fades this part as a blocking panel */
  fadedFor: readonly ('pack' | 'hub')[];
}

/**
 * One table drives the scene, the parts list, the still drawing and the story.
 * Positions are for K50, as x forward from the rear axle, y to the left, z up.
 */
export const SCENE_PARTS: readonly ScenePartRow[] = [
  { id: 'front-panel', name: 'Front panel', position: [11200, 0, 6200], storyStage: 1, axis: '+x', storyDistanceTenthsMm: 2200, fadedFor: [] },
  { id: 'leg-shield', name: 'Leg shield', position: [9800, 0, 5600], storyStage: 1, axis: '+x', storyDistanceTenthsMm: 1600, fadedFor: [] },
  { id: 'seat', name: 'Seat', position: [4200, 0, 7800], storyStage: 1, axis: '+z', storyDistanceTenthsMm: 2400, fadedFor: ['pack'] },
  { id: 'side-panel-left', name: 'Left side panel', position: [3600, 1300, 5200], storyStage: 1, axis: '+y', storyDistanceTenthsMm: 2000, fadedFor: ['pack', 'hub'] },
  { id: 'side-panel-right', name: 'Right side panel', position: [3600, -1300, 5200], storyStage: 1, axis: '-y', storyDistanceTenthsMm: 2000, fadedFor: ['pack', 'hub'] },
  { id: 'footboard', name: 'Footboard', position: [6400, 0, 3000], storyStage: 2, axis: '-z', storyDistanceTenthsMm: 1800, fadedFor: ['pack'] },
  { id: 'fuel-tank', name: 'Fuel tank', position: [3800, 0, 4700], storyStage: 3, axis: '+z', storyDistanceTenthsMm: 2600, fadedFor: [] },
  { id: 'engine-exhaust', name: 'Engine and exhaust', position: [1200, 600, 2800], storyStage: 3, axis: '+y', storyDistanceTenthsMm: 3000, fadedFor: ['hub'] },
  { id: 'hub-motor', name: 'Hub motor', position: [0, 0, 1900], storyStage: 4, axis: '+y', storyDistanceTenthsMm: 1800, fadedFor: [] },
  { id: 'traction-pack', name: 'Traction pack', position: [5000, 0, 3600], storyStage: 5, axis: '-x', storyDistanceTenthsMm: 2100, fadedFor: [] },
  { id: 'controller', name: 'Controller', position: [6400, 0, 4000], storyStage: 6, axis: '+z', storyDistanceTenthsMm: 1400, fadedFor: [] },
  { id: 'frame', name: 'Frame', position: [6200, 0, 4200], storyStage: null, axis: null, storyDistanceTenthsMm: 0, fadedFor: [] },
  { id: 'front-fork', name: 'Front fork', position: [11800, 0, 4200], storyStage: null, axis: null, storyDistanceTenthsMm: 0, fadedFor: [] },
  { id: 'front-wheel', name: 'Front wheel', position: [12400, 0, 1900], storyStage: null, axis: null, storyDistanceTenthsMm: 0, fadedFor: [] },
  { id: 'rear-wheel', name: 'Rear wheel', position: [0, 0, 1900], storyStage: null, axis: null, storyDistanceTenthsMm: 0, fadedFor: [] },
  { id: 'swingarm', name: 'Swingarm', position: [600, 0, 2300], storyStage: null, axis: null, storyDistanceTenthsMm: 0, fadedFor: [] },
];

export const STORY_CAPTIONS: readonly string[] = [
  'Body panels off',
  'Footboard out',
  'Petrol out',
  'Hub on its axle line',
  'Pack on its rail',
  'Controller and harness',
];

export const STORY_STAGE_COUNT = 6;

/** Plate formats, where L is a letter and N a digit. */
export const PLATE_FORMATS: Record<RegCountry, { pattern: string; example: string }> = {
  NL: { pattern: 'LLL-NN-L', example: 'FGH-12-K' },
  BE: { pattern: 'L-LLL-NNN', example: 'A-KLM-204' },
  DE: { pattern: 'NNN-LLL', example: '418-RTV' },
};

export interface SeedUserRow {
  email: string;
  password: string;
  name: string;
  role: 'rider' | 'fitter';
  country: DeliveryCountry;
}

export const SEED_USERS: readonly SeedUserRow[] = [
  { email: 'fitter@ommezwaai.example', password: 'Werkbank-2026!', name: 'Bram Dekkers', role: 'fitter', country: 'NL' },
  { email: 'rider.nl@ommezwaai.example', password: 'Feeler-2026!', name: 'Anouk Veerman', role: 'rider', country: 'NL' },
  { email: 'rider.de@ommezwaai.example', password: 'Feeler-2026!', name: 'Lena Brandt', role: 'rider', country: 'DE' },
  { email: 'rider.be@ommezwaai.example', password: 'Feeler-2026!', name: 'Jef Claes', role: 'rider', country: 'BE' },
];

export const STAGE_LABELS = {
  deposit: 'Deposit',
  'instalment-1': 'Instalment 1',
  'instalment-2': 'Instalment 2',
  'instalment-3': 'Instalment 3',
} as const;

export const SHOP_TIME_ZONE = 'Europe/Amsterdam';

export function donorByModel(model: string): DonorRow | undefined {
  return DONORS.find((d) => d.model === model);
}

export function packById(id: string): PackRow | undefined {
  return PACKS.find((p) => p.id === id);
}

export function hubById(id: string): HubRow | undefined {
  return HUBS.find((h) => h.id === id);
}

export function bikeById(id: string): BikeRow | undefined {
  return BIKES.find((b) => b.id === id);
}

export function hubFrameByModel(model: string): HubFrameRow | undefined {
  return HUB_FRAMES.find((h) => h.model === model);
}

/** K50 frames from first admission 2021 are revision B; every other frame is A. */
export function revisionFor(model: string, firstAdmissionYear: number): Revision {
  return model === 'K50' && firstAdmissionYear >= 2021 ? 'B' : 'A';
}

export function frameRevision(model: string, revision: Revision): FrameRevisionRow | undefined {
  return (
    FRAME_REVISIONS.find((f) => f.model === model && f.revision === revision) ??
    FRAME_REVISIONS.find((f) => f.model === model)
  );
}

export function scenePartById(id: string): ScenePartRow | undefined {
  return SCENE_PARTS.find((p) => p.id === id);
}
