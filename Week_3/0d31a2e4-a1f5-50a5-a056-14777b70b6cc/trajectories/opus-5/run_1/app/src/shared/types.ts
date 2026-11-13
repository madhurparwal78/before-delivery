export type RoundKind = 'race' | 'survival' | 'final';
export type BeanState = 'alive' | 'falling' | 'respawning' | 'qualified' | 'eliminated';
export type Presence = 'offline' | 'online' | 'in_party' | 'in_match';
export type PartyState = 'idle' | 'queued' | 'in_lobby' | 'in_match';
export type LobbyState = 'filling' | 'countdown' | 'running' | 'finished';
export type RoundState = 'pending' | 'running' | 'resolved';
export type MatchState = 'running' | 'finished';
export type Friendship = 'none' | 'pending_in' | 'pending_out' | 'friends' | 'blocked' | 'blocked_by';
export type Marker = 'last_slot' | 'first_out';

export interface User {
  id: number;
  handle: string;
  hue: number;
}

export interface Me extends User {
  email: string;
  emailVerified: boolean;
}

export interface FriendEntry {
  user: User;
  presence: Presence;
  since: string;
}

export interface IncomingRequest {
  id: number;
  from: User;
  sentAt: string;
}

export interface OutgoingRequest {
  id: number;
  to: User;
  sentAt: string;
}

export interface FriendsPayload {
  friends: FriendEntry[];
  incoming: IncomingRequest[];
  outgoing: OutgoingRequest[];
  blocked: User[];
}

export interface FriendshipPayload {
  user: User;
  status: 'accepted';
  since: string;
}

export interface RequestPayload {
  id: number;
  to: User;
  status: 'pending';
  sentAt: string;
}

export interface ProfileMatchEntry {
  id: number;
  name: string;
  finishedAt: string;
  outcome: 'winner' | 'eliminated';
  round: number | null;
}

export interface ProfilePayload {
  user: User;
  friendship: Friendship;
  presence: Presence | null;
  played: number;
  wins: number;
  matches: ProfileMatchEntry[];
}

export interface PartyMember {
  user: User;
  joinedAt: string;
}

export interface Party {
  id: number;
  state: PartyState;
  leaderId: number;
  members: PartyMember[];
  lobbyId: number | null;
  matchId: number | null;
  queuedAt: string | null;
}

export interface IncomingInvite {
  id: number;
  from: User;
  partyId: number;
  sentAt: string;
}

export interface OutgoingInvite {
  id: number;
  to: User;
  sentAt: string;
}

export interface PartyPayload {
  party: Party;
  invites: { incoming: IncomingInvite[]; outgoing: OutgoingInvite[] };
}

export interface Seat {
  seat: number;
  userId: number | null;
  partyId: number | null;
  seatedAt: string | null;
}

export interface Lobby {
  id: number;
  state: LobbyState;
  size: 12;
  seats: Seat[];
  countdownEndsAt: string | null;
  matchId: number | null;
}

export interface RoundResult {
  userId: number;
  outcome: 'qualified' | 'eliminated';
  finishTick: number | null;
  eliminatedTick: number | null;
  position: number;
}

export interface Round {
  n: number;
  kind: RoundKind;
  name: string;
  seed: number;
  state: RoundState;
  starters: number[];
  slots: number;
  lastTick: number | null;
  results: RoundResult[];
}

export interface Match {
  id: number;
  name: string;
  state: MatchState;
  lobbyId: number;
  startedAt: string;
  finishedAt: string | null;
  winnerId: number | null;
  participants: User[];
  rounds: Round[];
}

export interface FrameBean {
  userId: number;
  handle: string | null;
  hue: number;
  x: number;
  y: number;
  z: number;
  state: BeanState;
  rank: number;
  finishTick: number | null;
  marker: Marker | null;
}

export interface FramePayload {
  matchId: number;
  round: number;
  kind: RoundKind;
  tick: number;
  lastTick: number;
  slots: number;
  slotsLeft: number;
  beans: FrameBean[];
}

export interface InputRecord {
  tick: number;
  userId: number;
  buttons: number;
}

export interface ForfeitRecord {
  tick: number;
  userId: number;
}

export interface InputsPayload {
  kind: RoundKind;
  seed: number;
  starters: number[];
  inputs: InputRecord[];
  forfeits: ForfeitRecord[];
}

export interface SimulateFrame {
  tick: number;
  lastTick: number;
  slots: number;
  slotsLeft: number;
  beans: FrameBean[];
}

export interface SimulatePayload {
  kind: RoundKind;
  seed: number;
  slots: number;
  lastTick: number;
  results: RoundResult[];
  frame: SimulateFrame;
}

export interface Message {
  id: number;
  channel: 'party' | 'dm';
  partyId: number | null;
  fromUserId: number;
  toUserId: number | null;
  body: string;
  sentAt: string;
}

export interface TickBean {
  userId: number;
  x: number;
  y: number;
  z: number;
  state: BeanState;
}

export type ClientMessage =
  | { type: 'heartbeat' }
  | { type: 'input'; matchId: number; round: number; tick: number; buttons: number }
  | { type: 'voice_signal'; to: number; data: unknown }
  | { type: 'voice_state'; inVoice: boolean; muted: boolean; speaking: boolean };

export type ServerMessage =
  | { type: 'presence'; userId: number; presence: Presence }
  | { type: 'friends' }
  | { type: 'party'; party: Party }
  | { type: 'lobby'; lobby: Lobby }
  | { type: 'round'; matchId: number; round: Round }
  | { type: 'tick'; matchId: number; round: number; tick: number; beans: TickBean[] }
  | { type: 'input_rejected'; tick: number; reason: 'late' | 'early' | 'not_playing' | 'invalid' }
  | { type: 'chat'; message: Message }
  | { type: 'voice_signal'; from: number; data: unknown }
  | { type: 'voice_state'; userId: number; inVoice: boolean; muted: boolean; speaking: boolean }
  | { type: 'error'; code: string };

export interface ApiError {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    state?: string;
  };
}
