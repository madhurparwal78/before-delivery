export const RULEBOOK_VERSION = '2026.11-r1';
export const VALIDATOR_VERSION = '2.0.0-dev.3.10';

export const NAME_MIN = 3;
export const NAME_MAX = 20;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
export const CHAT_MAX = 280;

export const MAX_STROKES = 24;
export const MAX_VERTICES = 12_000;
export const MIN_POINTS = 2;
export const MAX_POINTS = 200;
export const THICKNESS_MIN = 0.01;
export const THICKNESS_MAX = 0.08;
export const VERTICES_PER_POINT = 8;

export const UPLOAD_MAX_BYTES = 15_728_640;
export const QUOTA_BYTES = 62_914_560;

export const TICKS_PER_SECOND = 20;
export const MOVE_PER_TICK = 0.2;
export const PUDDLE_DAMAGE_PER_TICK = 0.5;
export const MAX_HEALTH = 100;

export const PARTY_MAX_MEMBERS = 4;
export const READY_CHECK_SECONDS = 20;

export const JSON_BODY_MAX_BYTES = 1_000_000;

export const CHAT_WINDOW_SECONDS = 10;
export const CHAT_WINDOW_MAX = 5;

export const PRESENCE_TIMEOUT_SECONDS = 30;
export const PING_INTERVAL_MS = 2000;
export const PING_TIMEOUT_MS = 4000;

export const DRAWING_PLANE_CSS_PX = 320;
export const PLANE_HALF_METRES = 1;

export const PROPORTION_MIN = 0.5;
export const PROPORTION_MAX = 1.5;
export const PROPORTION_STEP = 0.05;
export const POSE_MIN_RAD = -3.1416;
export const POSE_MAX_RAD = 3.1416;

export const GROUND_LIMIT = 20;
export const SPAWN = { x: 0, z: 0 } as const;
export const CHECKPOINT = { x: -4, z: 0 } as const;
export const CHECKPOINT_RADIUS = 1.5;
export const GATE = { x: 0, z: -8 } as const;
export const GATE_RADIUS = 1;
export const MOTE_RADIUS = 1;
export const PUDDLE = { x: -8, z: -8, radius: 2 } as const;
export const MOTE_LAYOUT: readonly { id: string; x: number; z: number }[] = [
  { id: 'm1', x: 4, z: 0 },
  { id: 'm2', x: 4, z: 4 },
  { id: 'm3', x: 0, z: 4 },
];

export const STORIES: readonly { id: string; mode: 'solo' | 'coop'; chapters: number }[] = [
  { id: 'lantern-road', mode: 'solo', chapters: 3 },
  { id: 'smudged-keep', mode: 'coop', chapters: 2 },
  { id: 'eraser-ferry', mode: 'coop', chapters: 2 },
];

/** Every record ID is a UUID. */
export const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
