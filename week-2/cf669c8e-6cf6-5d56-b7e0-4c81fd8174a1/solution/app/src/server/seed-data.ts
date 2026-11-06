/** Seed data, written to PostgreSQL once per database. Lengths and masses are integer tenths (60.0 mm is 600), kW tenths, money cents. */
import type { RegCountry, RoadClass } from '../shared/types.js';

const pack = (id: string, name: string, travelT: number, openWidthT: number, openHeightT: number) => ({ id, name, travelT, openWidthT, openHeightT });

export const SEED_DONORS = [
  {
    model: 'K50', name: 'Kade K50', powerKwT: 30, wheelbaseT: 12400,
    chassis: { massT: 640, xT: 7200 }, engine: { massT: 200, xT: 1200 }, tank: { massT: 60, xT: 3800 }, bayXT: 5000,
    packStations: {
      A: [pack('S1', 'Bay mouth', 600, 1950, 1720), pack('S2', 'Footboard rib', 1300, 1930, 1680), pack('S3', 'Seat post', 2100, 2000, 1750)],
      B: [pack('S1', 'Bay mouth', 600, 1950, 1720), pack('S2', 'Footboard rib', 1300, 1930, 1650), pack('S3', 'Seat post', 2100, 2000, 1750)],
    },
    revisionBFrom: 2021,
    hub: { mouthT: 1520, armT: 1490, sprocketT: 1150 },
  },
  {
    model: 'P50', name: 'Polder P50', powerKwT: 24, wheelbaseT: 12100,
    chassis: { massT: 580, xT: 7000 }, engine: { massT: 200, xT: 1100 }, tank: { massT: 60, xT: 3800 }, bayXT: 5200,
    packStations: {
      A: [pack('S1', 'Bay mouth', 600, 1900, 1650), pack('S2', 'Centre stand brace', 1200, 1870, 1700), pack('S3', 'Seat post', 2000, 1950, 1720)],
    },
    revisionBFrom: null,
    hub: { mouthT: 1400, armT: 1370, sprocketT: 1080 },
  },
  {
    model: 'R50', name: 'Rijn R50', powerKwT: 20, wheelbaseT: 11800,
    chassis: { massT: 520, xT: 7000 }, engine: { massT: 220, xT: 1100 }, tank: { massT: 60, xT: 3600 }, bayXT: 5400,
    packStations: {
      A: [pack('S1', 'Bay mouth', 500, 2000, 1750), pack('S2', 'Footboard rib', 1250, 1929, 1750), pack('S3', 'Battery tray lip', 1950, 1980, 1760)],
    },
    revisionBFrom: null,
    hub: { mouthT: 1500, armT: 1400, sprocketT: 1069 },
  },
  {
    model: 'D50', name: 'Dijk D50', powerKwT: 35, wheelbaseT: 10000,
    chassis: { massT: 500, xT: 6000 }, engine: { massT: 300, xT: 1000 }, tank: { massT: 50, xT: 2000 }, bayXT: 5275,
    packStations: {
      A: [pack('S1', 'Bay mouth', 600, 2000, 1800), pack('S2', 'Footboard rib', 1300, 1980, 1760), pack('S3', 'Seat post', 2150, 2040, 1800)],
    },
    revisionBFrom: null,
    hub: { mouthT: 1550, armT: 1520, sprocketT: 1180 },
  },
] as const;

export const SEED_HUB_STATIONS = [
  { id: 'H1', name: 'Swingarm mouth', travelT: 200 },
  { id: 'H2', name: 'Swingarm arm', travelT: 450 },
  { id: 'H3', name: 'Sprocket line', travelT: 700 },
] as const;

export const SEED_PACKS = [
  { id: 'P-1100', widthT: 1500, heightT: 1200, wh: 1100, massT: 80, growthT: 0, grossCents: 48900 },
  { id: 'P-1500', widthT: 1700, heightT: 1400, wh: 1500, massT: 105, growthT: 0, grossCents: 63900 },
  { id: 'P-1800', widthT: 1700, heightT: 1400, wh: 1800, massT: 120, growthT: 60, grossCents: 74900 },
  { id: 'P-2100', widthT: 1900, heightT: 1650, wh: 2100, massT: 140, growthT: 0, grossCents: 84900 },
] as const;

