import type { CoinId, PieceId, PocketId, Seat } from "./types";

export const MODEL_VERSION = "dc-model-1";

export const HALF_BOARD_MM = 370;
export const BOARD_MM = 740;
export const POCKET_RADIUS = 22.25;
const POCKET_CENTRE = 347.75;
export const COIN_RADIUS = 15.5;
export const STRIKER_RADIUS = 20.65;
const COIN_MASS = 5.5;
const STRIKER_MASS = 15;
export const BASELINE_Y = 252.1;
export const MAX_OFFSET = 200;
export const MIN_PLACEMENT_DISTANCE = 36.15;
export const LAUNCH_SPEED = 4000;

export const RESTITUTION_COINS = 0.9;
export const RESTITUTION_STRIKER = 0.88;
export const RESTITUTION_CUSHION = 0.75;
export const FRICTION_DECELERATION = 441.45;
export const STEP_SECONDS = 1 / 240;
export const SUBSTEPS = 4;
export const FRAME_EVERY_STEPS = 4;
export const REST_SPEED = 0.5;
export const MAX_SIM_SECONDS = 12;
export const POCKET_MAX_SPEED = 1800;
export const POCKET_CAPTURE_SHARE = 0.2;

export const RETURN_SPOT_CLEARANCE = 31.1;
export const SPIRAL_FIRST_RADIUS = 35;
export const SPIRAL_RADIUS_STEP = 5;
export const SPIRAL_ANGLE_STEP = 30;
export const SPIRAL_MAX_RINGS = 70;

export const POINTS_TO_WIN = 25;
export const QUEEN_BONUS = 3;
export const QUEEN_BONUS_LIMIT = 22;
export const PENALTY_POINTS = 3;
export const CLASSIC_BOARDS = 8;
export const EXTRA_BOARD = 9;
export const BREAK_ATTEMPTS = 3;
export const TIMEOUTS_TO_FORFEIT = 3;

export const POCKET_IDS: readonly PocketId[] = ["nw", "ne", "sw", "se"];
export const POCKET_POSITIONS: Record<PocketId, { x: number; y: number }> = {
  nw: { x: -POCKET_CENTRE, y: -POCKET_CENTRE },
  ne: { x: POCKET_CENTRE, y: -POCKET_CENTRE },
  sw: { x: -POCKET_CENTRE, y: POCKET_CENTRE },
  se: { x: POCKET_CENTRE, y: POCKET_CENTRE },
};

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export const WHITE_COINS: readonly CoinId[] = DIGITS.map((n) => `w${n}` as const);
export const BLACK_COINS: readonly CoinId[] = DIGITS.map((n) => `b${n}` as const);
/** the fixed body order of the model: striker, queen, w1..w9, b1..b9 */
export const PIECE_IDS: readonly PieceId[] = ["striker", "queen", ...WHITE_COINS, ...BLACK_COINS];

export const OPENING_LAYOUT: readonly { id: PieceId; x: number; y: number }[] = [
  { id: "queen", x: 0.0, y: 0.0 },
  { id: "w1", x: 31.2, y: 0.0 },
  { id: "b1", x: 15.6, y: 27.0 },
  { id: "w2", x: -15.6, y: 27.0 },
  { id: "b2", x: -31.2, y: 0.0 },
  { id: "w3", x: -15.6, y: -27.0 },
  { id: "b3", x: 15.6, y: -27.0 },
  { id: "w4", x: 62.4, y: 0.0 },
  { id: "b4", x: 46.8, y: 27.0 },
  { id: "b5", x: 31.2, y: 54.0 },
  { id: "w5", x: 0.0, y: 54.0 },
  { id: "w6", x: -31.2, y: 54.0 },
  { id: "b6", x: -46.8, y: 27.0 },
  { id: "b7", x: -62.4, y: 0.0 },
  { id: "w7", x: -46.8, y: -27.0 },
  { id: "w8", x: -31.2, y: -54.0 },
  { id: "b8", x: 0.0, y: -54.0 },
  { id: "b9", x: 31.2, y: -54.0 },
  { id: "w9", x: 46.8, y: -27.0 },
];

/** The six preset emotes: id and the label shown and announced. */
export const EMOTES: readonly (readonly [string, string])[] = [
  ["nice-shot", "Nice shot"],
  ["well-played", "Well played"],
  ["oops", "Oops"],
  ["thinking", "Thinking"],
  ["good-game", "Good game"],
  ["hello", "Hello"],
];

/** the fixed body order of the model, shared by the physics and the laws */
export const PIECE_ORDER: ReadonlyMap<PieceId, number> = new Map(PIECE_IDS.map((id, index) => [id, index]));

export function otherSeat(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

/** Seat 0 shoots from y = +252.1, seat 1 from y = -252.1. */
export function baselineY(seat: Seat): number {
  return seat === 0 ? BASELINE_Y : -BASELINE_Y;
}

export function isCoin(id: PieceId): id is CoinId {
  return id !== "striker" && id !== "queen";
}

export function pieceRadius(id: PieceId): number {
  return id === "striker" ? STRIKER_RADIUS : COIN_RADIUS;
}

export function pieceMass(id: PieceId): number {
  return id === "striker" ? STRIKER_MASS : COIN_MASS;
}
