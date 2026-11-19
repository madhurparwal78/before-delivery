export interface PublicUser { username: string; createdAt: string }

export interface OwnAccount {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
  totpEnabled: boolean;
  role: 'user' | 'admin';
  createdAt: string;
}

export interface ImageView {
  id: string;
  alt: string | null;
  width: number;
  height: number;
  src: string;
  srcset: string;
}

export type PostState = 'published' | 'removed' | 'deleted';

export interface PostView {
  id: string;
  communityName: string;
  author: PublicUser | null;
  title: string | null;
  bodyHtml: string | null;
  images: ImageView[];
  spoiler: boolean;
  score: number;
  myVote: -1 | 0 | 1;
  commentCount: number;
  createdAt: string;
  editedAt: string | null;
  state: PostState;
  removal: { publicReason: string; at: string } | null;
  locked: boolean;
  lockedUntil: string | null;
  pinned: boolean;
  archived: boolean;
  version: number;
  url: string;
  bodyMd?: string | null;
}

export type CommentState = 'published' | 'deleted' | 'removed';

export interface CommentView {
  id: string;
  postId: string;
  parentId: string | null;
  author: PublicUser | null;
  bodyHtml: string | null;
  score: number;
  myVote: -1 | 0 | 1;
  depth: number;
  descendantCount: number;
  createdAt: string;
  editedAt: string | null;
  state: CommentState;
  canEdit: boolean;
  replies: CommentView[];
  bodyMd?: string | null;
}

export interface Rule { id: string; title: string; description: string }

export interface CommunityView {
  id: string;
  name: string;
  title: string;
  description: string;
  type: 'public' | 'restricted';
  memberCount: number;
  rules: Rule[];
  showModNames: boolean;
  createdAt: string;
  viewer: { joined: boolean; isModerator: boolean; isOwner: boolean; canPost: boolean };
}

export type ModAction =
  | 'remove_post' | 'restore_post' | 'remove_comment' | 'lock' | 'unlock' | 'pin' | 'unpin'
  | 'add_moderator' | 'remove_moderator' | 'approve_poster' | 'unapprove_poster';

export interface ModLogEntry {
  id: string;
  action: ModAction;
  target: { type: 'post' | 'comment' | 'user'; id: string };
  publicReason: string | null;
  at: string;
  moderator: PublicUser | null;
  privateNote?: string | null;
}

export interface ReportView {
  reference: string;
  target: { type: 'post' | 'comment'; id: string; url: string };
  category: string;
  explanation: string;
  createdAt: string;
  deadlineAt: string;
  secondsRemaining: number;
  overdue: boolean;
  status: 'open' | 'actioned' | 'dismissed';
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    retryAfter?: number;
    fields?: Record<string, string>;
    current?: Record<string, unknown>;
  };
}

export type StreamEventName = 'score' | 'comments' | 'comment' | 'post-state' | 'membership' | 'account' | 'resync';

export interface StreamPayloads {
  score: { targetType: 'post' | 'comment'; targetId: string; postId: string; score: number };
  comments: { postId: string; commentCount: number };
  comment: { postId: string; parentId: string | null; comment: CommentView };
  'post-state': {
    postId: string; communityName: string; state: PostState; publicReason: string | null;
    locked: boolean; lockedUntil: string | null; pinned: boolean; version: number;
  };
  membership: { communityName: string; memberCount: number };
  account: { kind: 'moderator-removed' | 'approved' | 'unapproved' | 'suspended'; communityName: string | null };
  resync: Record<string, never>;
}

export type FeedSort = 'hot' | 'new' | 'top';
export type CommentSort = 'top' | 'new';
