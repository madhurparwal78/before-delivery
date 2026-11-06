// Every timing value and physical constant of a motion, stated once.

export const QUIRE_CURVE = "cubic-bezier(0.2, 0, 0, 1)";

export const MOTION = {
  morph: 280,
  tether: 180,
  numeral: 160,
  collapse: 167,
  cardTurn: 420,
  rowStaggerStart: 210,
  rowStaggerGap: 60,
  rowFade: 160,
  titleTransition: 280,
  reorderSlide: 240,
  newRowsFade: 160,
  blockGap: 180,
  revealWidth: 320,
  revealFade: 120,
  arrivalMark: 2000,
  remoteSlide: 240,
  refusalSlide: 160,
  scopeFade: 180,
  dailyRevealMs: 320,
  liveEdgeGrow: 280,
  edgeDrawIn: 400,
  flyTime: 600,
} as const;

export const SPRING = {
  stiffness: 400,
  damping: 40,
  mass: 1,
  omega: 20, // sqrt(stiffness / mass)
  settleDistance: 0.5,
  settleVelocity: 10,
} as const;

export const TIMELINE = {
  columnWidth: 280,
  columnGap: 16,
  columnStride: 296,
  coastTimeConstant: 325,
  coastStopVelocity: 0.02,
  snapTime: 200,
  heatHeight: 12,
  heatMax: 6,
} as const;

export const BOARD = {
  cardWidth: 240,
  cardHeight: 160,
  grid: 8,
  zoomMin: 0.25,
  zoomMax: 4,
  limit: 8000,
  keyNudge: 8,
  keyNudgeLarge: 40,
  saveDebounce: 400,
  wheelDivisor: 400,
} as const;

export const GRAPH = {
  fov: 45,
  near: 0.1,
  far: 500,
  repulsion: 40,
  repulsionMin: 0.5,
  springStrength: 0.08,
  springLength: 6,
  shellStrength: 0.2,
  shellBase: 6,
  shellStep: 4,
  step: 0.05,
  damping: 0.92,
  restSpeed: 0.002,
  maxSteps: 600,
  reheatSteps: 400,
  reheatPerFrame: 16 / 1000,
  reheatPerFrameMax: 8,
  jitterTheta: 137.50776405,
  sizeBase: 0.6,
  sizePerBacklink: 0.15,
  sizeMax: 2.4,
  fogRange: 40,
  homeYaw: 0,
  homePitch: 20,
  homeDistance: 40,
  pitchMin: -80,
  pitchMax: 80,
  distanceMin: 12,
  distanceMax: 90,
  dragDegreesPerPixel: 0.4,
  wheelDistanceFactor: 0.05,
  keyYaw: 15,
  keyPitch: 10,
  keyDistance: 5,
  flyTime: 600,
  flyPitch: 15,
  flyDistanceBase: 12,
  flyDistancePerSize: 4,
  idleTurnRate: 6,
  idleResume: 5000,
  labelOffset: 12,
  labelMinRadius: 6,
  detailTolerance: 0.002,
} as const;

export const PRESENCE = {
  reportInterval: 100,
  dropAfter: 30000,
  caretTolerance: 2,
} as const;

export const SAVE_DEBOUNCE = 500;
export const SEARCH_DEBOUNCE = 200;
export const LIVE_DELAY = 2000;
export const UNDO_STACK = 100;
export const TYPING_COALESCE = 1000;
export const SHARE_REFRESH = 5000;
export const STORAGE_POLL = 10000;
