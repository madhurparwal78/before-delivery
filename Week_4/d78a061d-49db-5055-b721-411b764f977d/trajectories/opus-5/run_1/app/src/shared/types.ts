import type { Locale } from './i18n/index.js';

export type HeadPart = 'round' | 'square' | 'triangle';
export type TorsoPart = 'stick' | 'barrel' | 'kite';
export type ArmsPart = 'thin' | 'thick';
export type LegsPart = 'thin' | 'thick' | 'spring';
export type MaterialName = 'graphite' | 'cobalt' | 'marker' | 'chalk' | 'brick' | 'moss';
export type HeadAccessory = 'none' | 'paper_crown' | 'beanie';
export type BackAccessory = 'none' | 'scarf' | 'satchel';
export type LeftHandAccessory = 'none' | 'lantern' | 'shield';

export interface Parts {
  head: HeadPart;
  torso: TorsoPart;
  arms: ArmsPart;
  legs: LegsPart;
}

export const PROPORTION_KEYS = [
  'head_size',
  'neck_length',
  'spine_length',
  'upper_arm_length',
  'forearm_length',
  'thigh_length',
  'shin_length',
] as const;
export type ProportionKey = (typeof PROPORTION_KEYS)[number];
export type Proportions = Record<ProportionKey, number>;

export interface Pose {
  right_arm_raise: number;
}

export interface Accessories {
  head: HeadAccessory;
  back: BackAccessory;
  left_hand: LeftHandAccessory;
}

export interface Character {
  id: string;
  slot: number;
  revision: number;
  name: string;
  parts: Parts;
  proportions: Proportions;
  pose: Pose;
  material: MaterialName;
  accessories: Accessories;
  model_id: string | null;
  weapon_id: string | null;
  equipped: boolean;
}

export type SessionHero = Omit<Character, 'id' | 'slot' | 'revision' | 'model_id' | 'weapon_id' | 'equipped'>;

export interface Stroke {
  thickness: number;
  points: [number, number][];
}

export interface Stats {
  reach_m: number;
  weight_kg: number;
  swing_per_s: number;
}

export interface Weapon {
  id: string;
  number: number;
  strokes: Stroke[];
  stats: Stats;
  vertices: number;
  equipped_on: string[];
}

export interface PreviewResult {
  drawing_revision: number | null;
  stats: Stats;
  strokes: number;
  vertices: number;
  within_limits: boolean;
  over: ('strokes' | 'vertices')[];
}

export type ModelStatus = 'stored' | 'validating' | 'accepted' | 'equipped' | 'rejected';
export type RuleId = 'R01' | 'R02' | 'R03' | 'R04' | 'R05' | 'R06' | 'R07' | 'R08' | 'R09' | 'R10';
export type RuleStatus = 'pass' | 'fail' | 'skipped';
export type Measured = number | string | [number, number, number, number] | null;

export interface RuleResult {
  id: RuleId;
  status: RuleStatus;
  measured: Measured;
  limit: number | null;
}

export interface Report {
  rulebook_version: string;
  failed_count: number;
  rules: RuleResult[];
}

export interface ModelRecord {
  id: string;
  filename: string;
  size_bytes: number;
  sha256: string;
  status: ModelStatus;
  rulebook_version: string | null;
  report: Report | null;
  created_at: string;
}

export type StorageNotice = null | 'upload_unavailable' | 'delete_unavailable';

export interface Account {
  id: string;
  email: string;
  display_name: string;
  locale: Locale;
  email_verified: boolean;
  verification_email: 'sent' | 'not_sent';
  storage_notice: StorageNotice;
}

export interface Progress {
  unlocked_chapter: number;
  completed_chapters: number[];
  checkpoint: { chapter: number; motes: string[] } | null;
}

export type StoryMode = 'solo' | 'coop';

export interface StoryListEntry {
  id: string;
  mode: StoryMode;
  title: string;
  chapters: number;
  progress: Progress | null;
}

export interface Mote {
  id: string;
  x: number;
  z: number;
  collected_by: string | null;
}

