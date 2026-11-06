import type { Reading, SensorKind } from '../../domain/derivation';
import type { Ring } from '../../domain/geometry';
import { HALF_HOUR_MS } from '../../domain/time';

export const SEED_PASSWORD = 'moss-and-tower-26';

export const SEED_ORG = { id: 'org-levelmoor', name: 'Levelmoor Restoration Trust' };

export type OrgRole = 'admin' | 'steward' | 'member';
export type ProjectRole = 'viewer' | 'analyst' | 'sealer';

export interface SeedPerson {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly orgRole: OrgRole;
  readonly grants: readonly { readonly project: string; readonly role: ProjectRole }[];
}

export const SEED_PEOPLE: readonly SeedPerson[] = [
  { id: 'p-ines', name: 'Ines Okafor', email: 'ines@levelmoor.example', orgRole: 'admin', grants: [] },
  {
    id: 'p-priya',
    name: 'Priya Nand',
    email: 'priya@levelmoor.example',
    orgRole: 'steward',
    grants: [
      { project: 'blackmere-moss', role: 'viewer' },
      { project: 'saltings-reach', role: 'viewer' },
      { project: 'hollin-wood', role: 'viewer' },
    ],
  },
  {
    id: 'p-tomas',
    name: 'Tomas Reyes',
    email: 'tomas@levelmoor.example',
    orgRole: 'member',
    grants: [
      { project: 'blackmere-moss', role: 'sealer' },
      { project: 'saltings-reach', role: 'analyst' },
    ],
  },
  {
    id: 'p-hal',
    name: 'Hal Brennan',
    email: 'hal@levelmoor.example',
    orgRole: 'member',
    grants: [
      { project: 'blackmere-moss', role: 'sealer' },
      { project: 'saltings-reach', role: 'sealer' },
      { project: 'hollin-wood', role: 'sealer' },
    ],
  },
  {
    id: 'p-odile',
    name: 'Odile Marsh',
    email: 'odile@levelmoor.example',
    orgRole: 'member',
    grants: [{ project: 'blackmere-moss', role: 'analyst' }],
  },
  {
    id: 'p-wren',
    name: 'Wren Adeyemi',
    email: 'wren@levelmoor.example',
    orgRole: 'member',
    grants: [{ project: 'blackmere-moss', role: 'viewer' }],
  },
];

export interface SeedSensor {
  readonly id: string;
  readonly kind: SensorKind;
  readonly polygon: Ring;
}

export interface SeedProject {
  readonly slug: string;
  readonly name: string;
  readonly kind: string;
  readonly code: string;
  readonly floorPct: string;
  readonly bufferPct: string;
  readonly leadPersonId: string;
  readonly boundary: Ring;
  readonly sensors: readonly SeedSensor[];
}

