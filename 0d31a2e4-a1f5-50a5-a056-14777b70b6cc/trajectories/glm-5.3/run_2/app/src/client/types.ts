import type { BeanState, Presence, UserPublic } from "../shared/domain.js";

export * from "../shared/domain.js";

/** Chat log timestamps, shown as HH:MM in the local zone. */
export function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type FriendsView = {
  friends: { user: UserPublic; presence?: Presence | null; since: string }[];
  incoming: { id: number; from: UserPublic; sentAt: string }[];
  outgoing: { id: number; to: UserPublic; sentAt: string }[];
  blocked: UserPublic[];
};

export type InvitesView = {
  incoming: { id: number; from: UserPublic; partyId: number; sentAt: string }[];
  outgoing: { id: number; to: UserPublic; sentAt: string }[];
};

export type LobbyView = {
  lobby: {
    id: number;
    state: "filling" | "countdown" | "running" | "finished";
    size: 12;
    seats: { seat: number; userId: number; partyId: number; seatedAt: string }[];
    countdownEndsAt: string | null;
    matchId: number | null;
  };
};

export type RoundView = {
  n: number;
  kind: "race" | "survival" | "final";
  name: string;
  seed: number;
  state: "pending" | "running" | "resolved";
  starters: number[];
  slots: number;
  lastTick: number | null;
  results: { userId: number; outcome: "qualified" | "eliminated"; finishTick: number | null; eliminatedTick: number | null; position: number }[];
};

export type MatchView = {
  id: number;
  name: string;
  state: "running" | "finished";
  lobbyId: number;
  startedAt: string;
  finishedAt: string | null;
  winnerId: number | null;
  participants: UserPublic[];
  rounds: RoundView[];
};

export type FramesView = {
  matchId: number;
  round: number;
  kind: "race" | "survival" | "final";
  tick: number;
  lastTick: number;
  slots: number;
  slotsLeft: number;
  beans: FrameBean[];
};

export type FrameBean = {
  userId: number;
  handle: string | null;
  x: number;
  y: number;
  z: number;
  state: BeanState;
  rank: number;
  finishTick: number | null;
  marker: "last_slot" | "first_out" | null;
};

export type ProfileView = {
  user: UserPublic;
  friendship: "none" | "pending_in" | "pending_out" | "friends" | "blocked" | "blocked_by";
  presence: Presence | null;
  played: number;
  wins: number;
  matches: { id: number; name: string; finishedAt: string; outcome: "winner" | "eliminated"; round: number | null }[];
};

export type MessageView = {
  id: number;
  channel: "party" | "dm";
  partyId: number | null;
  fromUserId: number;
  toUserId: number | null;
  body: string;
  sentAt: string;
};



