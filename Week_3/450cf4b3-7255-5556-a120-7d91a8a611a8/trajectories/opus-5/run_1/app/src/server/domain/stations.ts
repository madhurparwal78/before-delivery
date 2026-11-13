import type { StationKind } from '../../shared/types';
import { CLEANUP_MINUTES } from '../../shared/copy';

export interface SeedStation {
  id: string;
  name: string;
  kind: StationKind;
  col: number;
  row: number;
}

export const SEED_STATIONS: ReadonlyArray<SeedStation> = [
  { id: 'range-1', name: 'Range 1', kind: 'range', col: 0, row: 0 },
  { id: 'range-2', name: 'Range 2', kind: 'range', col: 1, row: 0 },
  { id: 'range-3', name: 'Range 3', kind: 'range', col: 2, row: 0 },
  { id: 'prep-a', name: 'Prep Table A', kind: 'prep_table', col: 0, row: 1 },
  { id: 'prep-b', name: 'Prep Table B', kind: 'prep_table', col: 1, row: 1 },
  { id: 'mixer-60', name: 'Mixer 60 qt', kind: 'mixer', col: 2, row: 1 },
  { id: 'mixer-20', name: 'Mixer 20 qt', kind: 'mixer', col: 3, row: 1 },
  { id: 'shelf-1', name: 'Walk-in Shelf 1', kind: 'cooler_shelf', col: 0, row: 2 },
  { id: 'shelf-2', name: 'Walk-in Shelf 2', kind: 'cooler_shelf', col: 1, row: 2 },
  { id: 'shelf-3', name: 'Walk-in Shelf 3', kind: 'cooler_shelf', col: 2, row: 2 },
];

export const COOLER_SHELF_IDS: ReadonlyArray<string> = SEED_STATIONS.filter(
  (station) => station.kind === 'cooler_shelf',
).map((station) => station.id);

export const STATION_CLEANUP_MINUTES = CLEANUP_MINUTES;
