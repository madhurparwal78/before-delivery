// The one shared rules module of Due Coin: the deterministic physics model
// dc-model-1 and the laws of carrom. Both the browser and the server import
// this file, and no copy of either rule set exists elsewhere.

export const MODEL_VERSION = "dc-model-1";

export const BOARD_SIDE = 740;
export const CUSHION = 370;
export const POCKET_RADIUS = 22.25;
export const POCKET_CENTERS: Record<PocketId, { x: number; y: number }> = {
  nw: { x: -347.75, y: -347.75 },
  ne: { x: 347.75, y: -347.75 },
  sw: { x: -347.75, y: 347.75 },
  se: { x: 347.75, y: 347.75 },
};
export const COIN_RADIUS = 15.5;
export const STRIKER_RADIUS = 20.65;
export const COIN_MASS = 5.5;
export const STRIKER_MASS = 15;
export const BASELINE_Y = 252.1;
export const OFFSET_LIMIT = 200.0;
export const MIN_COIN_DISTANCE = 36.15;
export const STRIKE_SPEED = 4000;
export const FRICTION = 441.45;
export const RESTITUTION_COIN_COIN = 0.9;
export const RESTITUTION_STRIKER_COIN = 0.88;
export const RESTITUTION_CUSHION = 0.75;
export const POCKET_SPEED_LIMIT = 1800;
export const CAPTURE_COIN = POCKET_RADIUS - 0.2 * COIN_RADIUS;
export const CAPTURE_STRIKER = POCKET_RADIUS - 0.2 * STRIKER_RADIUS;
export const REST_SPEED = 0.5;
export const MAX_SIM_SECONDS = 12;
export const STEP_SECONDS = 1 / 240;
export const SUBSTEPS = 4;
export const FRAME_SAMPLE_SECONDS = 1 / 60;
export const MAX_SCORE = 25;
export const CLASSIC_BOARDS = 8;
export const EXTRA_BOARD = 9;

