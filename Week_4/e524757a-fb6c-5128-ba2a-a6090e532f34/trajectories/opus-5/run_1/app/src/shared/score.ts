import type { FrameVector } from './frame.js';
import type { Heading } from './islands.js';

export type Score = { size: number; centring: number; facing: number; sharpness: number; total: number };
export type CreatureFacing = 'toward' | 'side' | 'away';

const OPPOSITE: Record<Heading, Heading> = { N: 'S', E: 'W', S: 'N', W: 'E' };

export function creatureFacing(explorerHeading: Heading, creatureHeading: Heading): CreatureFacing {
  if (creatureHeading === OPPOSITE[explorerHeading]) return 'toward';
  if (creatureHeading === explorerHeading) return 'away';
  return 'side';
}

export type ScoreInput = {
  vector: FrameVector;
  zoom: number;
  focus: number;
  creatureSize: number;
  facing: CreatureFacing;
};

/** The published score rule: the one place a photo's points are decided. */
export function scorePhoto(input: ScoreInput): Score {
  const { vector, zoom, focus, creatureSize, facing } = input;
  const a = vector.forward;
  const size = Math.max(0, 30 - 10 * Math.abs(a - 2 * zoom * creatureSize));
  const centring = Math.max(0, 25 - 10 * Math.abs(vector.lateral) * zoom);
  const facingPoints = facing === 'toward' ? 25 : facing === 'side' ? 15 : 0;
  const sharpness = Math.max(0, 20 - 5 * Math.abs(focus - a));
  return {
    size,
    centring,
    facing: facingPoints,
    sharpness,
    total: size + centring + facingPoints + sharpness,
  };
}
