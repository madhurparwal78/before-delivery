import type { Mode, PocketName } from '../../shared/types.js';

export interface Ball {
  number: number;
  across: number; // 0..100 left cushion to right cushion
  along: number; // 0..100 head-end to foot-end
}

export const CUSHION_MARGIN = 4;
export const BALL_RADIUS = 2.85;

export const POCKET_POSITIONS: Record<PocketName, { across: number; along: number }> = {
  'top-left': { across: 0, along: 100 },
  'top-right': { across: 100, along: 100 },
  'middle-left': { across: 0, along: 50 },
  'middle-right': { across: 100, along: 50 },
  'bottom-left': { across: 0, along: 0 },
  'bottom-right': { across: 100, along: 0 },
};

export type Phase = 'break' | 'open' | 'groups';

export interface TableState {
  mode: Mode;
  phase: Phase;
  groups: { 1: 'solids' | 'stripes' | null; 2: 'solids' | 'stripes' | null };
  balls: Ball[];
  cueBall: { across: number; along: number };
}

export interface TraceResult {
  firstContact: number | null;
  cutAngle: number;
  contactPoint: { across: number; along: number } | null;
  cushionFirst: boolean;
  pocketed: { ball: number; pocket: PocketName }[];
  path: { across: number; along: number }[];
  cueBallRest: { across: number; along: number };
  offTable: number[];
  ballsAtRest: Ball[];
  cushionAfterContact: boolean;
  cueScratch: boolean;
}

export function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function groupOf(ball: number): 'solids' | 'stripes' | null {
  if (ball >= 1 && ball <= 7) return 'solids';
  if (ball >= 9 && ball <= 15) return 'stripes';
  return null;
}

export function otherGroup(group: 'solids' | 'stripes'): 'solids' | 'stripes' {
  return group === 'solids' ? 'stripes' : 'solids';
}

export function ballsLeftForSeat(state: TableState, seat: 1 | 2): number {
  if (state.mode === 'nine-ball') {
    return state.balls.filter((b) => b.number !== 0).length;
  }
  const group = seat === 1 ? state.groups[1] : state.groups[2];
  if (state.phase !== 'groups' || group === null) {
    return state.balls.filter((b) => b.number !== 8).length;
  }
  return state.balls.filter((b) => groupOf(b.number) === group && b.number !== 8).length;
}

export function lowestBall(state: TableState): number | null {
  const object = state.balls.filter((b) => b.number !== 0).map((b) => b.number);
  return object.length ? Math.min(...object) : null;
}

export function ballInHandDefault(): { across: number; along: number } {
  return { across: 50, along: 25 };
}

export function cueOverlap(state: TableState, across: number, along: number): boolean {
  for (const ball of state.balls) {
    if (ball.number === 0) continue;
    if (Math.hypot(ball.across - across, ball.along - along) < 2 * BALL_RADIUS) return true;
  }
  return false;
}

function settle(pos: { across: number; along: number }): { pos: { across: number; along: number }; off: boolean; hitCushion: boolean } {
  let hitCushion = false;
  let across = pos.across;
  let along = pos.along;
  if (across < -8 || across > 108 || along < -8 || along > 108) return { pos: { across, along }, off: true, hitCushion: false };
  if (across < CUSHION_MARGIN) { across = CUSHION_MARGIN; hitCushion = true; }
  if (across > 100 - CUSHION_MARGIN) { across = 100 - CUSHION_MARGIN; hitCushion = true; }
  if (along < CUSHION_MARGIN) { along = CUSHION_MARGIN; hitCushion = true; }
  if (along > 100 - CUSHION_MARGIN) { along = 100 - CUSHION_MARGIN; hitCushion = true; }
  return { pos: { across, along }, off: false, hitCushion };
}

function nearPocket(pos: { across: number; along: number }): PocketName | null {
  for (const [name, p] of Object.entries(POCKET_POSITIONS) as [PocketName, { across: number; along: number }][]) {
    if (Math.hypot(pos.across - p.across, pos.along - p.along) < 7) return name;
  }
  return null;
}

/**
 * A trace walks the cue ball along the aim line until it meets a ball or a
 * cushion, then resolves simple scatter: the struck ball is driven along the
 * line of centres and the cue ball deflects on the tangent line. Balls that
 * reach a pocket fall in; balls that leave the table leave.
 */