export const SEED_HUBS = [
  { id: 'H-1000', widthT: 1200, shaftT: 960, kwT: 10, massT: 75, grossCents: 41900 },
  { id: 'H-2400', widthT: 1340, shaftT: 1040, kwT: 24, massT: 95, grossCents: 57900 },
  { id: 'H-3600', widthT: 1460, shaftT: 1120, kwT: 36, massT: 110, grossCents: 72900 },
  { id: 'H-4200', widthT: 1460, shaftT: 1120, kwT: 42, massT: 115, grossCents: 79900 },
] as const;

export const SEED_FIXED_LINES = [
  { code: 'CTRL', name: 'Controller and harness', grossCents: 34900, massT: 20, xT: 6400 },
  { code: 'TANK-OUT', name: 'Fuel tank removal', grossCents: 4900, massT: null, xT: null },
  { code: 'POST', name: 'Postage', grossCents: 3900, massT: null, xT: null },
  { code: 'FIT', name: 'Workshop fitting', grossCents: 28900, massT: null, xT: null },
  { code: 'HANDOVER', name: 'Bike handover', grossCents: 9900, massT: null, xT: null },
] as const;

export const SEED_ROAD_CLASSES: readonly { country: RegCountry; roadClass: RoadClass; name: string }[] = [
  { country: 'NL', roadClass: 25, name: 'snorfiets' }, { country: 'NL', roadClass: 45, name: 'bromfiets' },
  { country: 'BE', roadClass: 25, name: 'class A' }, { country: 'BE', roadClass: 45, name: 'class B' },
  { country: 'DE', roadClass: 25, name: 'Mofa' }, { country: 'DE', roadClass: 45, name: 'Kleinkraftrad' },
];

export const SEED_INSPECTION_FEES = [
  { country: 'NL', changesOn: '2027-01-01', beforeCents: 13100, afterCents: 13600 },
  { country: 'BE', changesOn: '2027-01-01', beforeCents: 9500, afterCents: 9800 },
  { country: 'DE', changesOn: '2027-01-01', beforeCents: 8900, afterCents: 8900 },
] as const;

export const SEED_HOLIDAYS: Record<string, readonly string[]> = {
  NL: ['2026-12-25', '2026-12-26', '2027-01-01', '2027-03-29', '2027-04-27', '2027-05-06', '2027-05-17', '2027-12-25', '2027-12-26'],
  BE: ['2026-12-25', '2027-01-01', '2027-03-29', '2027-05-01', '2027-05-06', '2027-05-17', '2027-07-21', '2027-08-15', '2027-11-01', '2027-11-11', '2027-12-25'],
  DE: ['2026-12-25', '2026-12-26', '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-01', '2027-05-06', '2027-05-17', '2027-10-03', '2027-12-25', '2027-12-26'],
  LU: ['2026-12-25', '2026-12-26', '2027-01-01', '2027-03-29', '2027-05-01', '2027-05-06', '2027-05-09', '2027-05-17', '2027-06-23', '2027-08-15', '2027-11-01', '2027-12-25', '2027-12-26'],
};

export const SEED_BIKES = [
  { id: 'BK-KADE-25', name: 'Kade Stroom 25', roadClass: 25, rangeKm: 60, grossCents: 219900 },
  { id: 'BK-DIJK-45', name: 'Dijk Stroom 45', roadClass: 45, rangeKm: 85, grossCents: 334900 },
  { id: 'BK-POLDER-45', name: 'Polder Stroom 45', roadClass: 45, rangeKm: 110, grossCents: 389900 },
] as const;

export const SEED_USERS = [
  { email: 'fitter@ommezwaai.example', password: 'Werkbank-2026!', name: 'Bram Dekkers', role: 'fitter', country: 'NL' },
  { email: 'rider.nl@ommezwaai.example', password: 'Feeler-2026!', name: 'Anouk Veerman', role: 'rider', country: 'NL' },
  { email: 'rider.de@ommezwaai.example', password: 'Feeler-2026!', name: 'Lena Brandt', role: 'rider', country: 'DE' },
  { email: 'rider.be@ommezwaai.example', password: 'Feeler-2026!', name: 'Jef Claes', role: 'rider', country: 'BE' },
] as const;
