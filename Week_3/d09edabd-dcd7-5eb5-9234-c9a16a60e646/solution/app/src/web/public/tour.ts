import { prefersReducedMotion } from '../ui/hooks';
import { blendPose, eyePose, overviewPose, startStance } from '../three/poses';
import type { Pose } from '../three/roomView';
import { VAULT_CHAIN, VAULT_DIMS, VAULT_PLACEMENTS } from './vault';

const OVERVIEW_YAW_DEG = 30;
const OVERVIEW_PITCH_DEG = 35;

const CUE_COUNT = VAULT_CHAIN.length;

/** The scrolled fraction of the page, from 0 at the top to 1 at the sign-up sheet. */
export function scrollProgress(): number {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  return scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
}

/** Cue k of the six is lit once progress reaches k/7. */
export const litCount = (progress: number): number => Math.min(CUE_COUNT, Math.floor(progress * (CUE_COUNT + 1)));

const stance = startStance(VAULT_DIMS, VAULT_PLACEMENTS);
const entryDoor = VAULT_PLACEMENTS.find((placement) => placement.entry)!;
const farCornerHeading = (Math.atan2(VAULT_DIMS.widthMm - stance.xMm, VAULT_DIMS.depthMm - stance.zMm) * 180) / Math.PI;

const THRESHOLD = eyePose(entryDoor.xMm, entryDoor.zMm, stance.headingDeg);
const START = eyePose(stance.xMm, stance.zMm, stance.headingDeg);
const FAR_CORNER = eyePose(stance.xMm, stance.zMm, farCornerHeading);

/** Where each stop of the path sits in the scroll: the overview, the doorway, the player-height start, then a turn toward the far corner. */
const STOPS = [0, 0.4, 0.7, 1];

/** A portrait window needs the overview pulled back so the room's width still fits. */
const fitZoom = (aspect: number): number => Math.max(1, 0.75 / aspect);

/** The camera for a scroll position: a pure function of progress, so it moves forward as progress grows and steps back exactly as it shrinks. */
export function cameraAt(progress: number, aspect: number): Pose {
  const overview = overviewPose(VAULT_DIMS, OVERVIEW_YAW_DEG, OVERVIEW_PITCH_DEG, fitZoom(aspect));
  if (prefersReducedMotion()) return overview;
  const poses = [overview, THRESHOLD, START, FAR_CORNER];
  let segment = 0;
  while (segment < poses.length - 2 && progress >= STOPS[segment + 1]!) segment += 1;
  const from = STOPS[segment]!;
  const to = STOPS[segment + 1]!;
  return blendPose(poses[segment]!, poses[segment + 1]!, (progress - from) / (to - from));
}