export function traceShot(state: TableState, aimDegrees: number, power: number, sideSpin: number, topSpin: number): TraceResult {
  const balls = state.balls.map((b) => ({ ...b }));
  const cue = state.cueBall;
  const angle = (normalizeAngle(aimDegrees) * Math.PI) / 180;
  const dirX = Math.sin(angle);
  const dirY = Math.cos(angle);
  const path: { across: number; along: number }[] = [{ across: cue.across, along: cue.along }];
  const pocketed: { ball: number; pocket: PocketName }[] = [];
  const offTable: number[] = [];
  const speed = Math.max(power, 1) / 100;

  let firstContact: number | null = null;
  let contactPoint: { across: number; along: number } | null = null;
  let cutAngle = 0;
  let cushionFirst = false;
  let cueBallRest = { across: cue.across, along: cue.along };
  let cueScratch = false;

  let best: { t: number; ball: Ball; point: { across: number; along: number } } | null = null;
  for (const ball of balls) {
    if (ball.number === 0) continue;
    const rel = { across: ball.across - cue.across, along: ball.along - cue.along };
    const proj = rel.across * dirX + rel.along * dirY;
    if (proj <= 0) continue;
    const perpDist = Math.abs(rel.across * dirY - rel.along * dirX);
    if (perpDist > 2 * BALL_RADIUS) continue;
    const t = proj - Math.sqrt(Math.max(0, 4 * BALL_RADIUS * BALL_RADIUS - perpDist * perpDist));
    if (t < 0) continue;
    if (!best || t < best.t) {
      best = { t, ball, point: { across: cue.across + dirX * t, along: cue.along + dirY * t } };
    }
  }

  let tCushion = Infinity;
  if (dirX > 0) tCushion = Math.min(tCushion, (100 - CUSHION_MARGIN - cue.across) / dirX);
  if (dirX < 0) tCushion = Math.min(tCushion, (cue.across - CUSHION_MARGIN) / -dirX);
  if (dirY > 0) tCushion = Math.min(tCushion, (100 - CUSHION_MARGIN - cue.along) / dirY);
  if (dirY < 0) tCushion = Math.min(tCushion, (cue.along - CUSHION_MARGIN) / -dirY);

  if (best && best.t < tCushion) {
    firstContact = best.ball.number;
    contactPoint = best.point;
    const lineCentres = { across: best.ball.across - best.point.across, along: best.ball.along - best.point.along };
    const len = Math.hypot(lineCentres.across, lineCentres.along) || 1;
    const dot = (dirX * lineCentres.across + dirY * lineCentres.along) / len;
    cutAngle = Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);
    path.push({ across: best.point.across, along: best.point.along });

    const objDist = speed * (140 - Math.abs(cutAngle) * 1.2);
    const objEnd = {
      across: best.ball.across + (lineCentres.across / len) * objDist,
      along: best.ball.along + (lineCentres.along / len) * objDist,
    };
    let cushionAfterContact = false;
    const settledObj = settle(objEnd);
    if (settledObj.off) {
      offTable.push(best.ball.number);
      balls.splice(balls.findIndex((b) => b.number === best.ball.number), 1);
    } else {
      const pocket = nearPocket(settledObj.pos);
      if (pocket) {
        pocketed.push({ ball: best.ball.number, pocket });
        balls.splice(balls.findIndex((b) => b.number === best.ball.number), 1);
      } else {
        if (settledObj.hitCushion) cushionAfterContact = true;
        const moved = balls.find((b) => b.number === best.ball.number);
        if (moved) {
          moved.across = settledObj.pos.across;
          moved.along = settledObj.pos.along;
        }
      }
    }

    const tangent = { across: -lineCentres.along / len, along: lineCentres.across / len };
    const side = sideSpin >= 0 ? -1 : 1;
    const spinMix = Math.abs(sideSpin) / 300;
    const tangentEnd = {
      across: best.point.across + (tangent.across * side * (1 + spinMix) + (lineCentres.across / len) * (topSpin / 400)) * speed * 60,
      along: best.point.along + (tangent.along * side * (1 + spinMix) + (lineCentres.along / len) * (topSpin / 400)) * speed * 60,
    };
    const settledCue = settle(tangentEnd);
    if (settledCue.off) {
      offTable.push(0);
      cueScratch = true;
    } else {
      const cuePocket = nearPocket(settledCue.pos);
      if (cuePocket) {
        cueScratch = true;
      } else {
        if (settledCue.hitCushion) cushionAfterContact = true;
        cueBallRest = settledCue.pos;
      }
    }
    return { firstContact, cutAngle, contactPoint, cushionFirst, pocketed, path, cueBallRest, offTable, ballsAtRest: balls, cushionAfterContact, cueScratch };
  }

  cushionFirst = true;
  const end = {
    across: cue.across + dirX * Math.min(tCushion * 1.6, 200),
    along: cue.along + dirY * Math.min(tCushion * 1.6, 200),
  };
  const settled = settle(end);
  if (settled.off) {
    offTable.push(0);
    cueScratch = true;
  } else {
    const p = nearPocket(settled.pos);
    if (p) {
      cueScratch = true;
    } else {
      cueBallRest = settled.pos;
    }
  }
  return { firstContact: null, cutAngle: 0, contactPoint: null, cushionFirst, pocketed, path, cueBallRest, offTable, ballsAtRest: balls, cushionAfterContact: false, cueScratch };
}
