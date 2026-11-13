// The JSON shapes the API exchanges, shared by the server and the browser.
import type { BeanState, LobbyState, Marker, PartyState, Presence, RoundKind, RoundState } from "./rules.js";
import type { TickBean, RoundResult } from "./sim.js";

export interface User {
  id: number;
  handle: string;
  hue: number;
}

export interface Me extends User {
  email: string;
  emailVerified: boolean;
}

export interface Party {
  id: number;
  state: PartyState;
  leaderId: number;
  members: { user: User; joinedAt: string }[];
  lobbyId: number | null;
  matchId: number | null;
  queuedAt: string | null;
}

export interface Invites {
  incoming: { id: number; from: User; partyId: number; sentAt: string }[];
  outgoing: { id: number; to: User; sentAt: string }[];
}

export interface Lobby {
  id: number;
  state: LobbyState;
  size: number;
  seats: { seat: number; userId: number; partyId: number; seatedAt: string }[];
  countdownEndsAt: string | null;
  matchId: number | null;
}

export interface Message {
  id: number;
  channel: "party" | "dm";
  partyId: number | null;
  fromUserId: number;
  toUserId: number | null;
  body: string;
  sentAt: string;
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
  state: "running" | "finished";
  lobbyId: number | null;
  startedAt: string;
  finishedAt: string | null;
  winnerId: number | null;
  participants: User[];
  rounds: Round[];
}

export interface FriendsView {
  friends: { user: User; presence: Presence; since: string }[];
  incoming: { id: number; from: User; sentAt: string }[];
  outgoing: { id: number; to: User; sentAt: string }[];
  blocked: User[];
}

export type Friendship = "none" | "pending_in" | "pending_out" | "friends" | "blocked" | "blocked_by";

export interface Profile {
  user: User;
  friendship: Friendship;
  presence: Presence | null;
  played: number;
  wins: number;
  matches: { id: number; name: string; finishedAt: string; outcome: "winner" | "eliminated"; round: number | null }[];
}

interface FrameBeanView {
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

export interface FrameView {
  matchId: number;
  round: number;
  kind: RoundKind;
  tick: number;
  lastTick: number;
  slots: number;
  slotsLeft: number;
  beans: FrameBeanView[];
}

export type ServerMessage =
  | { type: "presence"; userId: number; presence: Presence }
  | { type: "friends" }
  | { type: "party"; party: Party }
  | { type: "lobby"; lobby: Lobby }
  | { type: "round"; matchId: number; round: Round }
  | { type: "tick"; matchId: number; round: number; tick: number; beans: TickBean[] }
  | { type: "input_rejected"; tick: number | null; reason: "late" | "early" | "not_playing" | "invalid" }
  | { type: "chat"; message: Message }
  | { type: "voice_signal"; from: number; data: unknown }
  | { type: "voice_state"; userId: number; inVoice: boolean; muted: boolean; speaking: boolean }
  | { type: "error"; code: string };
