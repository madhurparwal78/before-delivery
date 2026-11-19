export interface Me {
  personId: string;
  displayName: string;
  email: string;
  siteRole: string;
  timeZone: string;
  avatarId: string | null;
  hideAbove: string | null;
  worldId: string;
}

export interface MirrorPerson {
  personId: string;
  displayName: string;
  x: number;
  y: number;
  facing: string;
  seated: boolean;
  avatar: 'shown' | 'hidden' | 'fallback';
  host: boolean;
}

export interface RoomFeature {
  id: string;
  kind: 'exit' | 'seat';
  x: number;
  y: number;
  occupiedBy: string;
}

export interface Layout {
  width: number;
  height: number;
  spawn: Array<{ x: number; y: number }>;
  walls: Array<{ x: number; y: number }>;
  seats: Array<{ id: string; x: number; y: number }>;
  exits: Array<{ id: string; x: number; y: number }>;
}

export interface SessionDetail {
  id: string;
  roomId: string;
  roomName: string;
  roomVersion: number;
  hostId: string;
  hostName: string;
  visibility: string;
  capacity: number;
  count: number;
  status: string;
  communityId: string | null;
  layout?: Layout;
  features?: RoomFeature[];
  people?: MirrorPerson[];
}

export interface SessionSummary {
  id: string;
  roomName: string;
  hostName: string;
  visibility: string;
  capacity: number;
  count: number;
  status: string;
}

export interface Friend {
  personId: string;
  displayName: string;
  presence: string;
  session: { id: string; roomName: string } | null;
}

export interface AssetSummary {
  id: string;
  kind: string;
  name: string;
  ownerName: string;
  currentVersion: number | null;
  rank: string | null;
}

export interface Measures {
  triangles: number;
  materials: number;
  textureSize: number;
  fileSize: number;
}

export interface VersionView {
  version: number;
  status: string;
  rank: string;
  worstMeasure: string;
  measures: Measures;
  measureRanks: Record<string, string>;
  layout?: Layout | null;
  createdAt: string;
}

export interface AssetDetail extends AssetSummary {
  versions: VersionView[];
}

export interface UploadResult {
  assetId: string;
  version: number;
  rank: string;
  worstMeasure: string;
  measures: Measures;
  measureRanks: Record<string, string>;
}

export interface VoteView {
  id: string;
  targetId: string;
  status: 'open' | 'passed' | 'failed';
  eligible: number;
  needed: number;
  yes: number;
  no: number;
  closesAt: string;
}

export interface ChatMessage {
  id: string;
  fromId: string;
  fromName: string;
  text: string;
  sentAt: string;
}

export interface CommunitySummary {
  id: string;
  name: string;
  timeZone: string;
  role: string;
}

export interface CommunityMember {
  personId: string;
  displayName: string;
  role: string;
  joinedAt?: string;
  email?: string;
}

export interface OccurrenceView {
  startsAt: string;
  startsLocal: string;
  display: string;
  status: string;
  note: string | null;
}

export interface GatheringView {
  id: string;
  communityId: string;
  title: string;
  durationMinutes: number;
  recurrence: string;
  limit: number;
  attendingCount: number;
  attending: boolean;
  status: string;
  display: string;
  occurrences: OccurrenceView[];
}

export interface ReportView {
  id: string;
  personId: string;
  personName: string;
  sessionId: string;
  roomName: string;
  category: string;
  details: string;
  state: string;
  action: string | null;
  createdAt: string;
}

export interface SafetyState {
  blocked: string[];
  muted: string[];
}
