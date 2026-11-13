const ROLES = ["viewer", "contributor", "moderator", "owner"] as const;
export const INVITABLE_ROLES = ["viewer", "contributor", "moderator"] as const;
export const LAYOUTS = ["columns", "rows"] as const;
export const SORTS = ["by_hand", "newest", "oldest", "most_liked"] as const;
export const GROUPS = ["section", "author"] as const;
export const PRIVACIES = ["private", "password", "public"] as const;
export const LINK_ACCESSES = ["off", "view", "contribute"] as const;
export const POST_STATES = ["published", "awaiting_approval"] as const;

export type Role = (typeof ROLES)[number];
export type InvitableRole = (typeof INVITABLE_ROLES)[number];
export type Layout = (typeof LAYOUTS)[number];
export type Sort = (typeof SORTS)[number];
export type Group = (typeof GROUPS)[number];
export type Privacy = (typeof PRIVACIES)[number];
export type LinkAccess = (typeof LINK_ACCESSES)[number];
export type PostState = (typeof POST_STATES)[number];

export const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === "string" && (values as readonly string[]).includes(value);

interface Person {
  id: string;
  display_name: string;
}

export interface Account extends Person {
  email: string;
}

interface Attachment {
  id: string;
  file_name: string;
  content_type: string;
  size: number;
  url: string;
}

export interface Post {
  id: string;
  board_id: string;
  section_id: string;
  position: number | null;
  title: string;
  body: string;
  author: Person;
  state: PostState;
  likes: number;
  score: number;
  comments: number;
  liked: boolean;
  my_vote: -1 | 0 | 1;
  attachment: Attachment | null;
  file_card: boolean;
  version: number;
  created_at: string;
  push: "sent" | "pending" | null;
}

export interface SectionSummary {
  id: string;
  title: string;
  count: number;
}

export interface Board {
  id: string;
  title: string;
  layout: Layout;
  sort: Sort;
  group: Group;
  privacy: Privacy;
  approval: boolean;
  link_access: LinkAccess;
  role: Role | null;
  sections: SectionSummary[];
  share_path: string | null;
  embed_path: string | null;
}

export interface ListingSection extends SectionSummary {
  posts: Post[];
}

export interface Listing {
  sections: ListingSection[];
  held: Post[];
}

export interface LinkPage {
  board: Board;
  posts: Listing;
}

export interface BoardSummary {
  id: string;
  title: string;
  role: Role;
  count: number;
  held: number;
}

export interface Member {
  user_id: string;
  display_name: string;
  email: string;
  role: Role;
}

export interface Comment {
  id: string;
  author: Person;
  text: string;
  created_at: string;
}

export interface Reactions {
  likes: number;
  score: number;
  liked: boolean;
  my_vote: -1 | 0 | 1;
}

export interface Conflict {
  error: "conflict";
  post: { section_id: string; position: number; version: number };
  moved_by: string;
}

export interface InviteInfo {
  board_title: string;
  inviter_name: string;
  role: Role;
  expired: boolean;
}

export interface Services {
  storage: boolean;
  mail: boolean;
  push: boolean;
}

export type FieldErrors = Record<string, string>;

/** What a live stream carries. `data` is the JSON of one server-sent event. */
export type BoardEvent =
  | { type: "post_created"; post_id: string; title: string; actor: Person; state: PostState }
  | { type: "post_published"; post_id: string; title: string; author_id: string }
  | { type: "post_rejected"; post_id: string; title: string; author_id: string }
  | { type: "post_moved"; post_id: string; title: string; actor: Person }
  | { type: "post_updated"; post_id: string }
  | { type: "post_deleted"; post_id: string; title: string; actor: Person }
  | { type: "reaction"; post_id: string }
  | { type: "comment_added"; post_id: string }
  | { type: "push_sent"; post_id: string }
  | { type: "board_updated" }
  | { type: "members_changed" }
  | { type: "role_changed"; role: Role | null };
