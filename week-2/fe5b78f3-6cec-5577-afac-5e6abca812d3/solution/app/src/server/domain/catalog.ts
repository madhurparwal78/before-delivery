// Trains, stops and coaches as read back from Postgres at start.
import type { ClassCode, Station } from "../../shared/api.js";

export interface Stop {
  seq: number;
  code: string;
  name: string;
  km: number;
  minutes: number;
  remote: boolean;
}

export interface Train {
  number: string;
  name: string;
  stops: Stop[];
  coaches: { code: string; cls: ClassCode }[];
}

export interface Catalog {
  stations: Station[];
  trains: Train[];
}

export function findTrain(catalog: Catalog, number: unknown): Train | undefined {
  return catalog.trains.find((t) => t.number === number);
}

export function isStation(catalog: Catalog, code: unknown): boolean {
  return catalog.stations.some((s) => s.code === code);
}

export function coachesOf(train: Train, cls: ClassCode): string[] {
  return train.coaches.filter((c) => c.cls === cls).map((c) => c.code);
}

/** The From and To stops of a stretch, when the train calls at both in that order. */
export function stretchOf(train: Train, from: string, to: string): { from: Stop; to: Stop } | undefined {
  const a = train.stops.find((s) => s.code === from);
  const b = train.stops.find((s) => s.code === to);
  return a && b && a.seq < b.seq ? { from: a, to: b } : undefined;
}
