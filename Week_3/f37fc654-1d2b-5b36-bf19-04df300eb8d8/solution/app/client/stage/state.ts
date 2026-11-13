// What the venue stage shows. Pages set it; the stage publishes it as data-* attributes and draws it.
import { DUST_BEFORE_ANSWER, type InstallationType } from "../../shared/catalog";
import { store } from "../lib/store";

export type Scene = "landing" | "brief" | "configurator" | "working";
export type Silhouette = "none" | InstallationType;

export interface StageState {
  scene: Scene;
  /** Landing scroll offset in viewport heights (0 to 4). */
  scroll: number;
  roomW: number | null;
  roomD: number | null;
  silhouette: Silhouette;
  dust: number;
}

export const stage = store<StageState>({ scene: "working", scroll: 0, roomW: null, roomD: null, silhouette: "none", dust: DUST_BEFORE_ANSWER });

const KEYFRAMES = 5;

export function keyframeOf(scroll: number): number {
  return Math.max(0, Math.min(KEYFRAMES - 1, Math.round(scroll)));
}

/** Light-field strength per scene: working screens dim it to about two fifths. */
export const LIGHT: Record<Scene, number> = { landing: 1, brief: 1, configurator: 0.4, working: 0.4 };

export interface Pose {
  position: [number, number, number];
  target: [number, number, number];
  roll: number;
}

// Each keyframe frames the wall beside the centred column, never behind the captions.
const LANDING: Pose[] = [
  { position: [-3.4, 2.4, 13.5], target: [-6.4, 1.0, 0], roll: -0.05 },
  { position: [-3.2, 1.5, 7.4], target: [-6.6, 1.3, 0], roll: -0.02 },
  { position: [-9.5, 2.4, 2.6], target: [-2.0, 1.2, -6.5], roll: -0.06 },
  { position: [0.9, 1.5, 3.2], target: [-4.6, 1.4, 0.6], roll: 0.0 },
  { position: [-4.5, 7.5, 18.5], target: [-8.0, 0.2, -1.5], roll: -0.08 },
];

const ease = (t: number): number => t * t * (3 - 2 * t);
const mix = (a: number[], b: number[], t: number): [number, number, number] => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as [number, number, number];

/** The camera the scene settles to for a state: a pure function of the state, so scrolling back replays the same path. */
export function targetPose(s: StageState, aspect: number): Pose {
  if (s.scene === "landing") {
    const p = Math.max(0, Math.min(KEYFRAMES - 1, s.scroll));
    const i = Math.min(KEYFRAMES - 2, Math.floor(p));
    const t = ease(p - i);
    return { position: mix(LANDING[i].position, LANDING[i + 1].position, t), target: mix(LANDING[i].target, LANDING[i + 1].target, t), roll: LANDING[i].roll + (LANDING[i + 1].roll - LANDING[i].roll) * t };
  }
  const w = s.roomW ?? 14;
  const d = s.roomD ?? 10;
  const span = Math.max(w, d / Math.max(0.6, aspect), 8);
  if (s.scene === "configurator") return { position: [0, span * 1.25 + 4, d * 0.55 + 3], target: [0, 0, 0], roll: 0 };
  const far = s.scene === "working" ? 1.25 : 1;
  return { position: [span * 0.32 * far, (span * 0.55 + 4.5) * far, (span * 0.9 + 6) * far], target: [-span * 0.08, 0, -d * 0.18], roll: -0.14 };
}

/** Grid cell size in metres: one cell is one metre once the room is known. */
export const cellSize = (s: StageState): number => (s.roomW ? 1 : 2);

/** The plane bows down away from its centre like a lens. */
export const BOW = 0.0035;
