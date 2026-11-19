import type {
  CarClass,
  CarStats,
  LayoutId,
  RaceMode,
  StageMap,
  SystemName,
} from '../shared/catalogue.js';
import type { Units } from '../shared/format.js';
import type { InputEvent } from '../shared/race-model.js';

export interface Me {
  playerId: string;
  name: string;
  guest: boolean;
  email: string | null;
  units: Units;
  balance: number;
}

export interface ReferenceBody {
  layoutId: LayoutId;
  oldLapMs: number;
  newLapMs: number;
  deltaMs: number;
  oldSectorsMs: number[];
  newSectorsMs: number[];
  sectorDeltasMs: number[];
  price: number;
}

export interface GarageCar {
  carId: string;
  name: string;
  class: CarClass;
  pi: number;
  overClassLimit: boolean;
  stages: StageMap;
  paid: StageMap;
  stats: CarStats;
  latestReference: ReferenceBody | null;
}

export interface Garage {
  balance: number;
  selectedCarId: string;
  cars: GarageCar[];
}

export interface UpgradeResponse {
  purchaseId: string;
  carId: string;
  system: SystemName;
  stage: number;
  price: number;
  balance: number;
  pi: number;
  overClassLimit: boolean;
  reference: ReferenceBody;
}

export interface RefitResponse {
  carId: string;
  system: SystemName;
  refund: number;
  balance: number;
  pi: number;
}

export interface LapResultBody {
  lapMs: number;
  valid: boolean;
  offTrackSteps: number;
  sectorsMs: number[];
}

export interface RunBody {
  runId: string;
  playerId: string;
  name: string;
  status: 'started' | 'submitted' | 'verifying' | 'held' | 'verified' | 'rejected';
  reason: string | null;
  layoutId: LayoutId;
  mode: RaceMode;
  carId: string;
  eventId: string | null;
  loaner: boolean;
  car: { stats: CarStats; stages: StageMap };
  lapResults: LapResultBody[] | null;
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

export interface CreatedRun {
  runId: string;
  seed: string;
  layoutId: LayoutId;
  mode: RaceMode;
  carId: string;
  laps: number;
  stepLimit: number;
  loaner: boolean;
  car: { stats: CarStats; stages: StageMap };
  ai: { name: string; carId: string; paceFactor: number }[];
}

export interface BoardRow {
  rank: number;
  playerId: string;
  name: string;
  runId: string;
  carId: string;
  value: number;
  unit: 'ms' | 'points';
  gapMs: number | null;
  topSpeedMps: number;
  replaySha256: string | null;
  mine: boolean;
}

export interface BoardBody {
  layoutId: LayoutId;
  mode: 'time-trial' | 'circuit' | 'drift';
  class: CarClass;
  rows: BoardRow[];
  mine: BoardRow | null;
}

export interface ChampionshipEvent {
  eventId: string;
  name: string;
  mode: RaceMode;
  layoutId: LayoutId;
  class: CarClass;
  points: number;
  eligible: boolean;
  loanerCarId: string | null;
}

export interface ChampionshipLeague {
  leagueId: 'rookie' | 'club';
  status: 'locked' | 'open' | 'complete';
  points: number;
  events: ChampionshipEvent[];
}

export interface ChampionshipBody {
  leagues: ChampionshipLeague[];
  trophy: boolean;
}

export interface LobbyPlayer {
  playerId: string;
  name: string;
  ready: boolean;
  connection: 'connected' | 'reconnecting';
  rejoinSecondsLeft: number | null;
  position: number | null;
  lap: number;
  finishMs: number | null;
  dnf: boolean;
}

export interface LobbyBody {
  lobbyId: string;
  hostId: string;
  state: 'open' | 'countdown' | 'racing' | 'finished';
  countdown: number | null;
  graceSecondsLeft: number | null;
  players: LobbyPlayer[];
  ai: { name: string; position: number | null; lap: number; finishMs: number | null }[];
}

export interface ReplayFile {
  seed: string;
  inputs: InputEvent[];
}