export const PIECE_IDS = [
  "striker",
  "queen",
  ...Array.from({ length: 9 }, (_, i) => `w${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `b${i + 1}`),
] as const;
export type PieceId = (typeof PIECE_IDS)[number];
export type PocketId = "nw" | "ne" | "sw" | "se";
export type Seat = 0 | 1;
export type Format = "quick" | "classic";
export type Colour = "white" | "black";

export interface Piece {
  id: PieceId;
  x: number;
  y: number;
  state: "board" | "pocketed";
  pocketedBy: Seat | null;
}

/** Board millimetres, one decimal, as the published data attributes carry. */
export function mm(value: number): number {
  return Math.round(value * 10) / 10;
}

export function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

export function round3(v: number): number {
  return Math.round(v * 1e3) / 1e3;
}

export function isCoinId(id: PieceId): boolean {
  return id.startsWith("w") || id.startsWith("b");
}

export function coinColour(id: PieceId): Colour {
  return id.startsWith("w") ? "white" : "black";
}

export function offsetToBoardX(seat: Seat, offset: number): number {
  return seat === 0 ? offset : -offset;
}

export function boardXToOffset(seat: Seat, x: number): number {
  return seat === 0 ? x : -x;
}

export function strikerBaselineY(seat: Seat): number {
  return seat === 0 ? BASELINE_Y : -BASELINE_Y;
}

/** Aim unit direction, rounded to 6 decimals, as seen by the shooter. */
export function aimVector(seat: Seat, angleDeg: number): { dx: number; dy: number } {
  const a = (angleDeg * Math.PI) / 180;
  const raw = seat === 0
    ? { dx: Math.sin(a), dy: -Math.cos(a) }
    : { dx: -Math.sin(a), dy: Math.cos(a) };
  return { dx: round6(raw.dx), dy: round6(raw.dy) };
}

/** A legal placement: in the offset range and at least 36.15 mm from every coin. */
export function isPlacementLegal(pieces: Piece[], seat: Seat, offset: number): boolean {
  const x = offsetToBoardX(seat, offset);
  if (Math.abs(x) > OFFSET_LIMIT + 1e-9) return false;
  const sy = strikerBaselineY(seat);
  for (const p of pieces) {
    if (p.state !== "board" || p.id === "striker") continue;
    const dx = p.x - x;
    const dy = p.y - sy;
    if (dx * dx + dy * dy < MIN_COIN_DISTANCE * MIN_COIN_DISTANCE - 1e-9) return false;
  }
  return true;
}

/** The aim guide's first contact along the striker's straight path. */
export function aimGuideFirstContact(
  pieces: Piece[],
  seat: Seat,
  offset: number,
  angleDeg: number
): { firstContact: PieceId | "cushion"; x: number; y: number } {
  const x = offsetToBoardX(seat, offset);
  const y = strikerBaselineY(seat);
  const { dx, dy } = aimVector(seat, angleDeg);
  let bestT = Infinity;
  let kind: PieceId | "cushion" = "cushion";
  for (const p of pieces) {
    if (p.state !== "board" || p.id === "striker") continue;
    const t = circleEntry(x, y, dx, dy, p.x, p.y, MIN_COIN_DISTANCE);
    if (t !== null && t >= 0 && t < bestT) {
      bestT = t;
      kind = p.id;
    }
  }
  const cushionT = cushionEntry(x, y, dx, dy);
  if (cushionT !== null && cushionT >= 0 && cushionT < bestT) {
    bestT = cushionT;
    kind = "cushion";
  }
  const t = Number.isFinite(bestT) ? bestT : 0;
  return { firstContact: kind, x: x + dx * t, y: y + dy * t };
}

function circleEntry(
  ox: number, oy: number, dx: number, dy: number,
  cx: number, cy: number, r: number
): number | null {
  const ex = cx - ox;
  const ey = cy - oy;
  const proj = ex * dx + ey * dy;
  if (proj <= 0) return null;
  const perp2 = ex * ex + ey * ey - proj * proj;
  if (perp2 > r * r) return null;
  return proj - Math.sqrt(r * r - perp2);
}

function cushionEntry(ox: number, oy: number, dx: number, dy: number): number | null {
  let best: number | null = null;
  const check = (t: number) => {
    if (t >= 0 && (best === null || t < best)) best = t;
  };
  if (dx > 0) check((CUSHION - ox) / dx);
  if (dx < 0) check((-CUSHION - ox) / dx);
  if (dy > 0) check((CUSHION - oy) / dy);
  if (dy < 0) check((-CUSHION - oy) / dy);
  return best;
}

/** The opening layout of 19 pieces. */
export function openingLayout(): Piece[] {
  const rows: [PieceId, number, number][] = [
    ["queen", 0, 0],
    ["w1", 31.2, 0], ["b1", 15.6, 27], ["w2", -15.6, 27],
    ["b2", -31.2, 0], ["w3", -15.6, -27], ["b3", 15.6, -27],
    ["w4", 62.4, 0], ["b4", 46.8, 27], ["b5", 31.2, 54],
    ["w5", 0, 54], ["w6", -31.2, 54], ["b6", -46.8, 27],
    ["b7", -62.4, 0], ["w7", -46.8, -27], ["w8", -31.2, -54],
    ["b8", 0, -54], ["b9", 31.2, -54], ["w9", 46.8, -27],
  ];
  return rows.map(([id, x, y]) => ({ id, x, y, state: "board", pocketedBy: null }) as Piece);
}

export function openingStriker(seat: Seat): { x: number; y: number } {
  return { x: 0, y: strikerBaselineY(seat) };
}

/** The opening board's 19 pieces plus the striker on the breaker's baseline. */
export function openingBoardPieces(breaker: Seat): Piece[] {
  return [
    ...openingLayout(),
    { id: "striker", x: 0, y: strikerBaselineY(breaker), state: "board", pocketedBy: null },
  ];
}

// ---------------------------------------------------------------------------
// dc-model-1: the fixed-step simulation.
// ---------------------------------------------------------------------------

export interface SimBody {
  id: PieceId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
}

export interface SimEvent {
  firstContact: PieceId | "cushion" | null;
  pocketed: { id: PieceId; pocket: PocketId }[];
  strikerPocketed: boolean;
}

export interface SimFrame {
  t: number;
  pieces: { id: PieceId; x: number; y: number }[];
}

export interface SimPieceFinal {
  id: PieceId;
  x: number | null;
  y: number | null;
  state: "board" | "pocketed";
}

export interface SimResult {
  events: SimEvent;
  frames: SimFrame[];
  final: SimPieceFinal[];
  durationSeconds: number;
  maxSpeedAtRest: number;
}

interface RunBody extends SimBody {
  pocketed: boolean;
}

const PIECE_ORDER: Map<PieceId, number> = new Map(
  PIECE_IDS.map((id, i) => [id, i] as const)
);

/**
 * Runs the simulation until every piece rests or the 12 second cap. Bodies are
 * handled in the published fixed order using only + - * / and sqrt, so the
 * same input always gives byte-identical output.
 */
export function simulate(bodies: SimBody[], sampleFrames: boolean): SimResult {
  const active: RunBody[] = [...bodies]
    .sort((a, b) => (PIECE_ORDER.get(a.id) ?? 99) - (PIECE_ORDER.get(b.id) ?? 99))
    .map((b) => ({ ...b, pocketed: false }));

  const pocketed: { id: PieceId; pocket: PocketId }[] = [];
  let firstContact: PieceId | "cushion" | null = null;
  const frames: SimFrame[] = [];
  const dt = STEP_SECONDS / SUBSTEPS;
  let t = 0;
  let nextSample = 0;
  let maxSpeedAtRest = 0;
  let ended = false;

  const recordFrame = () => {
    if (!sampleFrames) return;
    frames.push({
      t: round3(t),
      pieces: active.filter((b) => !b.pocketed).map((b) => ({ id: b.id, x: b.x, y: b.y })),
    });
  };
  recordFrame();

  const limit = MAX_SIM_SECONDS - dt / 2;
  while (t < limit && !ended) {
    for (let s = 0; s < SUBSTEPS; s++) {
      for (const b of active) {
        if (b.pocketed) continue;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
      }
      // sliding friction: a constant deceleration against the motion
      for (const b of active) {
        if (b.pocketed) continue;
        const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        if (speed > 0) {
          const drop = FRICTION * dt;
          if (speed <= drop) {
            b.vx = 0;
            b.vy = 0;
          } else {
            const k = (speed - drop) / speed;
            b.vx *= k;
            b.vy *= k;
          }
        }
      }
      // pocket capture
      for (const b of active) {
        if (b.pocketed) continue;
        if (Math.sqrt(b.vx * b.vx + b.vy * b.vy) >= POCKET_SPEED_LIMIT) continue;
        const reach = b.id === "striker" ? CAPTURE_STRIKER : CAPTURE_COIN;
        for (const pid of ["nw", "ne", "sw", "se"] as PocketId[]) {
          const c = POCKET_CENTERS[pid];
          const dx = b.x - c.x;
          const dy = b.y - c.y;
          if (dx * dx + dy * dy <= reach * reach) {
            b.pocketed = true;
            b.vx = 0;
            b.vy = 0;
            pocketed.push({ id: b.id, pocket: pid });
            break;
          }
        }
      }
      // cushions and pairwise impulses
      for (let i = 0; i < active.length; i++) {
        const a = active[i];
        if (a.pocketed) continue;
        if (applyCushion(a) && a.id === "striker" && firstContact === null) {
          firstContact = "cushion";
        }
        for (let j = i + 1; j < active.length; j++) {
          const b = active[j];
          if (b.pocketed) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const r = a.radius + b.radius;
          const d2 = dx * dx + dy * dy;
          if (d2 <= 0 || d2 > r * r) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          const rvx = b.vx - a.vx;
          const rvy = b.vy - a.vy;
          const vn = rvx * nx + rvy * ny;
          const strikerIn = a.id === "striker" || b.id === "striker";
          if (vn < 0) {
            const e = strikerIn ? RESTITUTION_STRIKER_COIN : RESTITUTION_COIN_COIN;
            const impulse = (-(1 + e) * vn) / (1 / a.mass + 1 / b.mass);
            a.vx -= (impulse / a.mass) * nx;
            a.vy -= (impulse / a.mass) * ny;
            b.vx += (impulse / b.mass) * nx;
            b.vy += (impulse / b.mass) * ny;
          }
          const overlap = r - d;
          a.x -= nx * overlap * (b.mass / (a.mass + b.mass));
          a.y -= ny * overlap * (b.mass / (a.mass + b.mass));
          b.x += nx * overlap * (a.mass / (a.mass + b.mass));
          b.y += ny * overlap * (a.mass / (a.mass + b.mass));
          if (strikerIn && firstContact === null) {
            firstContact = a.id === "striker" ? b.id : a.id;
          }
        }
      }
      t = round6(t + dt);
      while (nextSample <= t + 1e-12) {
        recordFrame();
        nextSample += FRAME_SAMPLE_SECONDS;
      }
      // rest
      let allRest = true;
      let maxSpeed = 0;
      for (const b of active) {
        if (b.pocketed) continue;
        const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        if (sp > maxSpeed) maxSpeed = sp;
        if (sp >= REST_SPEED) allRest = false;
      }
      maxSpeedAtRest = maxSpeed;
      if (allRest) {
        ended = true;
        break;
      }
    }
  }

  const final: SimPieceFinal[] = active.map((b) => ({
    id: b.id,
    x: b.pocketed ? null : mm(b.x),
    y: b.pocketed ? null : mm(b.y),
    state: b.pocketed ? "pocketed" : "board",
  }));

  return {
    events: {
      firstContact,
      pocketed,
      strikerPocketed: pocketed.some((p) => p.id === "striker"),
    },
    frames,
    final,
    durationSeconds: t,
    maxSpeedAtRest,
  };
}

function applyCushion(b: RunBody): boolean {
  const limit = CUSHION - b.radius;
  let hit = false;
  if (b.x < -limit && b.vx < 0) {
    b.x = -limit;
    b.vx = -b.vx * RESTITUTION_CUSHION;
    hit = true;
  } else if (b.x > limit && b.vx > 0) {
    b.x = limit;
    b.vx = -b.vx * RESTITUTION_CUSHION;
    hit = true;
  }
  if (b.y < -limit && b.vy < 0) {
    b.y = -limit;
    b.vy = -b.vy * RESTITUTION_CUSHION;
    hit = true;
  } else if (b.y > limit && b.vy > 0) {
    b.y = limit;
    b.vy = -b.vy * RESTITUTION_CUSHION;
    hit = true;
  }
  return hit;
}

/** A strike's bodies, ready for the simulation. */
export function strikeBodies(
  pieces: Piece[],
  seat: Seat,
  x: number,
  dx: number,
  dy: number,
  p: number
): SimBody[] {
  const bodies: SimBody[] = [];
  for (const piece of pieces) {
    if (piece.state === "pocketed") continue;
    if (piece.id === "striker") {
      bodies.push({
        id: "striker",
        x: offsetToBoardX(seat, x),
        y: strikerBaselineY(seat),
        vx: dx * STRIKE_SPEED * p,
        vy: dy * STRIKE_SPEED * p,
        radius: STRIKER_RADIUS,
        mass: STRIKER_MASS,
      });
    } else {
      bodies.push({
        id: piece.id,
        x: piece.x,
        y: piece.y,
        vx: 0,
        vy: 0,
        radius: COIN_RADIUS,
        mass: COIN_MASS,
      });
    }
  }
  return bodies;
}

export function intentValid(intent: { x: number; dx: number; dy: number; p: number }): boolean {
  if (!Number.isFinite(intent.x) || Math.abs(intent.x) > OFFSET_LIMIT + 1e-9) return false;
  if (Math.abs(intent.x * 2 - Math.round(intent.x * 2)) > 1e-9) return false;
  if (!Number.isFinite(intent.dx) || !Number.isFinite(intent.dy)) return false;
  const len = Math.sqrt(intent.dx * intent.dx + intent.dy * intent.dy);
  if (Math.abs(len - 1) > 0.001) return false;
  if (!Number.isFinite(intent.p) || intent.p < 0 || intent.p > 1) return false;
  if (Math.abs(intent.p * 1000 - Math.round(intent.p * 1000)) > 1e-9) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The laws of a shot and of the board.
// ---------------------------------------------------------------------------

export type QueenState = { state: "board" | "pending" | "covered"; seat: Seat | null };

export interface BoardState {
  pieces: Piece[];
  turn: Seat;
  scores: [number, number];
  dues: [number, number];
  timeouts: [number, number];
  queen: QueenState;
  breakAttempt: number | null;
  boardNumber: number;
  format: Format;
  whiteSeat: Seat;
}

export interface BoardEnd {
  winnerSeat: Seat;
  loserSeat: Seat;
  points: number;
  pointsLine: string;
}

export interface Ruling {
  word: string;
  line: string;
  pieces: Piece[];
  dues: [number, number];
  queen: QueenState;
  turn: Seat;
  breakAttempt: number | null;
  samePlayer: boolean;
  boardEnd: BoardEnd | null;
  matchOver: boolean;
}

/** A seat's colour word on this board. */
export function seatColour(state: BoardState, seat: Seat): Colour {
  return seat === state.whiteSeat ? "white" : "black";
}

/** A seat's coins left: its colour's coins on the board. */
export function coinsLeft(state: BoardState, seat: Seat): number {
  const colour = seatColour(state, seat);
  return state.pieces.filter(
    (p) => isCoinId(p.id) && coinColour(p.id) === colour && p.state === "board"
  ).length;
}

/** The first free return spot: the centre, else the published spiral. */
export function returnSpot(pieces: Piece[]): { x: number; y: number } {
  if (spotFree(pieces, 0, 0)) return { x: 0, y: 0 };
  for (let radius = 35; radius <= 320; radius += 5) {
    for (let a = 0; a <= 330; a += 30) {
      const rad = (a * Math.PI) / 180;
      const x = radius * Math.cos(rad);
      const y = radius * Math.sin(rad);
      if (spotFree(pieces, x, y)) return { x: mm(x), y: mm(y) };
    }
  }
  return { x: 0, y: 0 };
}

function spotFree(pieces: Piece[], x: number, y: number): boolean {
  for (const p of pieces) {
    if (p.state !== "board" || p.id === "striker") continue;
    const dx = p.x - x;
    const dy = p.y - y;
    if (dx * dx + dy * dy < 31.1 * 31.1 - 1e-9) return false;
  }
  return true;
}

function withPiece(pieces: Piece[], id: PieceId, patch: Partial<Piece>): Piece[] {
  return pieces.map((p) => (p.id === id ? { ...p, ...patch } : p));
}

function placeOnBoard(pieces: Piece[], id: PieceId): Piece[] {
  let next = withPiece(pieces, id, { state: "board", pocketedBy: null });
  const spot = returnSpot(next);
  return withPiece(next, id, { x: spot.x, y: spot.y });
}

function coinNumber(id: PieceId): number {
  return parseInt(id.slice(1), 10);
}

/** The shooter's lowest-numbered own coin pocketed before this shot. */
function lowestPocketedOwnCoin(pieces: Piece[], colour: Colour, seat: Seat): PieceId | null {
  const candidates = pieces
    .filter(
      (p) =>
        isCoinId(p.id) &&
        coinColour(p.id) === colour &&
        p.state === "pocketed" &&
        p.pocketedBy === seat
    )
    .sort((a, b) => coinNumber(a.id) - coinNumber(b.id));
  return candidates.length > 0 ? candidates[0].id : null;
}

function ownCoinsDown(pieces: Piece[], colour: Colour): number {
  return pieces.filter(
    (p) => isCoinId(p.id) && coinColour(p.id) === colour && p.state === "pocketed"
  ).length;
}

function coinIdsOfColour(ids: PieceId[], colour: Colour): PieceId[] {
  return ids.filter((id) => isCoinId(id) && coinColour(id) === colour);
}

function nextStriker(pieces: Piece[], nextTurn: Seat): Piece[] {
  return pieces.map((p) =>
    p.id === "striker"
      ? { ...p, x: 0, y: strikerBaselineY(nextTurn), state: "board", pocketedBy: null }
      : p
  );
}

/**
 * Rules one shot from its events. Exactly one law applies, in the published
 * order, and the returned board is the board after the ruling.
 */
export function ruleShot(state: BoardState, events: SimEvent): Ruling {
  const seat = state.turn;
  const opponent = (1 - seat) as Seat;
  const shooterColour = seatColour(state, seat);
  const opponentColour: Colour = shooterColour === "white" ? "black" : "white";

  const pocketedIds = events.pocketed.map((p) => p.id);
  const ownPocketedNow = coinIdsOfColour(pocketedIds, shooterColour);
  const opponentPocketedNow = coinIdsOfColour(pocketedIds, opponentColour);
  const queenPocketedNow = pocketedIds.includes("queen");

  // pieces already carry the simulation's positions; mark the pockets
  let pieces = state.pieces.map((p): Piece => {
    if (!pocketedIds.includes(p.id)) return p;
    if (p.id === "queen") return { ...p, state: "pocketed", pocketedBy: seat };
    if (coinColour(p.id) === shooterColour) return { ...p, state: "pocketed", pocketedBy: seat };
    return { ...p, state: "pocketed", pocketedBy: opponent };
  });

  let dues: [number, number] = [...state.dues] as [number, number];
  let queen: QueenState = { ...state.queen };

  const queenReturns = () => {
    pieces = placeOnBoard(pieces, "queen");
    queen = { state: "board", seat: null };
  };

  // 10. break miss
  if (
    state.breakAttempt !== null &&
    pocketedIds.length === 0 &&
    (events.firstContact === null || events.firstContact === "cushion")
  ) {
    const attempt = state.breakAttempt;
    if (attempt >= 3) {
      return {
        word: "NO POCKET",
        line: "Break missed 3 times. Turn passes.",
        pieces: nextStriker(pieces, opponent),
        dues,
        queen,
        turn: opponent,
        breakAttempt: null,
        samePlayer: false,
        boardEnd: null,
        matchOver: false,
      };
    }
    return {
      word: "NO POCKET",
      line: `Break missed. Attempt ${attempt + 1} of 3.`,
      pieces,
      dues,
      queen,
      turn: seat,
      breakAttempt: attempt + 1,
      samePlayer: true,
      boardEnd: null,
      matchOver: false,
    };
  }

  let turnEnds = true;
  let word = "";
  let line = "";

  if (events.strikerPocketed) {
    // 1. striker pocketed (foul)
    if (queenPocketedNow || queen.state === "pending") queenReturns();
    const ownNow = ownPocketedNow.length > 0;
    for (const id of ownPocketedNow) pieces = placeOnBoard(pieces, id);
    const dueCoin = lowestPocketedOwnCoin(pieces, shooterColour, seat);
    if (dueCoin !== null) {
      pieces = placeOnBoard(pieces, dueCoin);
      dues[seat] = Math.max(0, dues[seat] - 1);
    } else {
      dues[seat] = dues[seat] + 1;
    }
    if (ownNow) {
      word = "FOUL";
      line = "Foul: striker pocketed. Your pocketed coins return with one due coin. Shoot again.";
      turnEnds = false;
    } else {
      word = "FOUL";
      line = dueCoin !== null
        ? "Foul: striker pocketed. One due coin returns to the centre."
        : "Foul: striker pocketed. One due coin is owed.";
      turnEnds = true;
    }
  } else if (queenPocketedNow && ownCoinsDown(pieces, shooterColour) === 0) {
    // 2. queen pocketed early
    queenReturns();
    word = "RETURNED";
    line = "Queen returned. Pocket one of your own coins first.";
    turnEnds = true;
  } else if (queenPocketedNow && ownPocketedNow.length > 0) {
    // 3. queen and an own coin on the same shot
    queen = { state: "covered", seat };
    word = "COVERED";
    line = "Queen covered.";
    turnEnds = false;
  } else if (queenPocketedNow) {
    // 4. queen pocketed without an own coin
    queen = { state: "pending", seat };
    word = "POCKETED";
    line = "Queen pocketed. Cover her with your next pocket.";
    turnEnds = false;
  } else if (queen.state === "pending" && queen.seat === seat) {
    // 5. shot after the queen was pocketed
    if (ownPocketedNow.length > 0) {
      queen = { state: "covered", seat };
      word = "COVERED";
      line = "Queen covered.";
      turnEnds = false;
    } else {
      queenReturns();
      word = "RETURNED";
      line = "Queen not covered. She returns to the centre.";
      turnEnds = true;
    }
  } else if (dues[seat] > 0 && ownPocketedNow.length > 0) {
    // 6. due owed and own coins pocketed
    const lowest = [...ownPocketedNow].sort((a, b) => coinNumber(a) - coinNumber(b))[0];
    pieces = placeOnBoard(pieces, lowest);
    dues[seat] = dues[seat] - 1;
    word = "POCKETED";
    line = "Due paid: one coin returns to the centre. Shoot again.";
    turnEnds = false;
  } else if (ownPocketedNow.length > 0) {
    // 7. own coins pocketed
    word = "POCKETED";
    line = ownPocketedNow.length === 1
      ? "1 coin pocketed. Shoot again."
      : `${ownPocketedNow.length} coins pocketed. Shoot again.`;
    turnEnds = false;
  } else if (opponentPocketedNow.length > 0) {
    // 8. only opponent coins pocketed
    word = "NO POCKET";
    line = "Opponent's coin pocketed. Turn passes.";
    turnEnds = true;
  } else {
    // 9. nothing pocketed
    word = "NO POCKET";
    line = "Nothing pocketed. Turn passes.";
    turnEnds = true;
  }

  const nextTurn: Seat = turnEnds ? opponent : seat;
  const boardEnd = boardEndCheck(state, pieces, seat, shooterColour, queen);
  const matchOver = boardEnd !== null && matchOverCheck(state, boardEnd);

  return {
    word,
    line,
    pieces: nextStriker(pieces, nextTurn),
    dues,
    queen,
    turn: nextTurn,
    breakAttempt: null,
    samePlayer: !turnEnds,
    boardEnd,
    matchOver,
  };
}

/** Board end, checked after the ruling with the board as it now stands. */
export function boardEndCheck(
  state: BoardState,
  pieces: Piece[],
  shooter: Seat,
  shooterColour: Colour,
  queen: QueenState
): BoardEnd | null {
  const shooterCoinsLeft = pieces.filter(
    (p) => isCoinId(p.id) && coinColour(p.id) === shooterColour && p.state === "board"
  ).length;
  const opponentColour: Colour = shooterColour === "white" ? "black" : "white";
  const opponentCoinsLeft = pieces.filter(
    (p) => isCoinId(p.id) && coinColour(p.id) === opponentColour && p.state === "board"
  ).length;
  if (shooterCoinsLeft > 0 && opponentCoinsLeft > 0) return null;

  const opponent = (1 - shooter) as Seat;
  if (opponentCoinsLeft === 0) {
    // the opponent's-last-coin rule wins when both apply
    const points = shooterCoinsLeft + 3;
    return {
      winnerSeat: opponent,
      loserSeat: shooter,
      points,
      pointsLine: `${points} points: ${shooterCoinsLeft} coins left + 3 penalty`,
    };
  }
  if (queen.state === "covered") {
    const queenBonus = queen.seat === shooter && state.scores[shooter] < 22 ? 3 : 0;
    const points = opponentCoinsLeft + queenBonus;
    return {
      winnerSeat: shooter,
      loserSeat: opponent,
      points,
      pointsLine:
        queenBonus > 0
          ? `${points} points: ${opponentCoinsLeft} coins left + 3 for the queen`
          : `${points} points: ${opponentCoinsLeft} coins left`,
    };
  }
  const points = shooterCoinsLeft + 3;
  return {
    winnerSeat: opponent,
    loserSeat: shooter,
    points,
    pointsLine: `${points} points: ${shooterCoinsLeft} coins left + 3 penalty`,
  };
}

/** Whether a board end also ends the match. */
export function matchOverCheck(state: BoardState, boardEnd: BoardEnd): boolean {
  if (state.format === "quick") return true;
  const winnerScore = state.scores[boardEnd.winnerSeat] + boardEnd.points;
  if (winnerScore >= MAX_SCORE) return true;
  if (state.boardNumber >= CLASSIC_BOARDS) {
    const a = state.scores[0] + (boardEnd.winnerSeat === 0 ? boardEnd.points : 0);
    const b = state.scores[1] + (boardEnd.winnerSeat === 1 ? boardEnd.points : 0);
    return a !== b;
  }
  return false;
}

/** Whether a tie after board 8 calls for the extra board. */
export function extraBoardNeeded(state: BoardState, boardEnd: BoardEnd): boolean {
  if (state.format !== "classic") return false;
  if (state.boardNumber !== CLASSIC_BOARDS) return false;
  const a = state.scores[0] + (boardEnd.winnerSeat === 0 ? boardEnd.points : 0);
  const b = state.scores[1] + (boardEnd.winnerSeat === 1 ? boardEnd.points : 0);
  return a === b;
}

/** The next board's state, from the opening layout. */
export function nextBoard(
  state: BoardState,
  boardEnd: BoardEnd,
  boardNumber: number
): BoardState {
  const scores: [number, number] = [...state.scores] as [number, number];
  scores[boardEnd.winnerSeat] += boardEnd.points;
  const breaker = boardEnd.loserSeat;
  return {
    pieces: [
      ...openingLayout(),
      { id: "striker", x: 0, y: strikerBaselineY(breaker), state: "board", pocketedBy: null },
    ],
    turn: breaker,
    scores,
    dues: [0, 0],
    timeouts: [0, 0],
    queen: { state: "board", seat: null },
    breakAttempt: 1,
    boardNumber,
    format: state.format,
    whiteSeat: breaker,
  };
}

/** The board label, as the match screen shows it. */
export function boardLabel(format: Format, boardNumber: number): string {
  if (format === "quick") return "Board 1 of 1";
  if (boardNumber === EXTRA_BOARD) return "Extra board";
  return `Board ${boardNumber} of 8`;
}