function rectangle(x1: number, y1: number, x2: number, y2: number): Ring {
  return [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
}

export const SEED_PROJECTS: readonly SeedProject[] = [
  {
    slug: 'blackmere-moss',
    name: 'Blackmere Moss',
    kind: 'peatland rewetting',
    code: 'BM',
    floorPct: '60.0',
    bufferPct: '15.0',
    leadPersonId: 'p-hal',
    boundary: rectangle(0, 0, 1000, 600),
    sensors: [
      { id: 'BM-T1', kind: 'tower', polygon: rectangle(100, 100, 500, 500) },
      { id: 'BM-T2', kind: 'tower', polygon: rectangle(400, 200, 800, 500) },
      { id: 'BM-S1', kind: 'satellite', polygon: rectangle(0, 0, 500, 300) },
      { id: 'BM-S2', kind: 'satellite', polygon: rectangle(500, 0, 1000, 300) },
      { id: 'BM-S3', kind: 'satellite', polygon: rectangle(0, 300, 500, 600) },
      { id: 'BM-S4', kind: 'satellite', polygon: rectangle(500, 300, 1000, 600) },
    ],
  },
  {
    slug: 'saltings-reach',
    name: 'Saltings Reach',
    kind: 'wetland restoration',
    code: 'SR',
    floorPct: '50.0',
    bufferPct: '10.0',
    leadPersonId: 'p-hal',
    boundary: rectangle(0, 0, 800, 500),
    sensors: [
      { id: 'SR-T1', kind: 'tower', polygon: rectangle(200, 100, 600, 400) },
      { id: 'SR-S1', kind: 'satellite', polygon: rectangle(0, 0, 400, 500) },
      { id: 'SR-S2', kind: 'satellite', polygon: rectangle(400, 0, 800, 500) },
    ],
  },
  {
    slug: 'hollin-wood',
    name: 'Hollin Wood',
    kind: 'managed forest',
    code: 'HW',
    floorPct: '70.0',
    bufferPct: '20.0',
    leadPersonId: 'p-hal',
    boundary: rectangle(0, 0, 400, 400),
    sensors: [
      { id: 'HW-T1', kind: 'tower', polygon: rectangle(0, 0, 400, 300) },
      { id: 'HW-S1', kind: 'satellite', polygon: rectangle(0, 0, 400, 400) },
    ],
  },
];

const FIRST_INTERVAL = Date.UTC(2026, 5, 1, 0, 0, 0);
const SATELLITE_FIRST_INTERVAL = Date.UTC(2026, 5, 3, 0, 0, 0);
const BM_S4_BAD_FROM = Date.UTC(2026, 5, 8, 0, 0, 0);
const LAST_INTERVAL = Date.UTC(2026, 5, 14, 23, 30, 0);

function halfHours(fromMs: number, toMs: number): number[] {
  const stamps: number[] = [];
  for (let ms = fromMs; ms <= toMs; ms += HALF_HOUR_MS) stamps.push(ms);
  return stamps;
}

/** Interval starts 06:00 to 17:30 UTC carry the daytime uptake value. */
function isDaytime(ms: number): boolean {
  const minuteOfDay = new Date(ms).getUTCHours() * 60 + new Date(ms).getUTCMinutes();
  return minuteOfDay >= 6 * 60 && minuteOfDay <= 17 * 60 + 30;
}

function scaled(value: number): bigint {
  return BigInt(Math.round(value * 10000));
}

export function seedReadings(slug: string): Reading[] {
  const readings: Reading[] = [];
  if (slug === 'blackmere-moss') {
    for (const ms of halfHours(FIRST_INTERVAL, LAST_INTERVAL)) {
      readings.push({
        sensorId: 'BM-T1',
        intervalStartMs: ms,
        fc4: scaled(isDaytime(ms) ? -3 : 1.5),
        fch44: scaled(15),
        qc: 0,
      });
      readings.push({
        sensorId: 'BM-T2',
        intervalStartMs: ms,
        fc4: scaled(isDaytime(ms) ? -2 : 1),
        fch44: scaled(30),
        qc: 0,
      });
    }
    for (const ms of halfHours(SATELLITE_FIRST_INTERVAL, LAST_INTERVAL)) {
      for (const sensorId of ['BM-S1', 'BM-S2', 'BM-S3', 'BM-S4']) {
        readings.push({
          sensorId,
          intervalStartMs: ms,
          fc4: scaled(-1),
          fch44: scaled(10),
          qc: sensorId === 'BM-S4' && ms >= BM_S4_BAD_FROM ? 3 : 0,
        });
      }
    }
  }
  if (slug === 'saltings-reach') {
    for (const ms of halfHours(FIRST_INTERVAL, LAST_INTERVAL)) {
      readings.push({
        sensorId: 'SR-T1',
        intervalStartMs: ms,
        fc4: scaled(-1.5),
        fch44: scaled(40),
        qc: 0,
      });
      for (const sensorId of ['SR-S1', 'SR-S2']) {
        readings.push({
          sensorId,
          intervalStartMs: ms,
          fc4: scaled(-0.5),
          fch44: scaled(25),
          qc: 0,
        });
      }
    }
  }
  return readings;
}