export interface SessionMember {
  account_id: string;
  display_name: string;
  status: 'connected' | 'dropped';
  grace_remaining_seconds: number | null;
  position: { x: number; z: number };
  health: number;
  hero: SessionHero;
  weapon: { strokes: Stroke[]; stats: Stats } | null;
  model_url: string | null;
}

export interface Snapshot {
  id: string;
  story_id: string;
  chapter: number;
  mode: StoryMode;
  status: 'running' | 'complete';
  tick: number;
  gate_open: boolean;
  checkpoint_reached: boolean;
  motes: Mote[];
  members: SessionMember[];
}

export type PartyStatus =
  | 'forming'
  | 'ready_check'
  | 'in_session'
  | 'member_dropped'
  | 'chapter_complete';

export type MemberConnection = 'connected' | 'dropped' | 'offline';

export interface PartyMember {
  account_id: string;
  display_name: string;
  joined_at: string;
  connection: MemberConnection;
  grace_remaining_seconds: number | null;
}

export interface ReadyCheckState {
  deadline_at: number;
  remaining_seconds: number;
  responses: Record<string, 'ready' | 'not_ready' | 'pending'>;
}

export interface Party {
  id: string;
  status: PartyStatus;
  leader_id: string;
  story_id: string;
  members: PartyMember[];
  ready_check: ReadyCheckState | null;
  session_id: string | null;
  progress: Progress;
}

export interface FriendEntry {
  account_id: string;
  display_name: string;
  presence: 'online' | 'offline';
}

export interface FriendRequest {
  id: string;
  from: { account_id: string; display_name: string };
  to: { account_id: string; display_name: string };
  created_at: string;
}

export interface ChatMessage {
  id: string;
  seq: number;
  kind: 'user' | 'system';
  author: { account_id: string; display_name: string } | null;
  body: string | null;
  code: string | null;
  params: Record<string, string | number>;
  text: string;
  created_at: string;
}

export type EmoteName = 'wave' | 'cheer' | 'bow' | 'laugh' | 'point' | 'shrug';
export const EMOTES: readonly EmoteName[] = ['wave', 'cheer', 'bow', 'laugh', 'point', 'shrug'];

export type IntentAction = 'move_to' | 'swing' | 'emote';

export interface ClientHello {
  type: 'hello';
  resume: Record<string, number>;
}
export interface ClientHeartbeat {
  type: 'heartbeat';
}
export interface ClientJoinSession {
  type: 'join_session';
  session_id: string;
}
export interface ClientIntent {
  type: 'intent';
  session_id: string;
  intent_id: string;
  action: IntentAction;
  x?: number;
  z?: number;
  emote?: EmoteName;
}
export type ClientMessage = ClientHello | ClientHeartbeat | ClientJoinSession | ClientIntent;

export interface StreamEventPayload {
  kind: string;
  [key: string]: unknown;
}

export interface ServerEvent {
  type: 'event';
  stream: string;
  seq: number;
  event_id: string;
  event: StreamEventPayload;
}
export interface ServerState {
  type: 'state';
  stream: string;
  party: Party;
}
export interface ServerSnapshot {
  type: 'snapshot';
  session: Snapshot;
}
export interface ServerAck {
  type: 'ack';
  intent_id: string;
  applied: boolean;
  duplicate: boolean;
  tick: number;
  reason: null | 'cooldown' | 'out_of_bounds' | 'no_weapon';
}
export interface ServerJoined {
  type: 'joined';
  session_id: string;
  tick: number;
}
export interface ServerJoinRefused {
  type: 'join_refused';
  session_id: string;
  event: {
    kind: 'not_a_member' | 'session_ended' | 'session_complete';
    story_id?: string;
    chapter?: number;
  };
}
export type ServerMessage =
  | ServerEvent
  | ServerState
  | ServerSnapshot
  | ServerAck
  | ServerJoined
  | ServerJoinRefused;

export interface ApiErrorBody {
  error: { code: string; message: string };
  fields?: Record<string, string>;
}
