// API client and shared browser types.

export interface Account {
  id: string;
  email: string;
  playerName: string;
}

export interface ApiErrorShape {
  code: string;
  message: string;
  fields?: Record<string, string>;
}

export class ApiError extends Error {
  code: string;
  fields: Record<string, string>;
  status: number;
  constructor(status: number, shape: ApiErrorShape) {
    super(shape.message);
    this.code = shape.code;
    this.fields = shape.fields ?? {};
    this.status = status;
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (response.status === 204) {
    return { status: 204, data: undefined as unknown as T };
  }
  const text = await response.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!response.ok) {
    const shape = (data as { error?: ApiErrorShape })?.error ?? { code: 'UNKNOWN', message: 'Request failed.' };
    throw new ApiError(response.status, shape);
  }
  return { status: response.status, data: data as T };
}

export interface Definition {
  title: string;
  description: string;
  difficulty: 'calm' | 'rough' | 'severe';
  seed: number;
  buildable: Array<{ lane: number; cell: number }>;
  waves: Array<{ tick: number; creature: string; count: number; interval: number; lane: number }>;
}

export interface Ticket {
  id: string;
  accountId: string;
  mode: 'campaign' | 'playtest' | 'challenge';
  sourceId: string;
  revision: number | null;
  seed: number;
  levelDigest: string;
  loadout: string[];
  ruleset: string;
  initialReserve: number;
  initialHealth: number;
  seasonDay: string | null;
  daily: boolean;
}

export interface Metrics {
  outcome: 'victory' | 'defeat';
  breaches: number;
  completionTick: number;
  remainingCharge: number;
  health: number;
}

export interface ResultShape {
  runId: string;
  state: string;
  evidenceDigest: string | null;
  metrics: Metrics | null;
  failure: { tick: number; seq: number | null; reason: string } | null;
}

export interface FrameShape {
  tick: number;
  rngState: number;
  nextEntityId: number;
  nextMovementId: number;
  health: number;
  breaches: number;
  reserve: number;
  source: number;
  sink: number;
  devices: Array<{ id: number; device: string; lane: number; cell: number; tier: string; installedCharge: number; nextFireTick: number | null }>;
  creatures: Array<{ id: number; creature: string; lane: number; position: number; health: number; movements: number }>;
  spawned: number[];
  events: Array<Record<string, unknown>>;
  transfers: Array<Record<string, unknown>>;
  outcome: 'victory' | 'defeat' | null;
}

export interface RunShape {
  ticket: Ticket;
  state: string;
  result: ResultShape | null;
  ledger: Array<Record<string, unknown>> | null;
  proof: { runId: string; revision: number; state: string } | null;
}

export interface EncounterShape {
  id: string;
  title: string;
  definition: Definition;
  digest: string;
  unlocked: boolean;
  completed: boolean;
}

export interface CampaignShape {
  encounters: EncounterShape[];
  progress: { completed: string[]; unlocked: string[] };
}

export interface LevelShape {
  id: string;
  revision: number;
  state: string;
  definition: Definition;
  digest: string;
  proofRunId: string | null;
  challengeDigest: string | null;
  proofs: Array<{ runId: string; revision: number; state: string }>;
  indexing: 'pending' | 'current';
}

export interface ChallengeShape {
  digest: string;
  ruleset: string;
  title: string;
  description: string;
  difficulty: string;
  creatorName: string;
  definition: Definition;
  proofRunId: string;
}

export interface BoardShape {
  digest: string;
  ruleset: string;
  rows: Array<{ rank: number; accountId: string; playerName: string; runId: string; breaches: number; completionTick: number; remainingCharge: number }>;
  personalBest: { rank: number; accountId: string; playerName: string; runId: string; breaches: number; completionTick: number; remainingCharge: number } | null;
  completions: number;
  crewUsage: Array<{ device: string; deployments: number; tenthsPercent: number }>;
}

export interface SeasonShape {
  instant: string;
  localTime: string;
  seasonDay: string;
  dailyDigest: string | null;
  standings: BoardShape | null;
  streak: number | null;
}

export interface PlaybackShape {
  version: number;
  tick: number;
  playing: boolean;
}

export interface SnapshotShape {
  runId: string;
  playback: PlaybackShape;
  frame: FrameShape | null;
  leaderboard: BoardShape | null;
}

export interface ReplayShape {
  ticket: Ticket;
  definition: Definition;
  commands: Array<{ seq: number; tick: number; type: string; lane: number; cell: number; device: string | null }>;
  endTick: number;
  metrics: Metrics;
}

export interface CommandStateShape extends FrameShape {
  phase: 'after-commands';
}
