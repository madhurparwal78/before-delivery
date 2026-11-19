export type Visibility = "public" | "secret";
export type Role = "owner" | "editor" | "viewer";
export type MemberRole = "editor" | "viewer";
export type ReactionType = "love" | "idea" | "wow" | "thanks";

export interface UserRef {
  id: number;
  name: string;
  handle: string;
}

interface PinImage {
  width: number;
  height: number;
  sha256: string;
  variants: { width: number; url: string }[];
  original_url: string;
}

interface SavedFrom {
  pin_id: number | null;
  user_name: string;
  removed: boolean;
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
  board: { id: number; name: string; visibility: Visibility };
  section: { id: number; name: string } | null;
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
  role: Role | null;
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

export interface BoardSummary {
  id: number;
  name: string;
  visibility: Visibility;
  pin_count: number;
}

export interface OperationView {
  id: number;
  kind: "move" | "copy" | "delete";
  count: number;
  board: { id: number; name: string } | null;
  deadline: string;
  status: "open" | "undone" | "expired";
}

export interface CommentView {
  id: number;
  author: UserRef;
  text: string | null;
  deleted: boolean;
  created_at: string;
  replies: Omit<CommentView, "replies">[];
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

interface MemberRow {
  user: UserRef;
  role: MemberRole;
}

export interface InviteRow {
  id: number;
  email: string;
  role: MemberRole;
  expires_at: string;
}

export interface Members {
  owner: UserRef;
  members: MemberRow[];
  invites: InviteRow[];
}

export interface InviteInfo {
  board: { id: number; name: string };
  inviter: { name: string };
  role: MemberRole;
  status: "pending" | "accepted" | "expired" | "revoked";
  expires_at: string;
}

export interface BoardCard extends BoardSummary {
  cover: { pin_id: number; url: string } | null;
}


export interface Profile {
  user: UserRef;
  followers: number;
  following: number;
  pin_total: number;
  board_total: number;
  boards: BoardCard[];
  following_user: boolean;
}

interface TagCount {
  tag: string;
  count: number;
}

export interface SearchResult {
  pins: Pin[];
  tags: TagCount[];
  boards: { id: number; name: string; count: number }[];
}

export type ChangeKind =
  | "added"
  | "moved"
  | "removed"
  | "section_added"
  | "section_moved"
  | "section_renamed"
  | "updated";

export type LiveMessage =
  | { type: "clock"; now: string }
  | {
      type: "board";
      board_id: number;
      seq: number;
      actor: { id: number; name: string };
      change: ChangeKind;
      pin: { id: number; title: string } | null;
      section: { id: number; name: string } | null;
      pin_count: number;
      order: BoardOrder;
    }
  | { type: "membership"; board_id: number; role: MemberRole | null }
  | { type: "feed"; pin_ids: number[] }
  | { type: "counts"; pin_id: number; saves: number; comments: number; reactions: number }
  | { type: "follow"; target: "user" | "board"; id: number; followers: number }
  | { type: "operation_expired"; id: number }
  | { type: "viewers"; board_id: number; viewers: { id: number; name: string }[] }
  | { type: "pin_changed"; pin_id: number; version: number }
  | { type: "not_found"; board: number };

export type ClientMessage =
  | { type: "watch" | "unwatch"; board: number }
  | { type: "watch" | "unwatch"; pin: number }
  | { type: "watch" | "unwatch"; user: number }
  | { type: "watch" | "unwatch"; feed: true };
