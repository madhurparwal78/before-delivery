/** API shapes the brief prints. Optional keys are absent (never null) when a rule hides them. */

export interface Config {
  post_max_chars: number;
  see_more_chars: number;
  typing_timeout_ms: number;
  max_skills: number;
  photo_max_bytes: number;
  resume_max_bytes: number;
  feed_page_size: number;
  time_zone: string;
  now: string;
}

export interface SessionMember {
  id: string;
  handle: string;
  name: string;
}

export type DegreeValue = '1' | '2' | '3' | 'out';
export type ConnectionState = 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'withdrawn' | 'ignored';
export type Visibility = 'public' | 'connections' | 'private';

export interface PersonCard {
  id: string;
  handle: string;
  name: string;
  headline: string;
  photo_url?: string | null;
  degree: DegreeValue;
  connection_state: ConnectionState;
  mutual_count: number;
  requested_at?: string;
  connected_at?: string;
}

export interface ExperienceEntry {
  title: string;
  company: string;
  start: string;
  end: string | null;
}

export interface EducationEntry {
  school: string;
  degree: string;
  start: string;
  end: string | null;
}

export interface Skill {
  name: string;
  endorsements: number;
  endorsed_by_me: boolean;
  featured_position: number | null;
  endorser_line: string | null;
}

export interface MemberRef {
  id: string;
  name: string;
  handle: string;
}

export interface Profile {
  id: string;
  handle: string;
  name: string;
  headline: string;
  location?: string;
  photo_url?: string | null;
  visibility: Visibility;
  degree: DegreeValue | 'self';
  connection_state?: ConnectionState;
  following?: boolean;
  mutual?: { count: number; named?: MemberRef };
  email?: string;
  versions?: { intro: number; about: number; experience: number; education: number; skills: number };
  about?: string;
  experience?: ExperienceEntry[];
  education?: EducationEntry[];
  skills?: Skill[];
}

export type ReactionType = 'like' | 'celebrate' | 'support' | 'insightful' | 'funny';

export interface ReactionSummary {
  count: number;
  mine: ReactionType | null;
  top_types: ReactionType[];
  text: string;
}

export interface Mention {
  handle: string;
  member_id: string;
  name: string;
}

interface PostAuthor {
  id: string;
  handle: string;
  name: string;
  headline: string;
  degree: DegreeValue | 'self';
}

export interface Post {
  id: string;
  author: PostAuthor;
  text: string;
  mentions: Mention[];
  hashtags: string[];
  created_at: string;
  edited_at: string | null;
  editable: boolean;
  photo_url: string | null;
  reactions: ReactionSummary;
  comment_count: number;
  repost_count: number;
  reposted_by_me: boolean;
  shared: Post | { unavailable: true } | null;
}

export interface FeedEntry {
  entry_id: string;
  kind: 'post' | 'repost';
  created_at: string;
  post: Post;
  reposter: MemberRef | null;
}

export interface Comment {
  id: string;
  post_id: string;
  parent_id: string | null;
  deleted: boolean;
  author?: { id: string; handle: string; name: string; headline: string };
  text?: string;
  mentions?: Mention[];
  hashtags?: string[];
  created_at?: string;
  replies: Comment[];
}

export interface NotificationItem {
  id: string;
  kind: string;
  count: number;
  actors: Array<{ id: string; name: string }>;
  text: string;
  target_url: string;
  created_at: string;
  updated_at: string;
  unread: boolean;
}

export interface ConversationSummary {
  id: string;
  other: { id: string; name: string; handle: string; photo_url: string | null };
  last_message: { text: string; sent_at: string; sender_id: string } | null;
  unread_count: number;
}

export interface Message {
  id: string;
  sender_id: string;
  text: string;
  sent_at: string;
  read_at: string | null;
}

export interface JobCard {
  id: string;
  title: string;
  company: { id: string; name: string; handle: string };
  location: string;
  workplace: 'on-site' | 'hybrid' | 'remote';
  posted_at: string;
  closes_at: string;
  open: boolean;
  saved: boolean;
  applied: boolean;
}

export type ApplicationState = 'applied' | 'viewed' | 'interviewing' | 'offered' | 'rejected' | 'withdrawn';

export interface Network {
  received: PersonCard[];
  sent: PersonCard[];
  connections: PersonCard[];
}
