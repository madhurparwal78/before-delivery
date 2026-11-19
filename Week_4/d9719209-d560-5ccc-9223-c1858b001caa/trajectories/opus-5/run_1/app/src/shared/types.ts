export interface PublicUser {
  username: string;
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

export interface PostView {
  id: string;
  communityName: string;
  author: PublicUser | null;
  title: string | null;
  bodyHtml: string | null;
  bodyMd?: string | null;
  images: ImageView[];
  spoiler: boolean;
  score: number;
  myVote: number;
  commentCount: number;
  createdAt: string;
  editedAt: string | null;
  state: 'published' | 'removed' | 'deleted';
  removal: { publicReason: string; at: string } | null;
  locked: boolean;
  lockedUntil: string | null;
  pinned: boolean;
  archived: boolean;
  version: number;
  url: string;
}

export interface CommentView {
  id: string;
  postId: string;
  parentId: string | null;
  author: PublicUser | null;
  bodyHtml: string | null;
  bodyMd?: string | null;
  score: number;
  myVote: number;
  depth: number;
  descendantCount: number;
  createdAt: string;
  editedAt: string | null;
  state: 'published' | 'deleted' | 'removed';
  canEdit: boolean;
  replies: CommentView[];
}

export interface CommunityRule {
  id: string;
  title: string;
  description: string;
}

export interface CommunityView {
  id: string;
  name: string;
  title: string;
  description: string;
  type: 'public' | 'restricted';
  memberCount: number;
  rules: CommunityRule[];
  showModNames: boolean;
  createdAt: string;
  viewer: { joined: boolean; isModerator: boolean; isOwner: boolean; canPost: boolean };
}

export interface ModLogEntryView {
  id: string;
  action: string;
  target: { type: 'post' | 'comment' | 'user'; id: string };
  publicReason: string | null;
  at: string;
  moderator: PublicUser | null;
  privateNote?: string | null;
}

export interface ReportView {
  reference: string;
  target: { type: string; id: string; url: string | null };
  category: string;
  explanation: string;
  createdAt: string;
  deadlineAt: string;
  secondsRemaining: number;
  overdue: boolean;
  status: string;
}

export interface OwnAccount {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
  totpEnabled: boolean;
  role: 'user' | 'admin';
  createdAt: string;
}

export interface PageData {
  route: string;
  account: OwnAccount | null;
  topics: string[];
  sort?: string;
  community?: CommunityView | null;
  post?: PostView | null;
  comments?: CommentView[];
  more?: string[];
  rootCommentId?: string | null;
  posts?: PostView[];
  pinned?: PostView[];
  nextCursor?: string | null;
  communities?: CommunityView[];
  modLog?: ModLogEntryView[];
  reports?: ReportView[];
  serverTime?: string;
  moderators?: Array<{ username: string; isOwner: boolean }>;
  approved?: Array<{ username: string }>;
  profile?: PublicUser | null;
  displayDepth?: number;
  secret?: string | null;
  next?: string | null;
  token?: string | null;
}
