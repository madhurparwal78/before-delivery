import type { Confirmed, Operation } from '../../shared/api';

export interface Preview {
  /** Preview volume in cubic millimetres, or undefined when it cannot be estimated (Intersect). */
  volume: number | undefined;
  mass: number | undefined;
}

/**
 * Preview figures while a depth is dragged or typed: the confirmed volume plus (or, for Cut, minus) the profile
 * area times the change in depth; a part with no confirmed body starts from 0; Intersect cannot be estimated.
 */
export function previewFigures(args: {
  confirmed: Confirmed | null;
  densityGPerCm3: number;
  profileAreaMm2: number;
  depthMm: number;
  committedDepthMm: number;
  operation: Operation;
}): Preview {
  if (args.operation === 'intersect') return { volume: undefined, mass: undefined };
  const change = args.profileAreaMm2 * (args.depthMm - args.committedDepthMm);
  const start = args.confirmed?.volume_mm3 ?? 0;
  const volume = args.operation === 'cut' ? start - change : start + change;
  return { volume, mass: (volume * args.densityGPerCm3) / 1000 };
}
