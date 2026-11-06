// The browser API layer. Sends intents only; the server is the sole source of truth.
export interface ApiError {
  status: number;
  code: string;
  message: string;
  errors?: Record<string, string>;
  nextClaimAt?: string;
  nextDonationAt?: string;
}

export class ApiRequestError extends Error {
  constructor(readonly api: ApiError) {
    super(api.message);
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

export class SessionEnded extends Error {}

export async function api<T = unknown>(method: string, path: string, body?: unknown, opts: { idempotencyKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined || method !== 'GET') headers['Content-Type'] = 'application/json; charset=utf-8';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined && method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  let data: unknown = null;
  const text = await res.text();
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (res.status === 401 && ((data as { error?: string } | null)?.error ?? '') === 'unauthenticated') {
    throw new SessionEnded();
  }
  if (!res.ok) {
    const errorBody = (data ?? {}) as { error?: string; message?: string; errors?: Record<string, string>; nextClaimAt?: string; nextDonationAt?: string };
    throw new ApiRequestError({
      status: res.status,
      code: errorBody.error ?? 'internal',
      message: errorBody.message ?? 'Lost contact with the server. Check your connection and try again.',
      errors: errorBody.errors,
      nextClaimAt: errorBody.nextClaimAt,
      nextDonationAt: errorBody.nextDonationAt,
    });
  }
  return data as T;
}

export interface Me {
  id: number;
  email: string;
  displayName: string;
  timeZone: string;
  verified: boolean;
  role: 'islander' | 'operator';
  villageId: number | null;
  trophies: number;
  league: string;
  clanId: number | null;
}

export interface ResourceAmounts {
  brine: number;
  peat: number;
  copper: number;
}

export interface Building {
  id: number;
  type: string;
  x: number;
  y: number;
  rotation: number;
  level: number;
  upgrade: { toLevel: number; startedAt: string; finishesAt: string } | null;
  uncollected?: number;
}

export interface Army {
  units: { saltjack: number; peat_slinger: number };
  training: { id: number; unit: 'saltjack' | 'peat_slinger'; count: number; startsAt: string; finishesAt: string }[];
  housing: { used: number; capacity: number };
}

export interface Village {
  id: number;
  displayName: string;
  grid: { width: number; height: number };
  buildings: Building[];
  resources: { brine: { amount: number; cap: number }; peat: { amount: number; cap: number }; copper: { amount: number; cap: number } };
  saltmark: number;
  builders: { total: number; free: number };
  army: Army;
  shield: { endsAt: string } | null;
  underAttack: boolean;
  trophies: number;
  league: string;
  serverTime: string;
}

export interface Scout {
  villageId: number;
  displayName: string;
  trophies: number;
  league: string;
  buildings: { id: number; type: string; x: number; y: number; rotation: number; level: number }[];
  lootable: ResourceAmounts;
}

export interface Raid {
  id: number;
  state: 'locked' | 'deploying' | 'resolved' | 'abandoned';
  endReason: string | null;
  attacker: { villageId: number; displayName: string };
  defender: { villageId: number; displayName: string };
  lockedAt: string;
  finalizeBy: string;
  seed: number;
  layout: { index: number; id: number; type: string; x: number; y: number; rotation: number; level: number; hp: number }[];
  army: { saltjack: number; peat_slinger: number };
  lootable: ResourceAmounts;
  deploys: { tick: number; unit: 'saltjack' | 'peat_slinger'; x: number; y: number }[];
  result: null | {
    finalTick: number;
    destruction: number;
    stars: number;
    lootable: ResourceAmounts;
    loot: ResourceAmounts;
    transferred: ResourceAmounts;
    trophies: { attacker: number; defender: number };
    starBonus: number;
  };
  resolvedAt: string | null;
}

export interface RaidListRow {
  id: number;
  state: string;
  endReason: string | null;
  role: 'attack' | 'defence';
  opponent: { villageId: number; displayName: string };
  lockedAt: string;
  resolvedAt: string | null;
  stars: number | null;
  destruction: number | null;
  transferred: ResourceAmounts | null;
}

export interface RewardsInfo {
  serverTime: string;
  timeZone: string;
  daily: {
    periodStart: string;
    periodEnd: string;
    claimed: boolean;
    nextClaimAt: string | null;
    streak: number;
    streakEndsAt: string | null;
    chest: ResourceAmounts;
  };
  weekly: {
    periodStart: string;
    periodEnd: string;
    claimed: boolean;
    nextClaimAt: string | null;
    league: string;
    bonus: ResourceAmounts;
  };
  starBonus: { used: number; cap: number; periodEnd: string };
}

export interface ClanInfo {
  id: number;
  name: string;
  motto: string;
  trophies: number;
  rank: number;
  myRole: 'skipper' | 'mate' | 'deckhand' | null;
  members: {
    accountId: number;
    displayName: string;
    villageId: number | null;
    role: 'skipper' | 'mate' | 'deckhand';
    trophies: number;
    donated: number;
    received: number;
    joinedAt: string;
    mateSince: string | null;
  }[];
}

export interface Message {
  id: number;
  author: { accountId: number; displayName: string };
  body: string | null;
  removed: boolean;
  createdAt: string;
}

export interface UnitRequest {
  id: number;
  requester: { accountId: number; displayName: string };
  unit: 'saltjack' | 'peat_slinger';
  count: number;
  given: number;
  state: 'open' | 'filled' | 'closed';
  createdAt: string;
}

export interface Invitation {
  id: number;
  clan: { id: number; name: string };
  invitedBy: { displayName: string };
}

export interface Catalog {
  buildings: {
    type: string;
    name: string;
    width: number;
    depth: number;
    maxCount: number;
    levels: { level: number; cost: ResourceAmounts; buildSeconds: number; hp: number }[];
  }[];
  units: {
    key: 'saltjack' | 'peat_slinger';
    name: string;
    housing: number;
    cost: ResourceAmounts;
    trainSeconds: number;
    hp: number;
    damage: number;
    attacksEvery: number;
    rangeCells: number;
    speedCellsPerTick: number;
  }[];
}
