import type { ReactNode } from 'react';
import type { Pocket } from '../../shared/domain';
import type { BallSpots } from '../../shared/physics';

export interface SeatView {
  name: string;
  group: string;
  left: number;
  active: boolean;
}

export interface Replay {
  id: number;
  frames: BallSpots[];
  frameMs: number;
}

export interface StrikeRequest {
  aimDegrees: number;
  power: number;
  sideSpin: number;
  topSpin: number;
  calledPocket: Pocket | null;
}

export interface ResultView {
  line: string;
  coinChange: string;
  xpGained: number;
  levelUps: string[];
  rematch: { label: string | null; disabled: boolean; onPress: () => void } | null;
}

/** What a table screen needs from its source: the server for online tables, the browser for practice and the tutorial. */
export interface TableModel {
  seats: SeatView[];
  potText: string | null;
  turn: string;
  banner: string;
  log: string[];
  clock: number | null;
  reconnect: string | null;
  receipt: string;
  spots: BallSpots;
  replay: Replay | null;
  myShot: boolean;
  turnKey: string;
  aimResetKey: string;
  ballInHand: boolean;
  behindHeadString: boolean;
  calledPocketRequired: boolean;
  guidelines: boolean;
  aimBonus: number;
  cloth: string;
  tutorialStep: string | null;
  children: ReactNode;
  result: ResultView | null;
  legalFirst: (ball: number) => boolean;
  shoot: (strike: StrikeRequest) => Promise<void>;
  place: (across: number, along: number) => Promise<string | null>;
  announce: (line: string, inBanner: boolean) => void;
  replayFinished: (id: number) => void;
}
