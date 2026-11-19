import type { CarClass, CarStats, LapResult, LayoutId, Mode, Stages, System } from "../shared/model";
import type { Units } from "./format";

export interface Me {
  playerId: string;
  name: string;
  guest: boolean;
  email: string | null;
  units: Units;
  balance: number;
}

export interface Reference {
  layoutId: LayoutId;
  oldLapMs: number;
  newLapMs: number;
  deltaMs: number;
  oldSectorsMs: [number, number, number];
  newSectorsMs: [number, number, number];
  sectorDeltasMs: [number, number, number];
  price: number;
}

export interface GarageCar {
  carId: string;
  name: string;
  class: CarClass;
  pi: number;
  overClassLimit: boolean;
  stages: Stages;
  paid: Stages;
  stats: CarStats;
  latestReference: Reference | null;
}

export interface Garage {
  balance: number;
  selectedCarId: string;
  cars: GarageCar[];
}

export interface CatalogueCar {
  carId: string;
  name: string;
  class: CarClass;
  pi: number;
  price: number | null;
  starter: boolean;
  stats: CarStats;
}

export interface UpgradeResponse {
  purchaseId: string;
  carId: string;
  system: System;
  stage: number;
  price: number;
  balance: number;
  pi: number;
  overClassLimit: boolean;
  reference: Reference;
}

export interface RunCreated {
  runId: string;
  seed: string;
  layoutId: LayoutId;
  mode: Mode;
  carId: string;
  laps: number;
  stepLimit: number;
  loaner: boolean;
  car: { stats: CarStats; stages: Stages };
  ai: { name: string; carId: string; paceFactor: number }[];
}

export type RunStatus = "started" | "submitted" | "held" | "verifying" | "verified" | "rejected";

export interface RunSummary {
  runId: string;
  playerId: string;
  name: string;
  status: RunStatus;
  reason: string | null;
  layoutId: LayoutId;
  mode: Mode;
  carId: string;
  eventId: string | null;
  loaner: boolean;
  car: { stats: CarStats; stages: Stages };
  lapResults: LapResult[] | null;
  raceMs: number | null;
  bestLapMs: number | null;
  driftScore: number | null;
  coinsCollected: number | null;
  position: number | null;
  clean: boolean | null;
  payout: number | null;
  topSpeedMps: number | null;
  replaySha256: string | null;
}

export interface BoardRow {
  rank: number;
  playerId: string;
  name: string;
  runId: string;
  carId: string;
  value: number;
  unit: "ms" | "points";
  gapMs: number | null;
  topSpeedMps: number;
  replaySha256: string;
  mine: boolean;
}

export interface Board {
  layoutId: LayoutId;
  mode: string;
  class: CarClass;
  rows: BoardRow[];
  mine: BoardRow | null;
}

export interface ChampionshipEvent {
  eventId: string;
  name: string;
  mode: Mode;
  layoutId: LayoutId;
  class: CarClass | null;
  points: number;
  eligible: boolean;
  loanerCarId: string | null;
}

export interface Championship {
  leagues: { leagueId: "rookie" | "club"; status: "locked" | "open" | "complete"; points: number; events: ChampionshipEvent[] }[];
  trophy: boolean;
}

interface LobbyPlayer {
  playerId: string;
  name: string;
  ready: boolean;
  connection: "connected" | "reconnecting";
  rejoinSecondsLeft: number | null;
  position: number | null;
  lap: number | null;
  finishMs: number | null;
  dnf: boolean;
  distanceM: number;
  lane: "left" | "middle" | "right";
  speedMps: number;
}

interface LobbyAi {
  name: string;
  position: number | null;
  lap: number | null;
  finishMs: number | null;
  distanceM: number;
  lane: "left" | "middle" | "right";
}

export interface Lobby {
  lobbyId: string;
  hostId: string;
  state: "open" | "countdown" | "racing" | "finished";
  countdown: number | null;
  graceSecondsLeft: number | null;
  players: LobbyPlayer[];
  ai: LobbyAi[];
}

export type Push =
  | { type: "balance"; balance: number; movementId: string; purchaseId: string | null }
  | { type: "run"; runId: string; status: RunStatus }
  | ({ type: "championship" } & Championship)
  | { type: "board"; layoutId: LayoutId; mode: string; class: CarClass; row: BoardRow }
  | ({ type: "lobby" } & Lobby);
