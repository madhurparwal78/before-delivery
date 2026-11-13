/** Browser-only practice: the rack store and the AI. Rulings come from the same shared rules module the server uses. */
import { BALL_RADIUS, CUE_BALL, POCKET_ENTRIES, aimTowards, predictContact, rackSpots, type BallSpots, type Point } from '../../shared/physics';
import type { Pocket } from '../../shared/domain';
import { legalFirstBall, type Rack, type Seat } from '../../shared/rules';

export const DIFFICULTIES = ['Rookie', 'Regular', 'Shark'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export type PracticeKind = Difficulty | 'Free table';

const AIM_NOISE: Record<Difficulty, number> = { Rookie: 7, Regular: 2.6, Shark: 0.5 };
const RACK_KEY = 'hs_rack';
const START_KEY = 'hs_practice_start';

export const AI_SEAT: Seat = 1;
export const PLAYER_SEAT: Seat = 2;

interface SavedRack {
  difficulty: Difficulty;
  rack: Rack;
  spots: BallSpots;
}

export function savedRack(): SavedRack | null {
  const raw = localStorage.getItem(RACK_KEY);
  return raw === null ? null : (JSON.parse(raw) as SavedRack);
}

export function saveRack(rack: SavedRack): void {
  localStorage.setItem(RACK_KEY, JSON.stringify(rack));
}

export function clearRack(): void {
  localStorage.removeItem(RACK_KEY);
}

export function beginPractice(kind: PracticeKind, resume: boolean): void {
  if (!resume) clearRack();
  sessionStorage.setItem(START_KEY, kind);
}

export function practiceKind(): PracticeKind | null {
  return (sessionStorage.getItem(START_KEY) ?? savedRack()?.difficulty ?? null) as PracticeKind | null;
}

export function freshPracticeRack(): { rack: Rack; spots: BallSpots } {
  const balls = Array.from({ length: 15 }, (_, index) => index + 1);
  return {
    rack: { mode: 'eight-ball', phase: 'break', groups: { 1: null, 2: null }, balls, activeSeat: AI_SEAT, ballInHand: false, behindHeadString: false },
    spots: rackSpots(balls),
  };
}

interface AiShot {
  aimDegrees: number;
  power: number;
  calledPocket: Pocket | null;
}

function pathClear(spots: BallSpots, from: Point, to: Point, ignore: number): boolean {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const dx = (to[0] - from[0]) / length;
  const dy = (to[1] - from[1]) / length;
  return Object.entries(spots).every(([key, [x, y]]) => {
    if (Number(key) === ignore || Number(key) === CUE_BALL) return true;
    const along = (x - from[0]) * dx + (y - from[1]) * dy;
    if (along < 0 || along > length) return true;
    return Math.abs((x - from[0]) * dy - (y - from[1]) * dx) > BALL_RADIUS * 2;
  });
}

interface Plan {
  aim: number;
  score: number;
  pocket: Pocket;
}

/** Scores every ball-to-pocket line the cue ball can reach and picks the straightest; difficulty only adds aim noise. */
export function chooseAiShot(rack: Rack, spots: BallSpots, difficulty: Difficulty): AiShot {
  const cue = spots[CUE_BALL];
  const noisy = (aim: number): number => (aim + (Math.random() - 0.5) * 2 * AIM_NOISE[difficulty] + 360) % 360;
  if (rack.phase === 'break') return { aimDegrees: noisy(0), power: 100, calledPocket: null };

  const seat = rack.activeSeat;
  const plans: Plan[] = [];
  for (const ball of rack.balls) {
    if (!legalFirstBall(rack, seat, ball)) continue;
    const target = spots[ball];
    for (const [pocket, spot] of POCKET_ENTRIES) {
      const distance = Math.hypot(spot[0] - target[0], spot[1] - target[1]);
      const ghost: Point = [
        target[0] - ((spot[0] - target[0]) / distance) * BALL_RADIUS * 2,
        target[1] - ((spot[1] - target[1]) / distance) * BALL_RADIUS * 2,
      ];
      if (!pathClear(spots, ghost, spot, ball) || !pathClear(spots, cue, ghost, ball)) continue;
      const aim = aimTowards(cue, ghost);
      const contact = predictContact(spots, aim);
      if (contact.ball !== ball) continue;
      plans.push({ aim, pocket, score: contact.cut + distance * 0.2 });
    }
  }
  plans.sort((a, b) => a.score - b.score);
  const best = plans[0];
  if (best !== undefined) return { aimDegrees: noisy(best.aim), power: 62, calledPocket: best.pocket };
  const fallback = rack.balls.find((ball) => legalFirstBall(rack, seat, ball)) ?? rack.balls[0];
  return { aimDegrees: noisy(aimTowards(cue, spots[fallback])), power: 58, calledPocket: 'top-left' };
}
