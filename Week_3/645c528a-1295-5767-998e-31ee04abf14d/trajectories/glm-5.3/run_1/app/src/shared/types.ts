export type Theme = 'light' | 'dark' | 'system';

export interface Settings {
  sound: boolean;
  music: boolean;
  aimSensitivity: number;
  leftHanded: boolean;
  reducedMotion: boolean;
  theme: Theme;
}

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  music: false,
  aimSensitivity: 5,
  leftHanded: false,
  reducedMotion: false,
  theme: 'dark',
};

export interface SessionPlayer {
  id: string;
  email: string;
  displayName: string;
  level: number;
  xp: number;
  coins: number;
  cash: number;
  emailVerified: boolean;
  minor: boolean;
}

export interface MeBody extends SessionPlayer {
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

export interface LedgerLine {
  id: string;
  pairId: string;
  playerId: string | null;
  currency: 'coins' | 'cash';
  account: 'wallet' | 'escrow' | 'house' | 'system';
  amount: number;
  kind: string;
  refId: string | null;
  createdAt: string;
}

export interface SeatView {
  seat: 1 | 2;
  playerId: string;
  displayName: string;
  group: 'solids' | 'stripes' | null;
  ballsLeft: number;
  connected: boolean;
}

export type Mode = 'eight-ball' | 'nine-ball' | 'no-guidelines';
export type PocketName = 'top-left' | 'top-right' | 'middle-left' | 'middle-right' | 'bottom-left' | 'bottom-right';

export interface MatchResultView {
  line: string;
  coinChange: string;
  xpGained: number;
  levelUps: number[];
  coins: number;
}

export interface TableBody {
  id: string;
  mode: Mode;
  tier: number;
  status: 'in_play' | 'settled' | 'forfeited' | 'voided';
  seats: SeatView[];
  activeSeat: 1 | 2;
  ballInHand: boolean;
  calledPocketRequired: boolean;
  shotClockSeconds: number;
  reconnectSeconds: number | null;
  pot: number;
  seatedHere: boolean;
  ruleBanner: string;
  balls: number[];
  result: MatchResultView | null;
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

export interface FriendView {
  id: string;
  displayName: string;
  presence: 'online' | 'in_match' | 'offline';
}

export interface FriendsBody {
  friendCode: string;
  friends: FriendView[];
  incoming: { requestId: string; id: string; displayName: string }[];
  outgoing: { requestId: string; id: string; displayName: string }[];
  blocked: { id: string; displayName: string }[];
}

export interface ClubSummary {
  id: string;
  name: string;
  joinPolicy: 'open' | 'request';
  memberCount: number;
  weeklyScore: number;
}

export interface ClubMember {
  playerId: string;
  displayName: string;
  role: 'owner' | 'officer' | 'member';
  weeklyWins: number;
}

export interface ClubBody extends ClubSummary {
  members: ClubMember[];
  requests: { playerId: string; displayName: string }[];
  messages: { messageId: string; playerId: string; displayName: string; preset: string; createdAt: string }[];
  ownRole: 'owner' | 'officer' | 'member' | null;
  ownerId: string;
}

export interface LeaderboardRow {
  rank: number;
  playerId: string;
  displayName: string;
  wins: number;
}

export interface LeaderboardBody {
  rows: LeaderboardRow[];
  own: { rank: number | null; wins: number };
}

export interface TournamentEntrant {
  slot: number | null;
  playerId: string;
  displayName: string;
  ready: boolean;
}

export interface TournamentBody {
  id: string;
  tier: number;
  tierName: string;
  status: 'open' | 'full' | 'ready_check' | 'round_of_8' | 'semi_finals' | 'final' | 'paid' | 'refunded';
  entry: number;
  entrantCount: number;
  entrants: TournamentEntrant[];
  prizes: { first: number; second: number; semiFinal: number; house: number };
  windowSecondsLeft: number | null;
  readySecondsLeft: number | null;
}

export interface ApiError {
  error: string;
  message: string;
  errors?: Record<string, string>;
}
