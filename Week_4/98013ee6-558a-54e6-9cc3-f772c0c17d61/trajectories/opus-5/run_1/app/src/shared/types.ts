export type Visibility = 'public' | 'secret';
export type BoardRole = 'owner' | 'editor' | 'viewer';
export type MemberRole = 'editor' | 'viewer';
export type ReactionType = 'love' | 'idea' | 'wow' | 'thanks';
export type OperationKind = 'move' | 'copy' | 'delete';
export type OperationStatus = 'open' | 'undone' | 'expired';

export const REACTION_TYPES: readonly ReactionType[] = ['love', 'idea', 'wow', 'thanks'];

export interface UserRef {
  id: number;
  name: string;
  handle: string;
}

export interface ImageVariant {
  width: number;
  url: string;
}

export interface PinImage {
  width: number;
  height: number;
  sha256: string;
  variants: ImageVariant[];
  original_url: string;
}

export interface SavedFrom {
  pin_id: number | null;
  user_name: string;
  removed: boolean;
}

export interface BoardRef {
  id: number;
  name: string;
  visibility: Visibility;
}

export interface SectionRef {
  id: number;
  name: string;
}

export interface Pin {
  id: number;
  version: number;
  title: string;
  description: string;
  alt: string;
  source: string | null;
  source_host: string | null;
  tags: string[];
  owner: UserRef;
  board: BoardRef;
  section: SectionRef | null;
  position: number;
  image: PinImage;
  saved_from: SavedFrom | null;
  saves: number;
  comments: number;
  reactions: number;
  my_reaction: ReactionType | null;
  created_at: string;
}

export interface FeedPin extends Pin {
  group: { size: number; owners: string[] };
}

export interface BoardOrder {
  unsectioned: number[];
  sections: { id: number; name: string; pins: number[] }[];
}

export interface Board {
  id: number;
  name: string;
  visibility: Visibility;
  owner: UserRef;
  role: BoardRole | null;
  seq: number;
  pin_count: number;
  followers: number;
  following: boolean;
  cover: number | null;
  created_at: string;
  last_saved_at: string | null;
  order: BoardOrder;
  pins: Pin[];
}

export interface Operation {
  id: number;
  kind: OperationKind;
  count: number;
  board: { id: number; name: string } | null;
  deadline: string;
  status: OperationStatus;
}

export interface CommentNode {
  id: number;
  author: UserRef;
  text: string | null;
  deleted: boolean;
  created_at: string;
  replies?: CommentNode[];
}

export interface PublicConfig {
  now: string;
  time_zone: string;
  undo_seconds: number;
  invite_ttl_seconds: number;
  limits: {
    image_max_bytes: number;
    image_max_pixels: number;
    title_max: number;
    description_max: number;
    comment_max: number;
    board_name_max: number;
  };
}

export interface BoardSummary {
  id: number;
  name: string;
  visibility: Visibility;
  pin_count: number;
}

export interface ProfileBoard extends BoardSummary {
  cover: { pin_id: number; url: string } | null;
}

export interface ProfileResponse {
  user: UserRef;
  followers: number;
  following: number;
  pin_total: number;
  board_total: number;
  boards: ProfileBoard[];
  following_user: boolean;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface BoardCount {
  id: number;
  name: string;
  count: number;
}

export interface SearchResponse {
  pins: Pin[];
  tags: TagCount[];
  boards: BoardCount[];
}

export interface MembersResponse {
  owner: UserRef;
  members: { user: UserRef; role: MemberRole }[];
  invites: { id: number; email: string; role: MemberRole; expires_at: string }[];
}

export interface InviteView {
  board: { id: number; name: string };
  inviter: { name: string };
  role: MemberRole;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  expires_at: string;
}

export type BoardChange =
  | 'added'
  | 'moved'
  | 'removed'
  | 'section_added'
  | 'section_moved'
  | 'section_renamed'
  | 'updated';

export type LiveMessage =
  | { type: 'clock'; now: string }
  | {
      type: 'board';
      board_id: number;
      seq: number;
      actor: { id: number; name: string };
      change: BoardChange;
      pin: { id: number; title: string } | null;
      section: { id: number; name: string } | null;
      pin_count: number;
      order: BoardOrder;
    }
  | { type: 'membership'; board_id: number; role: MemberRole | null }
  | { type: 'feed'; pin_ids: number[] }
  | { type: 'counts'; pin_id: number; saves: number; comments: number; reactions: number }
  | { type: 'follow'; target: 'user' | 'board'; id: number; followers: number }
  | { type: 'operation_expired'; id: number }
  | { type: 'viewers'; board_id: number; viewers: { id: number; name: string }[] }
  | { type: 'pin_changed'; pin_id: number; version: number }
  | { type: 'not_found'; board: number };
