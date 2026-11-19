import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { panelById, worldPoint, type PanelDefinition, type Vec3 } from '../../shared/panels';

/** The stage stays pinned for exactly 720 pixels of scroll per finding. */
export const BEAT_SCROLL = 720;
export const FIELD_OF_VIEW = 38;

/** Where the camera orbits from for each panel, so the panel faces the camera. */
interface PanelView {
  azimuth: number;
  elevation: number;
  radius: number;
}

const PANEL_VIEWS: Readonly<Record<string, PanelView>> = {
  bonnet: { azimuth: 6, elevation: 30, radius: 4.7 },
  'os-front-wing': { azimuth: 34, elevation: 16, radius: 4.4 },
  'os-door': { azimuth: 66, elevation: 14, radius: 4.2 },
  'os-sill': { azimuth: 92, elevation: 7, radius: 3.8 },
  'os-rear-quarter': { azimuth: 140, elevation: 15, radius: 4.4 },
  'boot-lid': { azimuth: 172, elevation: 29, radius: 4.6 },
  'rear-bumper': { azimuth: 186, elevation: 16, radius: 4.4 },
  'ns-rear-quarter': { azimuth: 220, elevation: 15, radius: 4.4 },
  'ns-sill': { azimuth: 268, elevation: 7, radius: 3.8 },
  'ns-door': { azimuth: 294, elevation: 14, radius: 4.2 },
  'ns-front-wing': { azimuth: 326, elevation: 16, radius: 4.4 },
  'front-bumper': { azimuth: 354, elevation: 16, radius: 4.4 },
  roof: { azimuth: 160, elevation: 44, radius: 4.8 },
};

const PIVOT_Y = 0.72;

/**
 * The camera arrives at the panel's own view early in the beat and keeps turning to
 * it until the end, so the angle rises all through the beat while the panel faces the
 * camera well before the hand-off point.
 */
const sweep = (progress: number): number => 1 - Math.pow(1 - progress, 4.5);

const viewOf = (panelId: string): PanelView => {
  const view = PANEL_VIEWS[panelId];
  if (view === undefined) throw new Error(`No camera view for panel ${panelId}`);
  return view;
};

export interface StageFinding {
  id: string;
  panelId: string;
  u: number;
  v: number;
}

export interface StageTrack {
  /** Findings in walkround order. */
  readonly findings: readonly StageFinding[];
  /** The resting angle and the cumulative target angle for each beat. */
  readonly restAngle: number;
  readonly targetAngles: readonly number[];
  readonly heroIndex: number;
}

const positiveDelta = (from: number, to: number): number => {
  const delta = ((to - from) % 360 + 360) % 360;
  return delta < 10 ? delta + 360 : delta;
};

/**
 * The clockwise path round the car: each beat turns forward to its panel, so the
 * angle never falls on forward scrolling.
 */
export const buildTrack = (findings: readonly StageFinding[], heroFindingId: string | null): StageTrack => {
  const heroIndex = Math.max(
    0,
    findings.findIndex((finding) => finding.id === heroFindingId),
  );
  const restAngle = findings.length === 0 ? 0 : viewOf(findings[heroIndex].panelId).azimuth;

  const targetAngles: number[] = [];
  let angle = restAngle;
  let previousAzimuth = restAngle;
  for (const finding of findings) {
    const azimuth = viewOf(finding.panelId).azimuth;
    angle += positiveDelta(previousAzimuth, azimuth);
    previousAzimuth = azimuth;
    targetAngles.push(angle);
  }

  return { findings, restAngle, targetAngles, heroIndex };
};

export interface BeatState {
  /** 0 during the hero hold, then the 1-based position of the current finding. */
  beat: number;
  beatProgress: number;
  rimGlow: number;
  cardTravel: number;
  finding: StageFinding | null;
  panelId: string;
  anchor: { u: number; v: number };
}

/** The scroll length of the pinned stage, which is released after 720 x (N + 1). */
export const trackLength = (findingCount: number): number => BEAT_SCROLL * (findingCount + 1);

export const beatStateOf = (track: StageTrack, scroll: number, still: boolean): BeatState => {
  const hero = track.findings[track.heroIndex] ?? null;
  const restState = (): BeatState => ({
    beat: 0,
    beatProgress: 0,
    rimGlow: 0,
    cardTravel: 0,
    finding: hero,
    panelId: hero?.panelId ?? '',
    anchor: { u: hero?.u ?? 0, v: hero?.v ?? 0 },
  });

  if (still || track.findings.length === 0 || scroll < BEAT_SCROLL) return restState();

  const raw = Math.floor(scroll / BEAT_SCROLL);
  const beat = Math.min(raw, track.findings.length);
  const within = beat === track.findings.length && raw > beat ? 1 : (scroll - BEAT_SCROLL * beat) / BEAT_SCROLL;
  const progress = Math.min(1, Math.max(0, within));
  const finding = track.findings[beat - 1];

  return {
    beat,
    beatProgress: progress,
    rimGlow: Math.min(1, progress / 0.4),
    cardTravel: progress <= 0.6 ? 0 : (progress - 0.6) / 0.4,
    finding,
    panelId: finding.panelId,
    anchor: { u: finding.u, v: finding.v },
  };
};

