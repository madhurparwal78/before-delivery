export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly errors: Record<string, string> = {},
  ) {
    super(message);
  }
}

const NETWORK_DOWN = 'network_down';

interface ErrorBody {
  error: string;
  message: string;
  errors?: Record<string, string>;
}

export async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiFailure(0, NETWORK_DOWN, 'Could not reach the table');
  }
  if (response.status === 204) return undefined as T;
  const parsed: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = parsed as ErrorBody | null;
    throw new ApiFailure(response.status, failure?.error ?? 'unknown', failure?.message ?? 'Could not reach the table', failure?.errors);
  }
  return parsed as T;
}

export interface Settings {
  sound: boolean;
  music: boolean;
  aimSensitivity: number;
  leftHanded: boolean;
  reducedMotion: boolean;
  theme: 'light' | 'dark' | 'system';
}

export interface Me {
  id: string;
  email: string;
  displayName: string;
  level: number;
  xp: number;
  coins: number;
  cash: number;
  emailVerified: boolean;
  minor: boolean;
  xpToNext: number;
  wins: number;
  losses: number;
  winRate: number;
  winStreak: number;
  highestPot: number;
  equippedCueId: string;
  equippedClothId: string;
  dailyRewardClaimed: boolean;
  refillsLeft: number;
  mailDelayed: boolean;
  activeTableUrl: string | null;
  friendCode: string;
  settings: Settings;
}

export interface ShopItem {
  id: string;
  kind: 'cue' | 'cloth';
  name: string;
  currency: 'coins' | 'cash';
  price: number;
  minLevel: number;
  aim: number;
  power: number;
  spin: number;
  time: number;
  owned: boolean;
  equipped: boolean;
}

export interface CashPack {
  id: string;
  name: string;
  cash: number;
  priceUsd: string;
}

export interface LedgerLine {
  id: string;
  currency: 'coins' | 'cash';
  amount: number;
  kind: string;
  createdAt: string;
}

export interface Tournament {
  id: string;
  tier: number;
  tierName: string;
  status: string;
  entry: number;
  entrantCount: number;
  entrants: { slot: number | null; playerId: string; displayName: string; ready: boolean }[];
  prizes: { first: number; second: number; semiFinal: number; house: number };
  windowSecondsLeft: number | null;
  readySecondsLeft: number | null;
}

export interface ClubSummary {
  id: string;
  name: string;
  joinPolicy: 'open' | 'request';
  memberCount: number;
  weeklyScore: number;
}

export interface Club extends ClubSummary {
  members: { playerId: string; displayName: string; role: 'owner' | 'officer' | 'member'; weeklyWins: number }[];
  requests: { playerId: string; displayName: string }[];
  messages: { id: string; displayName: string; preset: string }[];
}

export interface Friends {
  friendCode: string;
  friends: { id: string; displayName: string; presence: 'online' | 'in_match' | 'offline' }[];
  incoming: { requestId: string; id: string; displayName: string }[];
  outgoing: { requestId: string; id: string; displayName: string }[];
  blocked: { id: string; displayName: string }[];
}
