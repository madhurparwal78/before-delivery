export const DIRECTIONS = ["north", "east", "south", "west"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const RANKS = ["Feather", "Linen", "Cedar", "Granite"] as const;
export type Rank = (typeof RANKS)[number];

export const MEASURES = ["triangles", "materials", "texture size", "file size"] as const;
export type MeasureName = (typeof MEASURES)[number];

export const VISIBILITIES = ["public", "friends", "community", "invite"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const ZONES = [
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;
export type Zone = (typeof ZONES)[number];

export const CATEGORIES = ["harassment", "hateful-content", "impersonation", "other"] as const;
export const ROLES = ["owner", "steward", "member"] as const;
export type Role = (typeof ROLES)[number];

/** What a person who is blocked either way is called. */
export const SOMEONE = "Someone";

export const LIVE_DOWN_TEXT = "Live rooms are unavailable right now.";

/** Chat reach in tiles, Chebyshev distance, inclusive. */
export const EARSHOT_REACH = 6;

export type AvatarState = "shown" | "hidden" | "fallback";

export interface Layout {
  width: number;
  height: number;
  spawn: { x: number; y: number }[];
  walls: { x: number; y: number }[];
  seats: { id: string; x: number; y: number }[];
  exits: { id: string; x: number; y: number }[];
}

export interface PersonView {
  personId: string;
  displayName: string;
  x: number;
  y: number;
  facing: Direction;
  seated: boolean;
  avatar: AvatarState;
  host: boolean;
}

export interface FeatureView {
  id: string;
  kind: "exit" | "seat";
  x: number;
  y: number;
  occupiedBy: string | null;
}

export interface VoteFrame extends VoteView {
  canVote: boolean;
}

export interface VoteView {
  id: string;
  targetId: string;
  status: "open" | "passed" | "failed";
  eligible: number;
  needed: number;
  yes: number;
  no: number;
  closesAt: string;
}

export interface SessionSummary {
  id: string;
  roomName: string;
  hostName: string;
  visibility: Visibility;
  capacity: number;
  count: number;
  status: "open";
}

export interface Relations {
  blocked: string[];
  muted: string[];
}

export interface SessionDetail {
  id: string;
  roomId: string;
  roomName: string;
  roomVersion: number;
  hostId: string;
  hostName: string;
  visibility: Visibility;
  capacity: number;
  count: number;
  status: "open";
  communityId: string | null;
  layout?: Layout;
  features?: FeatureView[];
  people?: PersonView[];
}

export interface ChatMessage {
  id: string;
  fromId: string;
  fromName: string;
  text: string;
  sentAt: string;
}

/** What the server pushes on /ws/sessions/<id>, projected for one viewer. */
export type SessionFrame =
  | {
      type: "state";
      roomVersion: number;
      hostId: string;
      count: number;
      layout: Layout;
      features: FeatureView[];
      people: PersonView[];
      nearby: string[];
      nearest: string | null;
      votes: VoteFrame[];
      voteTargetNames: Record<string, string>;
      relations: Relations;
      reach: number;
    }
  | { type: "announce"; text: string }
  | { type: "chat"; message: ChatMessage }
  | { type: "removed" };

/** What the server pushes on /ws/me. */
export type MeFrame = { type: "friends" } | { type: "role" } | { type: "notice"; text: string };

/** What the server routes to a person's sockets: a warning is turned into a notice by whoever claims it. */
export type PersonEvent = MeFrame | { type: "warning" };