export interface CameraPose {
  /** Cumulative degrees, whose modulo 360 is the eye's azimuth. */
  angle: number;
  elevation: number;
  radius: number;
  eye: Vec3;
  look: Vec3;
}

const anchorWorldPoint = (finding: StageFinding): Vec3 => {
  const panel = panelById(finding.panelId);
  if (panel === undefined) throw new Error(`Unknown panel ${finding.panelId}`);
  return worldPoint(panel, finding.u, finding.v);
};

export const panelOf = (panelId: string): PanelDefinition => {
  const panel = panelById(panelId);
  if (panel === undefined) throw new Error(`Unknown panel ${panelId}`);
  return panel;
};

const eyeAt = (angle: number, elevation: number, radius: number): Vec3 => {
  const a = (angle * Math.PI) / 180;
  const e = (elevation * Math.PI) / 180;
  const horizontal = radius * Math.cos(e);
  return [horizontal * Math.sin(a), PIVOT_Y + radius * Math.sin(e), -horizontal * Math.cos(a)];
};

const mix = (from: number, to: number, t: number): number => from + (to - from) * t;

/** The pose that draws the frame on screen for one scroll position. */
export const poseOf = (track: StageTrack, state: BeatState): CameraPose => {
  const hero = track.findings[track.heroIndex] ?? null;
  if (hero === null) {
    return { angle: 0, elevation: 24, radius: 5, eye: eyeAt(0, 24, 5), look: [0, PIVOT_Y, 0] };
  }

  if (state.beat === 0) {
    const view = viewOf(hero.panelId);
    return {
      angle: track.restAngle,
      elevation: view.elevation,
      radius: view.radius,
      eye: eyeAt(track.restAngle, view.elevation, view.radius),
      look: anchorWorldPoint(hero),
    };
  }

  const index = state.beat - 1;
  const finding = track.findings[index];
  const previous = index === 0 ? hero : track.findings[index - 1];
  const fromView = index === 0 ? viewOf(hero.panelId) : viewOf(previous.panelId);
  const toView = viewOf(finding.panelId);
  const fromAngle = index === 0 ? track.restAngle : track.targetAngles[index - 1];
  const toAngle = track.targetAngles[index];

  const t = sweep(state.beatProgress);
  const angle = mix(fromAngle, toAngle, t);
  const elevation = mix(fromView.elevation, toView.elevation, t);
  const radius = mix(fromView.radius, toView.radius, t);
  const fromLook = anchorWorldPoint(previous);
  const toLook = anchorWorldPoint(finding);

  return {
    angle,
    elevation,
    radius,
    eye: eyeAt(angle, elevation, radius),
    look: [mix(fromLook[0], toLook[0], t), mix(fromLook[1], toLook[1], t), mix(fromLook[2], toLook[2], t)],
  };
};

export interface Projection {
  /** Projection times view, column-major. */
  matrix: Matrix4;
  camera: PerspectiveCamera;
}

export const buildProjection = (pose: CameraPose, width: number, height: number): Projection => {
  const camera = new PerspectiveCamera(FIELD_OF_VIEW, width / Math.max(1, height), 0.1, 120);
  camera.position.set(pose.eye[0], pose.eye[1], pose.eye[2]);
  camera.up.set(0, 1, 0);
  camera.lookAt(new Vector3(pose.look[0], pose.look[1], pose.look[2]));
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const matrix = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  return { matrix, camera };
};

export interface ScreenPoint {
  x: number;
  y: number;
  inFront: boolean;
}

/** Projects a world point onto a canvas box, by the published formula. */
export const projectToBox = (
  matrix: Matrix4,
  point: Vec3,
  box: { width: number; height: number },
): ScreenPoint => {
  const e = matrix.elements;
  const [x, y, z] = point;
  const clipX = e[0] * x + e[4] * y + e[8] * z + e[12];
  const clipY = e[1] * x + e[5] * y + e[9] * z + e[13];
  const clipW = e[3] * x + e[7] * y + e[11] * z + e[15];
  if (clipW === 0) return { x: Number.NaN, y: Number.NaN, inFront: false };
  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;
  return {
    x: ((ndcX + 1) / 2) * box.width,
    y: ((1 - ndcY) / 2) * box.height,
    inFront: clipW > 0,
  };
};

export const matrixAttribute = (matrix: Matrix4): string =>
  matrix.elements.map((value) => value.toFixed(6)).join(',');

export const positionAttribute = (eye: Vec3): string => eye.map((value) => value.toFixed(6)).join(',');

export const anchorAttribute = (anchor: { u: number; v: number }): string =>
  `${anchor.u.toFixed(3)},${anchor.v.toFixed(3)}`;
