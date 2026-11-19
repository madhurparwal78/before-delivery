// The hand-off, as numbers. The stage is pinned for a fixed scroll distance per finding, and
// every published attribute is a function of the scroll position, the viewport and the version.

import { panelOf, worldPoint, type Vec3 } from '../../shared/panels.js';
import { buildCamera, distanceFor, restingNdc, type CameraFrame } from '../../shared/camera.js';

export const BEAT = 720;
/** The camera and the aim settle before the half-way point the lit-panel rule measures. */
const ANGLE_SETTLES_AT = 0.4;
const AIM_SETTLES_AT = 0.35;
const GLOW_SETTLES_AT = 0.4;
const HAND_OFF_AT = 0.6;

export interface StageFinding {
  id: string;
  position: number;
  panelId: string;
  u: number;
  v: number;
  seen: boolean;
  title: string;
}

export interface StageState {
  beat: number;
  progress: number;
  rim: number;
  travel: number;
  panelId: string;
  u: number;
  v: number;
  angle: number;
  elevation: number;
  aim: Vec3;
  bloom: number;
  /** 0 at the resting pose, 1 once the walkround has moved the aim to the middle of the frame. */
  centring: number;
  /** The finding the beat belongs to, or null during the hero hold. */
  finding: StageFinding | null;
}

export function trackLength(count: number): number {
  return BEAT * (count + 1);
}

function handOffAt(position: number): number {
  return BEAT * position + BEAT * HAND_OFF_AT;
}

/** With no findings there is no hero, so the stage rests on the middle of the offside door. */
const EMPTY_POSE = { panelId: 'os-door', u: 0.5, v: 0.5 } as const;

function azimuthOf(panelId: string): number {
  return panelOf(panelId).azimuth;
}

function elevationOf(panelId: string): number {
  return panelOf(panelId).elevation;
}

/** The pose of a stage with no track at all: the empty pose, with nothing published on it. */
export function emptyState(): StageState {
  return {
    beat: 0,
    progress: 0,
    rim: 0,
    travel: 0,
    panelId: '',
    u: 0,
    v: 0,
    angle: azimuthOf(EMPTY_POSE.panelId),
    elevation: elevationOf(EMPTY_POSE.panelId),
    aim: worldPoint(EMPTY_POSE.panelId, EMPTY_POSE.u, EMPTY_POSE.v),
    bloom: 1,
    centring: 0,
    finding: null,
  };
}

/** A clockwise path: each beat's angle is the next value above the last that faces its panel. */
function angleSequence(panelIds: string[]): number[] {
  const angles: number[] = [];
  for (const [index, panelId] of panelIds.entries()) {
    const azimuth = azimuthOf(panelId);
    if (index === 0) {
      angles.push(azimuth);
      continue;
    }
    const previous = angles[index - 1];
    const step = (((azimuth - previous) % 360) + 360) % 360;
    angles.push(previous + (step === 0 ? 360 : step));
  }
  return angles;
}

function lerp(from: number, to: number, through: number): number {
  return from + (to - from) * through;
}

function easeOut(through: number): number {
  const t = Math.max(0, Math.min(1, through));
  return 1 - (1 - t) * (1 - t);
}

function lerpPoint(from: Vec3, to: Vec3, through: number): Vec3 {
  return [lerp(from[0], to[0], through), lerp(from[1], to[1], through), lerp(from[2], to[2], through)];
}

export interface StageTrack {
  findings: StageFinding[];
  hero: StageFinding | null;
  angles: number[];
  elevations: number[];
  aims: Vec3[];
}

export function buildTrack(findings: StageFinding[], heroId: string | null): StageTrack {
  const hero = findings.find((item) => item.id === heroId) ?? findings[0] ?? null;
  const heroPanel = hero ? hero.panelId : EMPTY_POSE.panelId;
  const panelIds = [heroPanel, ...findings.map((item) => item.panelId)];
  return {
    findings,
    hero,
    angles: angleSequence(panelIds),
    elevations: panelIds.map((id) => elevationOf(id)),
    aims: [
      hero ? worldPoint(hero.panelId, hero.u, hero.v) : worldPoint(EMPTY_POSE.panelId, EMPTY_POSE.u, EMPTY_POSE.v),
      ...findings.map((item) => worldPoint(item.panelId, item.u, item.v)),
    ],
  };
}

