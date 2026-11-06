/** Run object as published by the API. */
export interface RunObj {
  id: string;
  runNumber: number;
  status: "pending" | "committed" | "corrected" | "rerun_granted";
  outcome: "time" | "dnf" | "rerun" | null;
  rawTime: string | null;
  cones: number | null;
  adjustedTime: string | null;
  indexedTime: string | null;
  factor: string | null;
  committedAt: string | null;
  committedBy: { id: string; name: string } | null;
}

export type EventStatus =
  | "draft" | "registration_open" | "registration_closed"
  | "running" | "provisional" | "final" | "published";

export interface EventRow {
  id: string;
  club_id: string;
  name: string;
  date: string;
  venue: string;
  registration_cutoff: Date;
  runs_per_driver: number;
  heat_classes: Record<string, string[]>;
  stations: string[];
  status: EventStatus;
  running_heat: number | null;
  provisional_at: Date | null;
  protest_window_closes_at: Date | null;
  version: number;
  index_table_id: string;
  published_at: Date | null;
  results_checksum: string | null;
  effective_date: string;
  factors: Record<string, string>;
  time_zone: string;
}

export interface RegistrationRow {
  id: string;
  event_id: string;
  driver_id: string;
  driver_name: string;
  driver_email: string;
  class_code: string;
  car_number: number;
  car_description: string;
  run_heat: number;
  checked_in_at: Date | null;
  waiver_key: string | null;
  waiver_checksum: string | null;
  confirmation_email: string;
  station_id: string | null;
  station_name: string | null;
  station_heat: number | null;
}

export interface StationRow {
  id: string;
  event_id: string;
  name: string;
  heat: number;
  registration_id: string | null;
  worker_name: string | null;
  car_number: number | null;
  class_code: string | null;
}

export interface RunDbRow {
  id: string;
  registration_id: string;
  run_number: number;
  status: string;
  outcome: string | null;
  raw_time: string | null;
  cones: number | null;
  adjusted_time: string | null;
  indexed_time: string | null;
  factor: string | null;
  committed_at: Date | null;
  committed_by_name: string | null;
}

export interface RunRankChange {
  runNumber: number;
  at: string;
  rankChange: { indexed: string; class: string; raw: string };
}

export interface StandingsRow {
  registrationId: string;
  carNumber: number;
  classCode: string;
  driverName: string;
  carDescription: string;
  position: number | null;
  classPosition: number | null;
  rawPosition: number | null;
  bestAdjusted: string | null;
  bestIndexed: string | null;
  lastChange: RunRankChange | null;
  runs: RunObj[];
}
