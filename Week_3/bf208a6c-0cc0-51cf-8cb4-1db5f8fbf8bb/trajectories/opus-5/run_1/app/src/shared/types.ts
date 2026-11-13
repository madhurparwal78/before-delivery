export type Layout = 'columns' | 'rows';
export type SortMode = 'by_hand' | 'newest' | 'oldest' | 'most_liked';
export type GroupMode = 'section' | 'author';
export type Privacy = 'private' | 'password' | 'public';
export type LinkAccess = 'off' | 'view' | 'contribute';
export type Role = 'owner' | 'moderator' | 'contributor' | 'viewer';
export type PostState = 'published' | 'awaiting_approval' | 'rejected';
export type PushState = 'sent' | 'pending';

export interface PersonRef {
  id: string;
  display_name: string;
}

export interface AttachmentRef {
  id: string;
  file_name: string;
  content_type: string;
  size: number;
  url: string;
}

export interface PostDto {
  id: string;
  board_id: string;
  section_id: string;
  position: number | null;
  title: string;
  body: string;
  author: PersonRef;
  state: 'published' | 'awaiting_approval';
  likes: number;
  score: number;
  comments: number;
  liked: boolean;
  my_vote: number;
  attachment: AttachmentRef | null;
  version: number;
  created_at: string;
  push: PushState | null;
}

export interface SectionDto {
  id: string;
  title: string;
  count: number;
}

export interface BoardDto {
  id: string;
  title: string;
  layout: Layout;
  sort: SortMode;
  group: GroupMode;
  privacy: Privacy;
  approval: boolean;
  link_access: LinkAccess;
  role: Role | null;
  sections: SectionDto[];
  share_path: string | null;
  embed_path: string | null;
}

export interface PostsListing {
  sections: Array<SectionDto & { posts: PostDto[] }>;
  held: PostDto[];
}

export interface CommentDto {
  id: string;
  author: PersonRef;
  text: string;
  created_at: string;
}

export interface UserDto {
  id: string;
  display_name: string;
  email: string;
}

export interface BoardSummary {
  id: string;
  title: string;
  role: Role;
  count: number;
  held: number;
}

export type ServiceName = 'storage' | 'mail' | 'push';

export interface ServiceStatus {
  storage: boolean;
  mail: boolean;
  push: boolean;
}

export type BoardEvent =
  | {
      kind: 'post_created';
      post_id: string;
      title: string;
      actor_id: string;
      actor_name: string;
      state: 'published' | 'awaiting_approval';
    }
  | { kind: 'post_updated'; post_id: string; title: string; actor_id: string }
  | { kind: 'post_moved'; post_id: string; title: string; actor_id: string; actor_name: string }
  | { kind: 'post_deleted'; post_id: string; title: string; actor_id: string }
  | { kind: 'post_approved'; post_id: string; title: string; author_id: string }
  | { kind: 'post_rejected'; post_id: string; title: string; author_id: string }
  | { kind: 'post_push'; post_id: string; push: PushState }
  | { kind: 'reaction'; post_id: string }
  | { kind: 'comment'; post_id: string; comment: CommentDto }
  | { kind: 'board_updated' }
  | { kind: 'role_changed'; user_id: string; role: Role | null; board_title: string }
  | { kind: 'services'; services: ServiceStatus };

export interface AccessLostEvent {
  reason: 'password_required' | 'not_found';
}

export interface LandingFrame {
  id: string;
  title: string;
  kind: 'field' | 'file';
  file_name: string | null;
}

export interface Bootstrap {
  user: UserDto | null;
  upload_max_bytes: number;
  services: ServiceStatus;
  screen:
    | { name: 'landing'; frames: LandingFrame[] }
    | { name: 'signup' }
    | { name: 'signin' }
    | { name: 'dashboard' }
    | { name: 'board'; board_id: string }
    | { name: 'share'; token: string; embed: false }
    | { name: 'embed'; token: string; embed: true }
    | { name: 'invite'; token: string }
    | { name: 'password'; board_id: string | null; token: string | null }
    | { name: 'not_found' };
}