export function restingState(track: StageTrack): StageState {
  const hero = track.hero;
  return {
    beat: 0,
    progress: 0,
    rim: 0,
    travel: 0,
    panelId: hero ? hero.panelId : '',
    u: hero ? hero.u : 0,
    v: hero ? hero.v : 0,
    angle: track.angles[0],
    elevation: track.elevations[0],
    aim: track.aims[0],
    bloom: 1,
    centring: 0,
    finding: null,
  };
}

/** The state the frame on screen shows, with no easing lag behind the scroll position. */
export function stateAt(track: StageTrack, scrollY: number): StageState {
  const count = track.findings.length;
  if (count === 0 || scrollY < BEAT) return restingState(track);
  const beat = Math.min(count, Math.floor(scrollY / BEAT));
  const progress = Math.max(0, Math.min(1, (scrollY - BEAT * beat) / BEAT));
  const finding = track.findings[beat - 1];
  const rim = Math.min(1, progress / GLOW_SETTLES_AT);
  const travel = progress <= HAND_OFF_AT ? 0 : (progress - HAND_OFF_AT) / (1 - HAND_OFF_AT);
  return {
    beat,
    progress,
    rim,
    travel,
    panelId: finding.panelId,
    u: finding.u,
    v: finding.v,
    angle: lerp(track.angles[beat - 1], track.angles[beat], easeOut(progress / ANGLE_SETTLES_AT)),
    elevation: lerp(track.elevations[beat - 1], track.elevations[beat], easeOut(progress / ANGLE_SETTLES_AT)),
    aim: lerpPoint(track.aims[beat - 1], track.aims[beat], easeOut(progress / AIM_SETTLES_AT)),
    bloom: Math.max(0.15, 1 - rim),
    // The first beat carries the aim from the resting vertex to the frame's middle; every later
    // beat keeps it there, so the panel under discussion stays clear of the frame's edges.
    centring: beat === 1 ? easeOut(progress / ANGLE_SETTLES_AT) : 1,
    finding,
  };
}

/** Where a beat's finding sits in the frame: a little above the middle, over the docked card. */
const BEAT_NDC = [0, 0.12] as const;

/** A near-square frame steps back a little inside a beat, so a car seen end-on keeps both ends. */
function beatStepBack(aspect: number): number {
  return aspect >= 0.6 && aspect < 1.2 ? 0.35 : 0;
}

function beatNdc(resting: readonly [number, number], centring: number): readonly [number, number] {
  return [lerp(resting[0], BEAT_NDC[0], centring), lerp(resting[1], BEAT_NDC[1], centring)];
}

export function cameraFor(
  state: StageState,
  width: number,
  height: number,
  options: { closeUp?: boolean } = {},
): CameraFrame {
  return buildCamera(
    {
      angle: state.angle,
      elevation: state.elevation,
      anchor: state.aim,
      // The buyer stage leaves the statements and the summary card room above the point it rests
      // on; the preview is a short window with nothing over it, so it centres that point and
      // keeps the body's top edge inside the frame.
      ndc: options.closeUp ? [0, 0] : beatNdc(restingNdc(width), state.centring),
      // The preview orbits the point it rests on, so moving the pin moves the camera with it.
      ...(options.closeUp
        ? { centre: state.aim, distance: 3.6 }
        : { distance: distanceFor(width / Math.max(1, height)) * (1 + beatStepBack(width / Math.max(1, height)) * state.centring) }),
    },
    width,
    height,
  );
}

/** Every hand-off point crossed going forwards between two scroll positions, in walkround order. */
export function crossings(track: StageTrack, from: number, to: number): StageFinding[] {
  if (to <= from) return [];
  return track.findings.filter((finding) => {
    const at = handOffAt(finding.position);
    return at > from && at <= to;
  });
}
